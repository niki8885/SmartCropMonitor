import os
import time
import datetime
import numpy as np
import requests
import xarray as xr
import rioxarray
from app.core.config import DATA_DIR, NDVI_DIR, HASKELL_SERVICE_URL, QUALITY_THRESHOLD_NDVI
from app.core.database import FieldAnalysis, FieldUnit, FieldData
from shapely import wkb
import geopandas as gpd
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from app.services import sentinel_index_engine


def perform_haskell_calculation(payload):
    try:
        for _ in range(3):
            try:
                response = requests.post(
                    HASKELL_SERVICE_URL,
                    json=payload,
                    timeout=20
                )
                if response.status_code == 200:
                    return response.json()
            except requests.RequestException:
                time.sleep(1)
        return None
    except Exception as e:
        print(f"[ERROR] Haskell communication failed: {e}")
        return None


def sateline_metrics(db: Session):
    pending_list = (
        db.query(FieldAnalysis)
        .filter(
            and_(
                FieldAnalysis.metrics_status == None,
                FieldAnalysis.is_valid != None,
                FieldAnalysis.is_valid >= QUALITY_THRESHOLD_NDVI
            )
        )
        .all()
    )

    if not pending_list:
        print("[INFO] No pending NDVI calculation to process.")
        return

    for data in pending_list:
        nc_path = os.path.join(DATA_DIR, data.nc_filename) if data.nc_filename else None

        if not nc_path or not os.path.exists(nc_path):
            print(f"[ERROR] File {nc_path} not found")
            continue

        try:
            with xr.open_dataset(nc_path) as ds:
                data_array = ds['__xarray_dataarray_variable__']

                print(f"[DEBUG] data_array shape: {data_array.shape}, dims: {data_array.dims}")
                print(f"[DEBUG] bands: {data_array.coords['band'].values.tolist()}")

                # Primary: compute indices in-process via the Fortran-backed
                # sentinel_processor package. Fallback: legacy Haskell service.
                # Both paths yield the same {ndvi_map, gndvi_map, ndre_map,
                # ndwi_map, nmdi_map} dict, so everything below is unchanged.
                result = None
                engine_used = None

                if sentinel_index_engine.is_enabled():
                    try:
                        result = sentinel_index_engine.compute_metrics(data_array)
                        engine_used = sentinel_index_engine.ENGINE_NAME
                    except Exception as engine_err:
                        print(
                            f"[WARNING] {sentinel_index_engine.ENGINE_NAME} engine failed "
                            f"for {data.nc_filename} ({engine_err}); falling back to Haskell."
                        )
                        result = None

                if result is None:
                    payload = {
                        "config": 1,
                        "raw_data": {
                            "green":    data_array.sel(band='green').values.tolist(),
                            "red":      data_array.sel(band='red').values.tolist(),
                            "rededge2": data_array.sel(band='rededge2').values.tolist(),
                            "nir":      data_array.sel(band='nir').values.tolist(),
                            "swir16":   data_array.sel(band='swir16').values.tolist(),
                            "swir22":   data_array.sel(band='swir22').values.tolist()
                        }
                    }

                    result = perform_haskell_calculation(payload)
                    engine_used = "haskell"

                if result:
                    src_crs = None
                    if "spatial_ref" in ds:
                        crs_wkt = ds["spatial_ref"].attrs.get("crs_wkt")
                        proj4  = ds["spatial_ref"].attrs.get("proj4")
                        src_crs = crs_wkt or proj4
                    if src_crs is None:
                        src_crs = ds.rio.set_spatial_dims(
                            x_dim="x", y_dim="y"
                        ).rio.crs
                    if src_crs is None:
                        x_val = float(ds.x.mean())
                        src_crs = "EPSG:4326" if abs(x_val) <= 180 else "EPSG:32634"
                        print(f"[WARNING] CRS not found in raw file, using {src_crs}")

                    metrics_data = {
                        "ndvi":  (["y", "x"], np.array(result["ndvi_map"],  dtype=float)),
                        "gndvi": (["y", "x"], np.array(result["gndvi_map"], dtype=float)),
                        "ndre":  (["y", "x"], np.array(result["ndre_map"],  dtype=float)),
                        "ndwi":  (["y", "x"], np.array(result["ndwi_map"],  dtype=float)),
                        "nmdi":  (["y", "x"], np.array(result["nmdi_map"],  dtype=float))
                    }

                    metrics_ds = xr.Dataset(
                        data_vars=metrics_data,
                        coords={
                            "y": ds.coords["y"],
                            "x": ds.coords["x"]
                        }
                    )

                    metrics_ds = (
                        metrics_ds
                        .rio.set_spatial_dims(x_dim="x", y_dim="y")
                        .rio.write_crs(src_crs)
                    )

                    output_filename = f"metrics_{data.nc_filename}"
                    output_path = os.path.join(NDVI_DIR, output_filename)
                    metrics_ds.to_netcdf(output_path)

                    data.metrics_status = True
                    data.metrics_filename = output_filename
                    db.commit()
                    print(
                        f"[SUCCESS] Processed {data.nc_filename} via {engine_used}, "
                        f"saved to {output_filename}"
                    )
                else:
                    print(f"[ERROR] Failed to get metrics ({engine_used}) for {data.nc_filename}")

        except Exception as e:
            db.rollback()
            print(f"[ERROR] Error processing {data.nc_filename}: {e}")


def get_pending_per_field_metric_tasks(db: Session):
    analyses = (
        db.query(FieldAnalysis)
        .filter(
            FieldAnalysis.metrics_status == True,
            or_(
                FieldAnalysis.per_metrics_status == False,
                FieldAnalysis.per_metrics_status.is_(None)
            )
        )
        .all()
    )

    return [
        {
            "analysis_id": a.id,
            "location_id": a.location_id,
            "nc_filename": a.nc_filename,
            "metrics_filename": a.metrics_filename
        }
        for a in analyses
    ]


def get_fields_for_analysis(db: Session, analysis_id: int):
    analysis = (
        db.query(FieldAnalysis)
        .filter(FieldAnalysis.id == analysis_id)
        .first()
    )

    if not analysis:
        return {"analysis": None, "fields": []}

    fields = (
        db.query(FieldUnit)
        .filter(FieldUnit.location_id == analysis.location_id)
        .all()
    )

    return {"analysis": analysis, "fields": fields}


def run_per_field_metrics(db: Session):
    tasks = get_pending_per_field_metric_tasks(db)
    print(f"[DEBUG] Found {len(tasks)} pending tasks")

    for task in tasks:
        data = get_fields_for_analysis(db, task["analysis_id"])
        analysis, fields = data["analysis"], data["fields"]

        if not fields:
            print(f"[WARNING] No fields found for analysis {analysis.id} (location_id={analysis.location_id}), skipping.")
            continue

        file_path = os.path.join(NDVI_DIR, analysis.metrics_filename)
        if not os.path.exists(file_path):
            print(f"[ERROR] Metrics file not found: {file_path}")
            analysis.per_metrics_status = False
            db.commit()
            continue

        try:
            with xr.open_dataset(file_path) as ds:
                print(f"[DEBUG] Opened dataset: {file_path}")
                print(f"[DEBUG] Variables: {list(ds.data_vars)}")
                print(f"[DEBUG] Coords: {dict(ds.coords)}")
                print(f"[DEBUG] x range: {float(ds.x.min())} — {float(ds.x.max())}")
                print(f"[DEBUG] y range: {float(ds.y.min())} — {float(ds.y.max())}")

                ds = ds.rio.set_spatial_dims(x_dim="x", y_dim="y")

                ds = ds.rio.set_spatial_dims(x_dim="x", y_dim="y")

                if not ds.rio.crs:
                    if "spatial_ref" in ds:
                        crs_wkt = ds["spatial_ref"].attrs.get("crs_wkt")
                        proj4 = ds["spatial_ref"].attrs.get("proj4")
                        crs_str = crs_wkt or proj4
                        if crs_str:
                            ds = ds.rio.write_crs(crs_str)
                            print(f"[DEBUG] CRS restored from spatial_ref attrs")

                    if not ds.rio.crs:
                        x_val = float(ds.x.mean())
                        assumed_crs = "EPSG:4326" if abs(x_val) <= 180 else "EPSG:32634"
                        print(f"[WARNING] No CRS in file, using {assumed_crs}")
                        ds = ds.rio.write_crs(assumed_crs)

                raster_crs = ds.rio.crs
                print(f"[DEBUG] CRS: {raster_crs}")

                all_results = []

                for field in fields:
                    prepared_geom = gpd.GeoSeries(
                        [wkb.loads(bytes(field.geometry.data))],
                        crs="EPSG:4326"
                    ).to_crs(raster_crs)

                    print(f"[DEBUG] Field {field.id} bounds: {prepared_geom.total_bounds}")

                    results = calculate_per_field_metrics(
                        field=field,
                        ds=ds,
                        nc_filename=analysis.metrics_filename,
                        timestamp=analysis.last_data_request_date,
                        prepared_geom=prepared_geom
                    )
                    all_results.extend(results)

                if all_results:
                    db.add_all(all_results)

                analysis.per_metrics_status = True
                db.commit()
                print(f"[SUCCESS] Per-field metrics for analysis {analysis.id} completed.")

        except Exception as e:
            db.rollback()
            print(f"[ERROR] Error processing analysis {analysis.id}: {e}")
            analysis = db.query(FieldAnalysis).filter(
                FieldAnalysis.id == task["analysis_id"]
            ).first()
            if analysis:
                analysis.per_metrics_status = False
                db.commit()


def calculate_per_field_metrics(field, ds, nc_filename, timestamp, prepared_geom):
    try:
        results_to_insert = []
        SKIP_VARS = {"spatial_ref", "crs", "grid_mapping"}
        for var in ds.data_vars:
            if var in SKIP_VARS:
                continue
            try:
                da = ds[var]

                clipped = da.rio.set_spatial_dims(
                    x_dim="x", y_dim="y"
                ).rio.clip(
                    prepared_geom.geometry,
                    prepared_geom.crs,
                    drop=True,
                    all_touched=True
                )

                values = clipped.values.flatten()
                values = values[np.isfinite(values)]

                if values.size == 0:
                    print(f"[WARNING] No finite values for var={var}, field={field.id} — поле может не перекрываться с растром")
                    continue

                results_to_insert.append(FieldData(
                    field_id=field.id,
                    timestamp=timestamp,
                    metric_type=var,
                    mean_metric=float(np.mean(values)),
                    min_metric=float(np.min(values)),
                    max_metric=float(np.max(values)),
                    std_metric=float(np.std(values)),
                    extra={"count": int(values.size), "source_file": nc_filename}
                ))

            except Exception as e:
                print(f"[ERROR] var={var} in field={field.id}: {e}")

        return results_to_insert

    except Exception as e:
        print(f"[ERROR] calculate_per_field_metrics failed for field={field.id}: {e}")
        return []