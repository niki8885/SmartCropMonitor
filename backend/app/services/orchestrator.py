import os
import subprocess
import datetime
import xarray as xr
import rioxarray

from sqlalchemy.orm import Session
from pystac_client import Client

import logging
from app.core.config import DATA_DIR, MASK_DIR, VIS_DIR, REQUIRED_BANDS, AUX_LAYERS, VISUAL_ASSET, STAC_API_URL
from app.services.field_analysis import validate_pending_analyses
from app.core.database import UserLocation, FieldAnalysis
from app.services.ndvi_processor import sateline_metrics, run_per_field_metrics
from app.services.weather_service import fetch_and_save_weather, weather_metrics
from app.services.wrf_service import ingest_wrf_output
from app.services.biomass_service import run_biomass_estimation
from app.monitoring.alerting import format_alert, AlertService
from app.services.anomaly_processor import find_all_anomaly
from app.services.spot_anomaly_processor import find_all_satellite_anomaly
from app.events.alerts_orchestrator import run_all_alert_checks
from app.events.urgent_email_alerts import deliver_pending_urgent_alerts
from app.events.system_alerts import create_system_critical_alerts
from app.services.dem_service import ensure_dem_for_all_locations
from app.services.disease_service import disease_risk
from app.core.config import WEBHOOK_URL
from geoalchemy2.shape import to_shape

alert_service = AlertService(webhook_url=WEBHOOK_URL)
logger = logging.getLogger(__name__)

PROJECT_NAME         = os.environ.get("COMPOSE_PROJECT_NAME", "smartcropmonitor")
PREPROCESSOR_IMAGE   = os.environ.get("WRF_PREPROCESSOR_IMAGE", f"{PROJECT_NAME}-wrf-preprocessor")
RUNNER_IMAGE         = os.environ.get("WRF_RUNNER_IMAGE",        f"{PROJECT_NAME}-wrf-runner")
WRF_SHARED_VOLUME    = os.environ.get("WRF_SHARED_VOLUME",       f"{PROJECT_NAME}_wrf_shared_exchange")
TOPO_HOST_PATH       = os.environ.get("TOPO_HOST_PATH",          "/mnt/volume-nbg1-2/topo")

NAMELIST_WPS_TEMPLATE = "/app/data/namelist.wps"


def _run_container(image: str, env: dict, volumes: list[str], name_suffix: str) -> bool:
    """
    Run a pre-built Docker image as a one-shot container.
    Streams stdout/stderr line-by-line. Returns True on success.
    """
    cmd = ["docker", "run", "--rm", f"--name={name_suffix}"]

    for k, v in env.items():
        cmd += ["-e", f"{k}={v}"]

    for v in volumes:
        cmd += ["-v", v]

    cmd.append(image)

    logger.info(f"[wrf] docker run {image} (env={list(env.keys())})")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    output_tail = []
    for line in proc.stdout:
        line = line.rstrip()
        logger.info(f"[{name_suffix}] {line}")
        output_tail.append(line)
        if len(output_tail) > 50:
            output_tail.pop(0)

    proc.wait()
    return proc.returncode == 0, "\n".join(output_tail[-20:])


def _write_namelist_to_shared(lat: float, lon: float) -> bool:
    template_path = NAMELIST_WPS_TEMPLATE
    if not os.path.exists(template_path):
        logger.error(f"[wrf] namelist.wps template not found at {template_path}")
        return False

    try:
        with open(template_path, "r") as f:
            content = f.read()

        truelat1 = round(lat - 5, 1)
        truelat2 = round(lat + 5, 1)

        content = content.replace("REF_LAT",   str(lat))
        content = content.replace("REF_LON",   str(lon))
        content = content.replace("TRUELAT1",  str(truelat1))
        content = content.replace("TRUELAT2",  str(truelat2))
        content = content.replace("STAND_LON", str(lon))

        # Пишем в shared volume который примонтирован в /app/shared
        shared_nml = "/app/shared/namelist.wps"
        os.makedirs(os.path.dirname(shared_nml), exist_ok=True)
        with open(shared_nml, "w") as f:
            f.write(content)

        logger.info(f"[wrf] namelist.wps written to {shared_nml} (lat={lat}, lon={lon})")
        return True

    except Exception as e:
        logger.error(f"[wrf] Failed to write namelist.wps: {e}")
        return False


def _run_wrf_for_location(lat: float, lon: float, location_id: int) -> bool:
    """
    Run wrf-preprocessor + wrf-runner using pre-built images via docker run.
    No docker compose involved — avoids context/build path issues.
    """

    if not _write_namelist_to_shared(lat, lon):
        alert_service.send(
            key=f"wrf_namelist_fail_{location_id}",
            message=format_alert(
                "WRF_PREPROCESSOR_FAILED",
                f"Failed to write namelist.wps for location {location_id}",
                {"location_id": location_id}
            )
        )
        return False

    wrf_env = {
        "WRF_CENTER_LAT":    str(lat),
        "WRF_CENTER_LON":    str(lon),
        "WRF_LOCATION_ID":   str(location_id),
        "WEBHOOK_URL":       os.environ.get("WEBHOOK_URL", ""),
        "GFS_FORECAST_HOURS": "48",
        "GFS_INTERVAL_HOURS": "3",
        "GRIB_INPUT_DIR":    "/app/shared/grib_input",
        "SHARED_DIR":        "/app/shared",
        "NAMELIST_WPS_PATH": "/app/WPS/namelist.wps",
    }

    shared_volumes = [
        f"{WRF_SHARED_VOLUME}:/app/shared",
        f"{TOPO_HOST_PATH}:/app/backend/data/storage/topo:ro",
    ]

    runner_volumes = [
        f"{WRF_SHARED_VOLUME}:/app/shared",
        f"{WRF_SHARED_VOLUME}:/app/WRF/test/em_real/input_data",
    ]

    # Step 1: preprocessor
    logger.info(f"[wrf] Starting preprocessor for loc {location_id} ({lat}, {lon})")
    ok, tail = _run_container(
        image=PREPROCESSOR_IMAGE,
        env=wrf_env,
        volumes=shared_volumes,
        name_suffix=f"wrf-pre-loc{location_id}",
    )

    if not ok:
        logger.error(f"[wrf] Preprocessor failed for loc {location_id}")
        alert_service.send(
            key=f"wrf_preprocessor_fail_{location_id}",
            message=format_alert(
                "WRF_PREPROCESSOR_FAILED",
                f"wrf-preprocessor failed for location {location_id}",
                {"location_id": location_id, "tail": tail}
            )
        )
        return False

    logger.info(f"[wrf] Preprocessor done for loc {location_id}. Starting runner...")

    # Step 2: runner
    runner_env = {
        "WRF_LOCATION_ID": str(location_id),
        "SHARED_DIR":      "/app/shared",
        "WEBHOOK_URL":     os.environ.get("WEBHOOK_URL", ""),
    }

    ok, tail = _run_container(
        image=RUNNER_IMAGE,
        env=runner_env,
        volumes=runner_volumes,
        name_suffix=f"wrf-run-loc{location_id}",
    )

    if not ok:
        logger.error(f"[wrf] Runner failed for loc {location_id}")
        alert_service.send(
            key=f"wrf_runner_fail_{location_id}",
            message=format_alert(
                "WRF_RUNNER_FAILED",
                f"wrf-runner failed for location {location_id}",
                {"location_id": location_id, "tail": tail}
            )
        )
        return False

    logger.info(f"[wrf] Runner done for loc {location_id}")
    return True


def full_sync_process(db: Session):
    try:
        ensure_dem_for_all_locations(db)
        download_sentinel_data(db)
        validate_pending_analyses(db)
        sateline_metrics(db)
        run_per_field_metrics(db)
        run_biomass_estimation(db)
        find_all_anomaly(db)
        find_all_satellite_anomaly(db)
        deliver_pending_urgent_alerts(db)

    except Exception as e:
        logger.error(f"Critical orchestrator failure: {e}", exc_info=True)
        db.rollback()
        try:
            create_system_critical_alerts(
                db,
                component="full_sync",
                message=str(e),
                metadata={"process": "full_sync_process"},
            )
            alert_service.send(
                key="orchestrator_failure",
                message=format_alert("ORCHESTRATOR_CRITICAL", f"Full sync failed: {str(e)}")
            )
        except Exception as alert_error:
            logger.critical(f"Failed to send alert: {alert_error}")
        raise


def short_sync_process(db: Session):
    try:
        all_locations = db.query(UserLocation).all()

        for loc in all_locations:
            point = to_shape(loc.location)
            lat, lon = point.y, point.x

            logger.info(f"[sync] Processing location: {loc.label} ({lat}, {lon})")

            wrf_ok = _run_wrf_for_location(lat, lon, loc.id)

            if not wrf_ok:
                logger.warning(f"[sync] WRF failed for {loc.label} — falling back to Open-Meteo only")
            else:
                wrf_count = ingest_wrf_output(db, loc)
                logger.info(f"[sync] WRF ingested {wrf_count} records for {loc.label}")

            fetch_and_save_weather(db, loc)
            weather_metrics(db, loc)
            disease_risk(db, loc)

        run_all_alert_checks()

    except Exception as e:
        logger.error(f"Critical orchestrator failure: {e}", exc_info=True)
        db.rollback()
        try:
            create_system_critical_alerts(
                db,
                component="short_sync",
                message=str(e),
                metadata={"process": "short_sync_process"},
            )
            alert_service.send(
                key="orchestrator_failure",
                message=format_alert("ORCHESTRATOR_CRITICAL", f"Short sync failed: {str(e)}")
            )
        except Exception as alert_error:
            logger.critical(f"Failed to send alert: {alert_error}")
        raise


def download_sentinel_data(db: Session):

    client = Client.open(STAC_API_URL)
    locations = db.query(UserLocation).all()

    end_date   = datetime.datetime.now(datetime.UTC)
    start_date = end_date - datetime.timedelta(days=60)
    date_range = (
        f"{start_date.strftime('%Y-%m-%dT%H:%M:%SZ')}/"
        f"{end_date.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )

    for loc in locations:
        try:
            point    = to_shape(loc.location)
            lon, lat = point.x, point.y
            logger.debug(f"[sentinel] location_id={loc.id} at ({lat}, {lon})")

            search = client.search(
                collections=["sentinel-2-l2a"],
                bbox=[lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1],
                datetime=date_range,
                max_items=20,
                sortby=[{"field": "properties.datetime", "direction": "desc"}]
            )

            items = list(search.items())

            if not items:
                logger.warning(f"[sentinel] No items for loc={loc.id}")
                alert_service.send(
                    key=f"no_data_{loc.id}",
                    message=format_alert(
                        "DATA_MISSING",
                        f"No Sentinel items for {loc.label}",
                        {"location_id": loc.id, "coords": f"{lat}, {lon}"}
                    )
                )
                continue

            items = sorted(
                items,
                key=lambda x: x.datetime or datetime.datetime.min.replace(tzinfo=datetime.UTC),
                reverse=True
            )[:10]

            for item in items:
                timestamp = item.datetime
                base_name = f"user_{loc.user_id}_loc_{loc.id}_{timestamp.strftime('%Y%m%dT%H%M%S')}"

                nc_path  = os.path.join(DATA_DIR,  f"{base_name}.nc")
                scl_path = os.path.join(MASK_DIR,  f"scl_{base_name}.nc")
                aot_path = os.path.join(MASK_DIR,  f"aot_{base_name}.nc")
                wvp_path = os.path.join(MASK_DIR,  f"wvp_{base_name}.nc")
                vis_path = os.path.join(VIS_DIR,   f"vis_{base_name}.tif")

                if os.path.exists(nc_path):
                    logger.debug(f"[sentinel] Skip existing {base_name}")
                    continue

                datasets     = []
                reference_da = None

                for band_name in REQUIRED_BANDS:
                    asset = item.assets.get(band_name)
                    if not asset:
                        logger.warning(f"[sentinel] Missing band: {band_name}")
                        continue

                    da = rioxarray.open_rasterio(asset.href, chunks=True)
                    clipped = da.rio.clip_box(
                        minx=lon - 0.05, miny=lat - 0.05,
                        maxx=lon + 0.05, maxy=lat + 0.05,
                        crs="EPSG:4326", allow_one_dimensional_raster=True,
                    )

                    if reference_da is None:
                        reference_da = clipped
                        final_da     = clipped
                    else:
                        final_da = clipped.rio.reproject_match(reference_da)

                    final_da = final_da.squeeze().drop_vars(["band", "spatial_ref"], errors="ignore")
                    datasets.append(final_da)

                if len(datasets) != len(REQUIRED_BANDS):
                    logger.warning(f"[sentinel] Incomplete bands {len(datasets)}/{len(REQUIRED_BANDS)} for {base_name}")
                    continue

                ds = xr.concat(datasets, dim="band")
                ds = ds.assign_coords(band=REQUIRED_BANDS)

                if reference_da is not None and reference_da.rio.crs:
                    ds = ds.rio.set_spatial_dims(x_dim="x", y_dim="y").rio.write_crs(reference_da.rio.crs)

                ds.to_netcdf(nc_path)

                scl_asset = item.assets.get("scl")
                if scl_asset:
                    try:
                        da      = rioxarray.open_rasterio(scl_asset.href, chunks=True)
                        clipped = da.rio.clip_box(
                            minx=lon - 0.05, miny=lat - 0.05,
                            maxx=lon + 0.05, maxy=lat + 0.05,
                            crs="EPSG:4326", allow_one_dimensional_raster=True,
                        )
                        scl_da = clipped.rio.reproject_match(reference_da)
                        scl_da = scl_da.squeeze().drop_vars(["band", "spatial_ref"], errors="ignore")
                        scl_da.to_netcdf(scl_path)
                    except Exception as e:
                        logger.warning(f"[sentinel] SCL failed: {e}")

                for layer, path in [("aot", aot_path), ("wvp", wvp_path)]:
                    asset = item.assets.get(layer)
                    if not asset:
                        continue
                    try:
                        da      = rioxarray.open_rasterio(asset.href, chunks=True)
                        clipped = da.rio.clip_box(
                            minx=lon - 0.05, miny=lat - 0.05,
                            maxx=lon + 0.05, maxy=lat + 0.05,
                            crs="EPSG:4326", allow_one_dimensional_raster=True,
                        )
                        final_da = clipped.rio.reproject_match(reference_da)
                        final_da = final_da.squeeze().drop_vars(["band", "spatial_ref"], errors="ignore")
                        final_da.to_netcdf(path)
                    except Exception as e:
                        logger.warning(f"[sentinel] {layer} failed: {e}")

                visual_asset = item.assets.get(VISUAL_ASSET)
                if visual_asset:
                    try:
                        da      = rioxarray.open_rasterio(visual_asset.href)
                        clipped = da.rio.clip_box(
                            minx=lon - 0.05, miny=lat - 0.05,
                            maxx=lon + 0.05, maxy=lat + 0.05,
                            crs="EPSG:4326", allow_one_dimensional_raster=True,
                        )
                        clipped.rio.to_raster(vis_path)
                    except Exception as e:
                        logger.warning(f"[sentinel] Visual failed: {e}")

                new_entry = FieldAnalysis(
                    location_id=loc.id,
                    nc_filename=os.path.basename(nc_path),
                    mask_filename=os.path.basename(scl_path) if os.path.exists(scl_path) else None,
                    last_data_request_date=timestamp,
                )
                db.add(new_entry)
                db.commit()
                logger.info(f"[sentinel] Saved: {base_name}")

        except Exception as e:
            logger.error(f"[sentinel] Failed loc {loc.id}: {e}", exc_info=True)
            alert_service.send(
                key=f"loc_err_{loc.id}",
                message=format_alert(
                    "LOCATION_SYNC_ERROR",
                    f"Failed to process location: {str(e)}",
                    {"location_id": loc.id}
                )
            )
            db.rollback()
