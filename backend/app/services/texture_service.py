"""
GLCM texture metrics — additive pipeline stage.

For each scene whose NDVI metrics already exist, compute per-pixel GLCM
energy / contrast / homogeneity on the NDVI map (sentinel_processor.texture),
save a ``texture_<metrics_file>`` raster, and store per-field aggregates as
FieldData rows with metric_type ``glcm_energy`` / ``glcm_homogeneity`` /
``glcm_contrast`` (contrast normalised to [0, 1] to fit Numeric(6,4)).

This adds rows to the existing FieldData table only — no schema change. Progress
is tracked in FieldAnalysis.results_json['texture_status'] so the stage is
idempotent and re-runnable. Entirely guarded: any failure is logged and skipped,
never raised, so it cannot break the orchestrator's full_sync_process.
"""

from __future__ import annotations

import os
import logging

import numpy as np
import xarray as xr
import rioxarray  # noqa: F401  (registers the .rio accessor)
import geopandas as gpd
from shapely import wkb
from sqlalchemy import and_
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import NDVI_DIR
from app.core.database import FieldAnalysis, FieldUnit, FieldData
from app.services import sentinel_texture_engine

logger = logging.getLogger(__name__)

# (texture variable in the dataset, FieldData.metric_type) pairs to persist.
_FIELD_METRICS = [
    ("energy", "glcm_energy"),
    ("homogeneity", "glcm_homogeneity"),
    ("contrast_norm", "glcm_contrast"),
]


def _resolve_crs(ds: xr.Dataset, da: xr.DataArray):
    """Best-effort CRS resolution, mirroring the rest of the pipeline."""
    da = da.rio.set_spatial_dims(x_dim="x", y_dim="y")
    if da.rio.crs:
        return da.rio.crs
    if "spatial_ref" in ds:
        crs_str = ds["spatial_ref"].attrs.get("crs_wkt") or ds["spatial_ref"].attrs.get("proj4")
        if crs_str:
            return da.rio.write_crs(crs_str).rio.crs
    x_val = float(ds.x.mean())
    return da.rio.write_crs("EPSG:4326" if abs(x_val) <= 180 else "EPSG:32634").rio.crs


def _pending_analyses(db: Session) -> list[FieldAnalysis]:
    rows = (
        db.query(FieldAnalysis)
        .filter(
            and_(
                FieldAnalysis.metrics_status == True,  # noqa: E712
                FieldAnalysis.metrics_filename.isnot(None),
            )
        )
        .all()
    )
    return [a for a in rows if not (a.results_json or {}).get("texture_status")]


def _aggregate_per_field(
    tex_ds: xr.Dataset,
    fields: list[FieldUnit],
    raster_crs,
    nodata: float,
    timestamp,
    source_file: str,
) -> list[FieldData]:
    rows: list[FieldData] = []
    for field in fields:
        try:
            geom = gpd.GeoSeries(
                [wkb.loads(bytes(field.geometry.data))], crs="EPSG:4326"
            ).to_crs(raster_crs)

            for var, metric_type in _FIELD_METRICS:
                clipped = (
                    tex_ds[var]
                    .rio.set_spatial_dims(x_dim="x", y_dim="y")
                    .rio.clip(geom.geometry, geom.crs, drop=True, all_touched=True)
                )
                vals = clipped.values.flatten()
                vals = vals[np.isfinite(vals)]
                vals = vals[vals > nodata + 1.0]
                if vals.size == 0:
                    continue

                rows.append(
                    FieldData(
                        field_id=field.id,
                        timestamp=timestamp,
                        metric_type=metric_type,
                        mean_metric=float(np.mean(vals)),
                        min_metric=float(np.min(vals)),
                        max_metric=float(np.max(vals)),
                        std_metric=float(np.std(vals)),
                        extra={"count": int(vals.size), "source_file": source_file},
                    )
                )
        except Exception as exc:
            logger.warning("[texture] field=%s skipped: %s", field.id, exc)
    return rows


def run_texture_metrics(db: Session) -> None:
    if not sentinel_texture_engine.is_enabled():
        logger.info("[texture] engine disabled; skipping texture stage.")
        return

    pending = _pending_analyses(db)
    if not pending:
        logger.info("[texture] no scenes pending texture computation.")
        return

    logger.info("[texture] %d scenes to process.", len(pending))
    nodata = sentinel_texture_engine.nodata_value()

    for analysis in pending:
        path = os.path.join(NDVI_DIR, analysis.metrics_filename)
        if not os.path.exists(path):
            logger.warning("[texture] metrics file missing: %s", path)
            continue

        try:
            with xr.open_dataset(path) as ds:
                var_name = "ndvi" if "ndvi" in ds.data_vars else None
                if var_name is None:
                    candidates = [v for v in ds.data_vars if v not in ("spatial_ref", "crs")]
                    if not candidates:
                        logger.warning("[texture] no usable variable in %s", path)
                        continue
                    var_name = candidates[0]

                ndvi_da = ds[var_name]
                raster_crs = _resolve_crs(ds, ndvi_da)

                maps = sentinel_texture_engine.compute_texture(ndvi_da.values)

                tex_ds = xr.Dataset(
                    {
                        "energy": (["y", "x"], maps["energy"]),
                        "contrast": (["y", "x"], maps["contrast"]),
                        "homogeneity": (["y", "x"], maps["homogeneity"]),
                        "contrast_norm": (["y", "x"], maps["contrast_norm"]),
                    },
                    coords={"y": ds.coords["y"], "x": ds.coords["x"]},
                )
                tex_ds = tex_ds.rio.set_spatial_dims(x_dim="x", y_dim="y").rio.write_crs(raster_crs)

                out_name = f"texture_{analysis.metrics_filename}"
                tex_ds.to_netcdf(os.path.join(NDVI_DIR, out_name))

                fields = (
                    db.query(FieldUnit)
                    .filter(
                        FieldUnit.location_id == analysis.location_id,
                        FieldUnit.status == "active",
                    )
                    .all()
                )
                rows = _aggregate_per_field(
                    tex_ds, fields, raster_crs, nodata,
                    analysis.last_data_request_date, out_name,
                )
                if rows:
                    db.add_all(rows)

            results = dict(analysis.results_json or {})
            results["texture_status"] = True
            results["texture_filename"] = out_name
            analysis.results_json = results
            flag_modified(analysis, "results_json")
            db.commit()
            logger.info(
                "[texture] analysis %s done: %s rows, saved %s",
                analysis.id, len(rows), out_name,
            )

        except Exception as exc:
            db.rollback()
            logger.error("[texture] analysis %s failed: %s", analysis.id, exc, exc_info=True)
