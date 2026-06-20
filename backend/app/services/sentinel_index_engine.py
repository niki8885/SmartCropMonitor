"""
In-process spectral-index engine backed by the `sentinel_processor` package.

This is the primary replacement for the Haskell `field-stats` microservice.
It computes the same five per-scene metrics the Haskell service produced
(ndvi, gndvi, ndre, ndwi, nmdi) using the *same* normalized-difference
formulas, but in-process via compiled Fortran kernels — no JSON serialization,
no network round-trip.

Formula parity with haskell-service/src/Stats.hs:

    ndvi  = (nir - red)               / (nir + red)
    gndvi = (nir - green)             / (nir + green)
    ndre  = (nir - rededge2)          / (nir + rededge2)
    ndwi  = (nir - swir16)            / (nir + swir16)
    nmdi  = (nir - (swir16 - swir22)) / (nir + (swir16 - swir22))

All five are normalized differences, so each is computed with the package's
generic ND kernel (`compute_ndvi`); `nmdi` uses the (swir16 - swir22)
difference band as the second operand. This reproduces the Haskell output
bit-for-bit while running entirely in-process.

The engine is intentionally *best-effort*: every public entry point is safe to
call and any failure (missing package, uncompiled Fortran library, bad data,
…) is surfaced as a raised exception or a False availability flag so the caller
can transparently fall back to the legacy Haskell path. The pipeline must never
break because of this module.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import xarray as xr

from app.core.config import (
    SENTINEL_INDEX_ENGINE_ENABLED,
    SENTINEL_DENOISE_METHOD,
    SENTINEL_DENOISE_RADIUS,
    SENTINEL_DENOISE_SIGMA,
    SENTINEL_DENOISE_SIGMA_S,
    SENTINEL_DENOISE_SIGMA_R,
)

logger = logging.getLogger(__name__)

# Engine identifier recorded on FieldAnalysis rows / logs.
ENGINE_NAME = "sentinel_processor"

# Bands required to compute the five metrics (canonical Sentinel-2 STAC names,
# matching app.core.config.REQUIRED_BANDS). Aliases let the engine tolerate
# files that label bands differently (e.g. raw "B08").
_REQUIRED = ("nir", "red", "green", "rededge2", "swir16", "swir22")

_BAND_ALIASES: dict[str, tuple[str, ...]] = {
    "nir": ("nir", "B08", "b08"),
    "red": ("red", "B04", "b04"),
    "green": ("green", "B03", "b03"),
    "rededge2": ("rededge2", "red_edge2", "B06", "b06"),
    "swir16": ("swir16", "swir1", "B11", "b11"),
    "swir22": ("swir22", "swir2", "B12", "b12"),
}

# Cached lazy handle to the Fortran ND kernel; None until first probe,
# False if the kernel could not be loaded.
_compute_nd = None  # type: ignore[var-annotated]


def _load_kernel():
    """Import and cache the Fortran normalized-difference kernel.

    Returns the callable, or False if the package / native library is
    unavailable. Never raises.
    """
    global _compute_nd
    if _compute_nd is not None:
        return _compute_nd
    try:
        # Importing the bridge triggers loading of libsentinel_indices.{dll,so};
        # a missing library raises here and we degrade to the fallback path.
        from sentinel_processor.indices._indices_bridge import compute_ndvi

        _compute_nd = compute_ndvi
        logger.info("[sentinel_engine] Fortran ND kernel loaded; engine active.")
    except Exception as exc:  # ImportError, FileNotFoundError, OSError, …
        _compute_nd = False
        logger.warning(
            "[sentinel_engine] sentinel_processor unavailable (%s); "
            "falling back to Haskell field-stats service.", exc,
        )
    return _compute_nd


def is_enabled() -> bool:
    """True when the engine is both feature-flagged on and actually usable."""
    if not SENTINEL_INDEX_ENGINE_ENABLED:
        return False
    return bool(_load_kernel())


def denoise_enabled() -> bool:
    """True when an opt-in pre-index denoise method is configured."""
    return SENTINEL_DENOISE_METHOD not in ("", "off", "none", "0", "false")


def _denoise_band(arr: np.ndarray) -> np.ndarray:
    """NaN-safe per-band denoise via sentinel_processor filters.

    Returns ``arr`` unchanged on any failure (denoise is a best-effort quality
    step, never a correctness dependency). Nodata pixels are filled with the
    band median before filtering and restored to NaN afterwards so holes never
    spread into valid data.
    """
    method = SENTINEL_DENOISE_METHOD
    try:
        from sentinel_processor.filters import apply_filter

        shape = arr.shape
        bad = ~np.isfinite(arr)
        if bad.any():
            fill = float(np.nanmedian(arr)) if np.isfinite(arr).any() else 0.0
            work = np.where(bad, fill, arr)
        else:
            work = arr

        if method == "median":
            out = apply_filter(work, "median", radius=SENTINEL_DENOISE_RADIUS)
        elif method == "gaussian":
            out = apply_filter(work, "gaussian", sigma=SENTINEL_DENOISE_SIGMA)
        elif method == "bilateral":
            finite = work[np.isfinite(work)]
            if finite.size:
                lo, hi = np.percentile(finite, [2, 98])
                rng = max(float(hi - lo), 1e-6)
            else:
                rng = 1.0
            out = apply_filter(
                work, "bilateral",
                sigma_s=SENTINEL_DENOISE_SIGMA_S,
                sigma_r=SENTINEL_DENOISE_SIGMA_R * rng,
            )
        else:
            logger.warning("[sentinel_engine] unknown denoise method '%s'; skipping.", method)
            return arr

        out = np.asarray(out, dtype=np.float64).reshape(shape)
        if bad.any():
            out[bad] = np.nan
        return out
    except Exception as exc:
        logger.warning("[sentinel_engine] denoise (%s) failed: %s; using raw band.", method, exc)
        return arr


def _extract_band(data_array: xr.DataArray, name: str) -> np.ndarray:
    """Select a single band by canonical name (or alias) as a 2-D float64 array."""
    coords = [str(v) for v in data_array.coords["band"].values]
    for candidate in _BAND_ALIASES.get(name, (name,)):
        if candidate in coords:
            return data_array.sel(band=candidate).values.astype(np.float64)
    raise KeyError(
        f"Band '{name}' not found in scene (available: {coords})"
    )


def compute_metrics(data_array: xr.DataArray) -> dict[str, list]:
    """Compute the five field metrics for one scene.

    Parameters
    ----------
    data_array:
        A Sentinel-2 spectral cube with a ``band`` coordinate carrying the
        canonical band names (nir, red, green, rededge2, swir16, swir22).

    Returns
    -------
    dict
        ``{"ndvi_map", "gndvi_map", "ndre_map", "ndwi_map", "nmdi_map"}`` →
        2-D ``numpy.ndarray`` (y, x). The keys and shape mirror the Haskell
        service response so the downstream NetCDF builder is unchanged.

    Raises
    ------
    RuntimeError
        If the Fortran kernel is unavailable.
    KeyError
        If a required band is missing from the scene.
    """
    kernel = _load_kernel()
    if not kernel:
        raise RuntimeError("sentinel_processor Fortran kernel is not available")

    bands = {name: _extract_band(data_array, name) for name in _REQUIRED}

    # Optional, opt-in denoise before indices (off by default -> byte parity).
    if denoise_enabled():
        bands = {name: _denoise_band(arr) for name, arr in bands.items()}

    shape = bands["nir"].shape

    def nd(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        # Fortran kernel returns a flat float64 vector; restore the 2-D grid.
        return kernel(a, b).reshape(shape)

    swir_diff = bands["swir16"] - bands["swir22"]

    return {
        "ndvi_map": nd(bands["nir"], bands["red"]),
        "gndvi_map": nd(bands["nir"], bands["green"]),
        "ndre_map": nd(bands["nir"], bands["rededge2"]),
        "ndwi_map": nd(bands["nir"], bands["swir16"]),
        "nmdi_map": nd(bands["nir"], swir_diff),
    }
