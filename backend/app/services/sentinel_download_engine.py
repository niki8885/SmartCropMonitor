"""
Sentinel-2 download via the `sentinel_processor` package (opt-in, default OFF).

The package fetches bands in parallel and validates scenes with Fortran kernels.
This engine drives it per location, then translates its output into the *exact*
file layout and naming the existing pipeline depends on:

* spectral scene  -> DATA_DIR/user_{uid}_loc_{lid}_{ts}.nc
                     (band-stacked DataArray '__xarray_dataarray_variable__',
                      band coord == REQUIRED_BANDS — identical to the manual path)
* scl/aot/wvp     -> MASK_DIR/{layer}_{base}.nc
* visual          -> VIS_DIR/vis_{base}.tif
* one FieldAnalysis row per new scene

``SpectralBands.ALL`` equals REQUIRED_BANDS and ``LocationSpec(name=...)`` makes
the package base_name equal the legacy base_name, so the contract matches.

Validation is left OFF at download time (validate=False): the separate
validate_pending_analyses stage still gates scenes, exactly as before. Any
failure raises so the orchestrator can fall back to the manual downloader.

NOTE: requires a live STAC smoke test before enabling in production.
"""

from __future__ import annotations

import os
import shutil
import datetime
import logging

from geoalchemy2.shape import to_shape
from sqlalchemy.orm import Session

from app.core.config import (
    SENTINEL_DOWNLOAD_ENGINE_ENABLED,
    SENTINEL_DOWNLOAD_LOOKBACK_DAYS,
    SENTINEL_DOWNLOAD_KEEP_ITEMS,
    DATA_DIR,
    MASK_DIR,
    VIS_DIR,
    CACHE_DIR,
)
from app.core.database import UserLocation, FieldAnalysis

logger = logging.getLogger(__name__)

ENGINE_NAME = "sentinel_processor"

_STAGING = os.path.join(CACHE_DIR, "sentinel_dl")
_BBOX_HALF_DEG = 0.05

_available = None  # type: ignore[var-annotated]


def _probe():
    """Cache whether the package downloader is importable."""
    global _available
    if _available is not None:
        return _available
    try:
        import sentinel_processor.input.downloader  # noqa: F401

        _available = True
        logger.info("[sentinel_download] package downloader available.")
    except Exception as exc:
        _available = False
        logger.warning("[sentinel_download] package unavailable (%s).", exc)
    return _available


def is_enabled() -> bool:
    if not SENTINEL_DOWNLOAD_ENGINE_ENABLED:
        return False
    return bool(_probe())


def _move(src: str, dst: str) -> None:
    if not os.path.exists(src):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.replace(src, dst)  # atomic within one filesystem
    except OSError:
        shutil.move(src, dst)


def _parse_timestamp(base_name: str) -> datetime.datetime | None:
    try:
        return datetime.datetime.strptime(base_name.rsplit("_", 1)[-1], "%Y%m%dT%H%M%S")
    except Exception:
        return None


def _ingest_scene(db: Session, loc: UserLocation, base_name: str) -> bool:
    """Move one downloaded scene into the legacy layout and create its row."""
    spectral_nc = os.path.join(_STAGING, "spectral", base_name + ".nc")
    if not os.path.exists(spectral_nc):
        logger.warning("[sentinel_download] spectral nc missing for %s", base_name)
        return False

    nc_filename = base_name + ".nc"

    already = (
        db.query(FieldAnalysis.id)
        .filter(FieldAnalysis.nc_filename == nc_filename)
        .first()
    )
    if already or os.path.exists(os.path.join(DATA_DIR, nc_filename)):
        logger.debug("[sentinel_download] scene already present: %s", nc_filename)
        return False

    _move(spectral_nc, os.path.join(DATA_DIR, nc_filename))

    # SCL / AOT / WVP technical layers
    mask_filename = None
    for layer in ("scl", "aot", "wvp"):
        src = os.path.join(_STAGING, "technical", f"{layer}_{base_name}.nc")
        if os.path.exists(src):
            dst_name = f"{layer}_{base_name}.nc"
            _move(src, os.path.join(MASK_DIR, dst_name))
            if layer == "scl":
                mask_filename = dst_name

    # Visual true-colour
    vis_src = os.path.join(_STAGING, "visual", f"vis_{base_name}.tif")
    if os.path.exists(vis_src):
        _move(vis_src, os.path.join(VIS_DIR, f"vis_{base_name}.tif"))

    timestamp = _parse_timestamp(base_name) or datetime.datetime.utcnow()
    db.add(
        FieldAnalysis(
            location_id=loc.id,
            nc_filename=nc_filename,
            mask_filename=mask_filename,
            last_data_request_date=timestamp,
        )
    )
    db.commit()
    logger.info("[sentinel_download] ingested %s", base_name)
    return True


def download_all(db: Session) -> int:
    """Download Sentinel-2 scenes for every location via the package.

    Returns the number of new scenes ingested. Raises on a hard failure so the
    caller can fall back to the manual downloader.
    """
    from sentinel_processor.input.downloader import download_sentinel2, DownloadConfig
    from sentinel_processor.utils.data_utils import (
        LocationSpec, SpectralBands, TechnicalLayers,
    )

    os.makedirs(_STAGING, exist_ok=True)
    locations = db.query(UserLocation).all()
    ingested = 0

    try:
        for loc in locations:
            try:
                point = to_shape(loc.location)
                lon, lat = point.x, point.y
                spec = LocationSpec(lon=lon, lat=lat, name=f"user_{loc.user_id}_loc_{loc.id}")
                cfg = DownloadConfig(
                    bands=SpectralBands.ALL,           # == REQUIRED_BANDS
                    tech_bands=TechnicalLayers.ALL,    # scl + aot + wvp
                    visual=True,
                    output_dir=_STAGING,
                    bbox_half_deg=_BBOX_HALF_DEG,
                    lookback_days=SENTINEL_DOWNLOAD_LOOKBACK_DAYS,
                    keep_items=SENTINEL_DOWNLOAD_KEEP_ITEMS,
                    validate=False,                    # gating stays in validate_pending_analyses
                    save_report=False,
                )
                results = download_sentinel2([spec], cfg=cfg, progress=False)
                for base_name in results:
                    try:
                        if _ingest_scene(db, loc, base_name):
                            ingested += 1
                    except Exception as scene_exc:
                        db.rollback()
                        logger.error(
                            "[sentinel_download] ingest failed for %s: %s",
                            base_name, scene_exc, exc_info=True,
                        )
            except Exception as loc_exc:
                db.rollback()
                logger.error(
                    "[sentinel_download] location %s failed: %s",
                    loc.id, loc_exc, exc_info=True,
                )
    finally:
        shutil.rmtree(_STAGING, ignore_errors=True)

    logger.info("[sentinel_download] done: %d new scene(s) ingested.", ingested)
    return ingested
