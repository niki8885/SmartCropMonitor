"""
Per-field phenology via the `sentinel_processor` package.

Additive capability. Wraps ``analysis.phenology_metrics`` to extract TIMESAT-style
SOS / EOS / peak from a single field's NDVI time series. The package operates on
an ``(n_times, rows, cols)`` cube, so a 1-D field series is passed as ``(n, 1, 1)``
and the scalar result is read back.

Offsets returned by the kernel are fractional days from ``dates[0]``; this adapter
converts them to calendar day-of-year (1–366) for storage and display.
"""

from __future__ import annotations

import datetime
import logging

import numpy as np

from app.core.config import SENTINEL_PHENOLOGY_ENABLED

logger = logging.getLogger(__name__)

ENGINE_NAME = "sentinel_processor"

_phenology = None  # type: ignore[var-annotated]
_NODATA = -9999.0


def _load_kernel():
    global _phenology, _NODATA
    if _phenology is not None:
        return _phenology
    try:
        from sentinel_processor.analysis._sentinel_stats_bridge import (
            phenology_metrics,
            NODATA,
        )

        _phenology = phenology_metrics
        _NODATA = float(NODATA)
        logger.info("[sentinel_phenology] phenology kernel loaded; engine active.")
    except Exception as exc:
        _phenology = False
        logger.warning(
            "[sentinel_phenology] sentinel_processor analysis unavailable (%s); "
            "phenology disabled.", exc,
        )
    return _phenology


def is_enabled() -> bool:
    if not SENTINEL_PHENOLOGY_ENABLED:
        return False
    return bool(_load_kernel())


def _to_doy(offset: float, day0: datetime.datetime) -> int | None:
    if offset <= _NODATA + 1.0:
        return None
    return (day0 + datetime.timedelta(days=float(offset))).timetuple().tm_yday


def compute_field_phenology(
    values: list[float],
    dates: list[datetime.datetime],
    min_obs: int = 5,
) -> dict | None:
    """Compute phenology for one field's NDVI series.

    Returns ``{"sos_doy", "eos_doy", "peak_doy", "peak_val", "n_obs"}`` (DOY as
    ints or None, peak_val as float), or ``None`` when there are too few
    observations or no detectable season.

    Raises RuntimeError if the kernel is unavailable.
    """
    kernel = _load_kernel()
    if not kernel:
        raise RuntimeError("sentinel_processor phenology kernel is not available")

    n = len(values)
    if n < min_obs or n != len(dates):
        return None

    arr = np.asarray(values, dtype=np.float64)
    arr[~np.isfinite(arr)] = _NODATA
    stack = arr.reshape(n, 1, 1)

    res = kernel(stack, list(dates), smooth=True, min_valid=min_obs)

    peak_val = float(np.asarray(res["peak_val"]).ravel()[0])
    if peak_val <= _NODATA + 1.0:
        return None

    day0 = dates[0]
    return {
        "sos_doy": _to_doy(float(np.asarray(res["sos_doy"]).ravel()[0]), day0),
        "eos_doy": _to_doy(float(np.asarray(res["eos_doy"]).ravel()[0]), day0),
        "peak_doy": _to_doy(float(np.asarray(res["peak_doy"]).ravel()[0]), day0),
        "peak_val": round(peak_val, 4),
        "n_obs": n,
    }
