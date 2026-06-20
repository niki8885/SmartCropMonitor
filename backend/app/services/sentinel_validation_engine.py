"""
In-process SCL cloud/snow validation backed by the `sentinel_processor` package.

Primary replacement for the Haskell `field-stats` config=2 endpoint. The package's
Fortran `validate_scl` is a line-for-line port of haskell-service/src/Validation.hs
(same filtered classes 0/6, same bad-pixel set 3/8/9/10, same snow class 11, and the
identical confidence ladder <0.1->1.0 / <0.3->0.75 / <0.4->0.5 / else 0). So the
returned ``confidence_score`` / ``cloud_ratio`` / ``snow_ratio`` match the Haskell
service bit-for-bit, and the downstream gating (``is_valid >= QUALITY_THRESHOLD_NDVI``)
is unchanged.

The package does not return the Haskell ``quality_report`` string, so it is synthesised
here in the same format. Best-effort: any failure raises (or is_enabled() returns False)
so the caller can fall back to the Haskell path. The pipeline never breaks because of
this module.
"""

from __future__ import annotations

import logging

import numpy as np
import xarray as xr

from app.core.config import SENTINEL_VALIDATION_ENGINE_ENABLED

logger = logging.getLogger(__name__)

ENGINE_NAME = "sentinel_processor"

# Cached lazy handle to the Fortran SCL kernel; None until first probe,
# False if it could not be loaded.
_validate_scl = None  # type: ignore[var-annotated]


def _load_kernel():
    """Import and cache ``call_validate_scl``; return it, or False if unavailable."""
    global _validate_scl
    if _validate_scl is not None:
        return _validate_scl
    try:
        from sentinel_processor.validation._fortran_bridge import call_validate_scl

        _validate_scl = call_validate_scl
        logger.info("[sentinel_validation] Fortran SCL kernel loaded; engine active.")
    except Exception as exc:  # ImportError, FileNotFoundError, OSError, …
        _validate_scl = False
        logger.warning(
            "[sentinel_validation] sentinel_processor unavailable (%s); "
            "falling back to Haskell validation service.", exc,
        )
    return _validate_scl


def is_enabled() -> bool:
    """True when the engine is both feature-flagged on and actually usable."""
    if not SENTINEL_VALIDATION_ENGINE_ENABLED:
        return False
    return bool(_load_kernel())


def _load_scl_values(mask_path: str) -> list[int]:
    """Load the SCL mask exactly as the legacy Haskell path did: flatten, drop
    NaN/None, cast to int — so the kernel receives identical input."""
    with xr.open_dataset(mask_path) as mds:
        flat = mds.to_array().values.flatten().astype(float)
    return [int(v) for v in flat if v is not None and not np.isnan(v)]


def _quality_report(cloud_ratio: float, snow_ratio: float, issues: list[str]) -> str:
    """Reproduce the Haskell ``quality_report`` string format."""
    if not issues:
        return (
            f"Validation passed. Cloud: {cloud_ratio * 100}%, "
            f"Snow: {snow_ratio * 100}%"
        )
    return "Issues detected. " + " ".join(issues)


def validate_scl_mask(mask_path: str, threshold: float = 0.3) -> dict:
    """Validate an SCL mask file in-process.

    Returns the same dict shape the Haskell service returned
    (``confidence_score``, ``quality_report``, ``cloud_ratio``, ``snow_ratio``,
    ``water_excluded``, ``issues``) so the caller is unchanged.

    Raises RuntimeError if the kernel is unavailable.
    """
    kernel = _load_kernel()
    if not kernel:
        raise RuntimeError("sentinel_processor validation kernel is not available")

    scl_values = _load_scl_values(mask_path)

    if not scl_values:
        # Mirror the Fortran/Haskell empty-input branch without poking ctypes
        # with a zero-length array.
        issues = ["No valid pixels after filtering"]
        return {
            "confidence_score": 0.0,
            "cloud_ratio": 0.0,
            "snow_ratio": 0.0,
            "water_excluded": True,
            "issues": issues,
            "quality_report": _quality_report(0.0, 0.0, issues),
        }

    res = kernel(scl_values, threshold)
    res["quality_report"] = _quality_report(
        res["cloud_ratio"], res["snow_ratio"], res["issues"]
    )
    return res
