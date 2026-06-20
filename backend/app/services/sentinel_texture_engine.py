"""
GLCM texture features via the `sentinel_processor` package.

Additive capability — does not replace any existing computation. Computes
per-pixel GLCM energy / contrast / homogeneity on a 2-D array (typically the
per-scene NDVI map). The package ships a Fortran kernel with a transparent NumPy
fallback, so this works even when the native texture library is absent.

Contrast is unbounded (up to ~(levels-1)^2 ≈ 3969 for the package's 64 levels),
which would overflow the FieldData Numeric(6,4) columns, so a normalised contrast
in [0, 1] is also exposed for storage; the raw value stays available for callers
that want it.
"""

from __future__ import annotations

import logging

import numpy as np

from app.core.config import (
    SENTINEL_TEXTURE_ENGINE_ENABLED,
    SENTINEL_TEXTURE_WINDOW,
    SENTINEL_TEXTURE_DISTANCE,
    SENTINEL_TEXTURE_ANGLE,
)

logger = logging.getLogger(__name__)

ENGINE_NAME = "sentinel_processor"

# GLCM contrast normaliser: the package quantises to 64 levels, so the maximum
# possible (i-j)^2 weight is (64-1)^2.
_GLCM_LEVELS = 64
CONTRAST_NORM = float((_GLCM_LEVELS - 1) ** 2)

_compute_glcm = None  # type: ignore[var-annotated]
_NODATA = None  # type: ignore[var-annotated]


def _load_kernel():
    """Import and cache compute_glcm + NODATA; return the callable or False."""
    global _compute_glcm, _NODATA
    if _compute_glcm is not None:
        return _compute_glcm
    try:
        from sentinel_processor.texture import compute_glcm, NODATA

        _compute_glcm = compute_glcm
        _NODATA = NODATA
        logger.info("[sentinel_texture] GLCM kernel loaded; engine active.")
    except Exception as exc:
        _compute_glcm = False
        logger.warning(
            "[sentinel_texture] sentinel_processor texture unavailable (%s); "
            "texture features disabled.", exc,
        )
    return _compute_glcm


def is_enabled() -> bool:
    """True when texture features are flagged on and the package is importable."""
    if not SENTINEL_TEXTURE_ENGINE_ENABLED:
        return False
    return bool(_load_kernel())


def nodata_value() -> float:
    """The sentinel value the GLCM maps use for border / invalid pixels."""
    _load_kernel()
    return float(_NODATA) if _NODATA is not None else -9999.0


def compute_texture(
    arr: np.ndarray,
    window: int | None = None,
    distance: int | None = None,
    angle: int | None = None,
) -> dict[str, np.ndarray]:
    """Compute GLCM texture maps for a 2-D array.

    Returns ``{"energy", "contrast", "homogeneity", "contrast_norm"}`` as 2-D
    arrays the same shape as ``arr``. Border / invalid pixels carry the package
    NODATA sentinel. ``contrast_norm`` is contrast / (levels-1)^2, clipped to
    [0, 1], safe for Numeric(6,4) storage.

    Raises RuntimeError if the kernel is unavailable.
    """
    kernel = _load_kernel()
    if not kernel:
        raise RuntimeError("sentinel_processor texture kernel is not available")

    out = kernel(
        np.asarray(arr, dtype=np.float64),
        window=SENTINEL_TEXTURE_WINDOW if window is None else window,
        distance=SENTINEL_TEXTURE_DISTANCE if distance is None else distance,
        angle=SENTINEL_TEXTURE_ANGLE if angle is None else angle,
    )

    contrast = out["contrast"]
    valid = contrast > (nodata_value() + 1.0)
    contrast_norm = np.full(contrast.shape, nodata_value(), dtype=np.float64)
    contrast_norm[valid] = np.clip(contrast[valid] / CONTRAST_NORM, 0.0, 1.0)
    out["contrast_norm"] = contrast_norm
    return out
