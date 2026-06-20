import os
import httpx

STORAGE_PATH = os.path.join("data", "storage")

DATA_DIR = os.path.join(STORAGE_PATH, "data")
MASK_DIR = os.path.join(STORAGE_PATH, "masks")
SEGM_DIR = os.path.join(STORAGE_PATH, "segmentation")
GRID_DIR = os.path.join(STORAGE_PATH, "grid")
VIS_DIR = os.path.join(STORAGE_PATH, "visual")
NDVI_DIR = os.path.join(STORAGE_PATH, "ndvi")
TOPO_DIR = os.path.join(STORAGE_PATH, "topo")
WEATHER_DIR = os.path.join(STORAGE_PATH, "weather")
CACHE_DIR = os.path.join(STORAGE_PATH, "cache")
TEMP_DIR = os.path.join(STORAGE_PATH, "temp")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MASK_DIR, exist_ok=True)
os.makedirs(SEGM_DIR, exist_ok=True)
os.makedirs(GRID_DIR, exist_ok=True)
os.makedirs(VIS_DIR, exist_ok=True)
os.makedirs(NDVI_DIR, exist_ok=True)
os.makedirs(TOPO_DIR, exist_ok=True)
os.makedirs(WEATHER_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

API_TITLE = "SmartCropMonitor API"
API_VERSION = "0.2.0"

REQUIRED_BANDS = [
    "blue", "green", "red", "nir",
    "rededge1", "rededge2", "rededge3",
    "nir08",
    "swir16", "swir22"
]

AUX_LAYERS = ["scl", "aot", "wvp"]

VISUAL_ASSET = "visual"
TARGET_BANDS = ["blue", "green", "red", "nir"]

QUALITY_THRESHOLD = 1
QUALITY_THRESHOLD_SEGM = 0.5
QUALITY_THRESHOLD_NDVI = 0.75
MIN_DIM = 128

STAC_API_URL = "https://earth-search.aws.element84.com/v1"
SQLALCHEMY_DATABASE_URL = os.getenv("SQLALCHEMY_DATABASE_URL")
HASKELL_URL = os.getenv("HASKELL_SERVICE_URL", "http://localhost:8081/field-stats")

MODEL_WEIGHTS = "app/models/unet_ai4boundaries.pth"
TEMP_MODEL_WEIGHTS = "app/models/utae_pastis.pth"
MODEL_PATH = os.path.join("app", "models", "unet_mitb2_ai4boundaries.pth")
TEMP_MODEL_PATH = os.path.join("app", "models", "utae_pastis.pth")
RANDOM_SEED = 28
MAX_SEGM_INPUT = 4
MIN_SEGM_INPUTS = 3

MIN_RECORDS_7D = 24 * 7 * 0.8
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")

CLEANUP_RETAIN_LATEST_DATASETS = int(os.getenv("CLEANUP_RETAIN_LATEST_DATASETS", 10))
CLEANUP_MIN_FILE_AGE_HOURS = float(os.getenv("CLEANUP_MIN_FILE_AGE_HOURS", 1))

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
HASKELL_SERVICE_URL = HASKELL_URL

Z_SCORE_THRESHOLD = 2.5
DELTA_SCORE_THRESHOLD = 2.5
DRIFT_SLOPE_THRESHOLD = 0.05
DRIFT_P_VALUE_THRESHOLD = 0.05
MIN_POINTS_FOR_ANALYSIS = 5
CONFIDENCE_SCALE = 0.95

SAT_METRICS = ["ndvi", "gndvi", "ndre"]
CONFIDENCE_HIGH     = 0.80
CONFIDENCE_CRITICAL = 0.95
DEFAULT_AREA_THRESHOLD_RATIO = 0.10
SMALL_FIELD_HA       = 5.0
SMALL_FIELD_RATIO    = 0.07

SENSOR_OFFLINE_INTERVAL_SAMPLE  = 10
SENSOR_OFFLINE_MULTIPLIER       = 10
SENSOR_OFFLINE_MIN_DELTA_MINUTES = 1

SMTP_HOST     = os.getenv("SMTP_HOST")
SMTP_PORT     = int(os.getenv("SMTP_PORT", 587))
SMTP_USER     = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
BRIEFING_FROM_EMAIL = os.getenv("BRIEFING_FROM_EMAIL", SMTP_USER)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# Deployment environment. In production the interactive API docs (Swagger /docs,
# ReDoc /redoc) and the OpenAPI schema (/openapi.json) are hidden so the API
# surface and database schema are not publicly exposed. Override with ENABLE_DOCS.
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
ENABLE_DOCS = _env_bool("ENABLE_DOCS", ENVIRONMENT != "production")


# Spectral-index engine. When enabled, per-scene field metrics
# (ndvi/gndvi/ndre/ndwi/nmdi) are computed in-process via the Fortran-backed
# `sentinel_processor` package instead of the Haskell field-stats microservice.
# The Haskell service stays as the automatic fallback whenever the package or
# its native libraries are unavailable, so the pipeline never breaks.
SENTINEL_INDEX_ENGINE_ENABLED = _env_bool("SENTINEL_INDEX_ENGINE_ENABLED", True)

# SCL cloud/snow validation via the sentinel_processor Fortran kernel (config=2
# replacement). The kernel is a line-for-line port of the Haskell validateSCL,
# so confidence/cloud/snow scoring is identical. Haskell stays as fallback.
SENTINEL_VALIDATION_ENGINE_ENABLED = _env_bool("SENTINEL_VALIDATION_ENGINE_ENABLED", True)

# Optional per-band denoising applied inside the index engine *before* indices
# are computed (sentinel_processor filters). Off by default so output stays
# byte-identical to the Haskell path; enabling it trades exact parity for fewer
# speckle-driven false anomalies. method: off | median | gaussian | bilateral.
# median/gaussian are value-scale invariant (bands are raw DN); bilateral's
# sigma_r is interpreted as a fraction of the band's p2–p98 range.
SENTINEL_DENOISE_METHOD = os.getenv("SENTINEL_DENOISE_METHOD", "off").strip().lower()
SENTINEL_DENOISE_RADIUS = int(os.getenv("SENTINEL_DENOISE_RADIUS", 1))
SENTINEL_DENOISE_SIGMA = float(os.getenv("SENTINEL_DENOISE_SIGMA", 1.0))
SENTINEL_DENOISE_SIGMA_S = float(os.getenv("SENTINEL_DENOISE_SIGMA_S", 2.0))
SENTINEL_DENOISE_SIGMA_R = float(os.getenv("SENTINEL_DENOISE_SIGMA_R", 0.1))

# GLCM texture features (sentinel_processor.texture). Additive: computes
# energy/contrast/homogeneity on the per-scene NDVI and stores per-field
# aggregates as FieldData rows (metric_type glcm_*). Has a NumPy fallback in the
# package, so it works even without the Fortran texture lib.
SENTINEL_TEXTURE_ENGINE_ENABLED = _env_bool("SENTINEL_TEXTURE_ENGINE_ENABLED", True)
SENTINEL_TEXTURE_WINDOW = int(os.getenv("SENTINEL_TEXTURE_WINDOW", 7))
SENTINEL_TEXTURE_DISTANCE = int(os.getenv("SENTINEL_TEXTURE_DISTANCE", 1))
SENTINEL_TEXTURE_ANGLE = int(os.getenv("SENTINEL_TEXTURE_ANGLE", -1))

# Per-field phenology (sentinel_processor.analysis). Additive: computes
# SOS/EOS/peak DOY + peak NDVI per field from its accumulated NDVI history and
# stores one FieldData row (metric_type='phenology'); DOYs live in extra JSON
# because they overflow Numeric(6,4), peak_val is the numeric column.
SENTINEL_PHENOLOGY_ENABLED = _env_bool("SENTINEL_PHENOLOGY_ENABLED", True)
SENTINEL_PHENOLOGY_LOOKBACK_DAYS = int(os.getenv("SENTINEL_PHENOLOGY_LOOKBACK_DAYS", 365))
SENTINEL_PHENOLOGY_MIN_OBS = int(os.getenv("SENTINEL_PHENOLOGY_MIN_OBS", 5))

# Sentinel-2 download via the sentinel_processor package (parallel band fetch).
# OPT-IN, default OFF: it changes how scenes are fetched, so it must be smoke-
# tested live before enabling. When on, the engine writes the identical file
# layout/naming the pipeline expects (DATA_DIR/MASK_DIR/VIS_DIR + FieldAnalysis
# rows); on any failure the orchestrator falls back to the manual downloader.
SENTINEL_DOWNLOAD_ENGINE_ENABLED = _env_bool("SENTINEL_DOWNLOAD_ENGINE_ENABLED", False)
SENTINEL_DOWNLOAD_LOOKBACK_DAYS = int(os.getenv("SENTINEL_DOWNLOAD_LOOKBACK_DAYS", 60))
SENTINEL_DOWNLOAD_KEEP_ITEMS = int(os.getenv("SENTINEL_DOWNLOAD_KEEP_ITEMS", 10))

ALERT_EMAIL_ENABLED = _env_bool("ALERT_EMAIL_ENABLED", True)
ALERT_FROM_EMAIL = os.getenv("ALERT_FROM_EMAIL", BRIEFING_FROM_EMAIL)
URGENT_ALERT_MIN_PRIORITY = os.getenv("URGENT_ALERT_MIN_PRIORITY", "HIGH").upper()
URGENT_ALERT_DUPLICATE_SUPPRESSION_HOURS = float(os.getenv("URGENT_ALERT_DUPLICATE_SUPPRESSION_HOURS", 12))
URGENT_ALERT_RATE_LIMIT_PER_HOUR = int(os.getenv("URGENT_ALERT_RATE_LIMIT_PER_HOUR", 6))
URGENT_ALERT_RETRY_MAX_ATTEMPTS = int(os.getenv("URGENT_ALERT_RETRY_MAX_ATTEMPTS", 3))
URGENT_ALERT_RETRY_BACKOFF_MINUTES = float(os.getenv("URGENT_ALERT_RETRY_BACKOFF_MINUTES", 5))
URGENT_ALERT_LOOKBACK_HOURS = float(os.getenv("URGENT_ALERT_LOOKBACK_HOURS", 48))

ALERT_FROST_TEMP_C = float(os.getenv("ALERT_FROST_TEMP_C", -2))
ALERT_HEAT_TEMP_C = float(os.getenv("ALERT_HEAT_TEMP_C", 35))
ALERT_HIGH_WIND_MPS = float(os.getenv("ALERT_HIGH_WIND_MPS", 20))
ALERT_HEAVY_RAIN_1H_MM = float(os.getenv("ALERT_HEAVY_RAIN_1H_MM", 15))
ALERT_HEAVY_RAIN_7D_MM = float(os.getenv("ALERT_HEAVY_RAIN_7D_MM", 70))
ALERT_DROUGHT_SPI = float(os.getenv("ALERT_DROUGHT_SPI", -1.5))
ALERT_SOIL_MOISTURE_MIN = float(os.getenv("ALERT_SOIL_MOISTURE_MIN", 0.08))
ALERT_SOIL_MOISTURE_MAX = float(os.getenv("ALERT_SOIL_MOISTURE_MAX", 0.45))
ALERT_SOIL_TEMP_MIN_C = float(os.getenv("ALERT_SOIL_TEMP_MIN_C", 2))
ALERT_SOIL_TEMP_MAX_C = float(os.getenv("ALERT_SOIL_TEMP_MAX_C", 35))
