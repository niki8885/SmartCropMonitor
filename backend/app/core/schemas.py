import enum
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class UserCreate(BaseModel):
    username: str
    password: str


class FieldType(str, enum.Enum):
    pasture = "pasture"
    crop = "crop"
    hayfield = "hayfield"

    orchard = "orchard"
    vineyard = "vineyard"
    berry_patch = "berry_patch"
    nursery = "nursery"

    greenhouse = "greenhouse"

    fallow = "fallow"
    fallow_land = "fallow_land"
    forest_belt = "forest_belt"
    storage = "storage"
    water_body = "water_body"

    other = "other"


class SensorCreate(BaseModel):
    label: str
    latitude: float
    longitude: float
    user_id: Optional[int] = None   # ignored — owner comes from the auth token
    meteorological: Optional[bool] = True

class SingleReading(BaseModel):
    ts: datetime  # ISO format: 2026-05-09T10:00:00
    t: Optional[float] = None # temperature
    p: Optional[float] = None # pressure
    h: Optional[float] = None # humidity
    extra: Optional[dict] = None

class SensorDataBatch(BaseModel):
    key: str
    data: List[SingleReading]

class SensorUpdate(BaseModel):
    label: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    meteorological: Optional[bool] = None
    activation_status: Optional[bool] = None


class FieldCrop(str, enum.Enum):
    WHEAT_WINTER = "WHEAT_WINTER"
    WHEAT_SPRING = "WHEAT_SPRING"
    BARLEY = "BARLEY"
    CORN = "CORN"
    OATS = "OATS"
    RYE = "RYE"
    RICE = "RICE"

    PEAS = "PEAS"
    SOYBEANS = "SOYBEANS"
    CHICKPEAS = "CHICKPEAS"
    LENTILS = "LENTILS"

    SUNFLOWER = "SUNFLOWER"
    RAPESEED_WINTER = "RAPESEED_WINTER"
    RAPESEED_SPRING = "RAPESEED_SPRING"
    FLAX = "FLAX"

    SUGAR_BEET = "SUGAR_BEET"
    POTATOES = "POTATOES"
    COTTON = "COTTON"

    ALFALFA = "ALFALFA"
    SILAGE_CORN = "SILAGE_CORN"
    CLOVER = "CLOVER"
    GRASS_MIX = "GRASS_MIX"

    APPLE = "APPLE"
    PEAR = "PEAR"
    CHERRY = "CHERRY"
    GRAPES_WINE = "GRAPES_WINE"
    GRAPES_TABLE = "GRAPES_TABLE"
    STRAWBERRY = "STRAWBERRY"
    BLUEBERRY = "BLUEBERRY"

    TOMATO = "TOMATO"
    ONION = "ONION"
    CARROT = "CARROT"
    CABBAGE = "CABBAGE"

    FALLOW = "FALLOW"
    COVER_CROP = "COVER_CROP"
    OTHER = "OTHER"


class FieldWorkType(str, enum.Enum):
    PLOWING = "PLOWING"
    SUBSOILING = "SUBSOILING"
    DISCING = "DISCING"
    HARROWING = "HARROWING"
    CULTIVATION = "CULTIVATION"
    ROLLING = "ROLLING"

    SOWING = "SOWING"
    PLANTING = "PLANTING"

    FERTILIZATION = "FERTILIZATION"
    SPRAYING = "SPRAYING"
    IRRIGATION = "IRRIGATION"
    WEEDING = "WEEDING"

    PRUNING = "PRUNING"
    GRAFTING = "GRAFTING"
    MULCHING = "MULCHING"
    THINNING = "THINNING"
    TRELLIS_REPAIR = "TRELLIS_REPAIR"

    MOWING = "MOWING"
    RAKING = "RAKING"
    BALING = "BALING"
    GRAZING = "GRAZING"

    HARVESTING = "HARVESTING"
    DESICCATION = "DESICCATION"

    SOIL_SAMPLING = "SOIL_SAMPLING"
    MAINTENANCE = "MAINTENANCE"


class FieldWorkStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PLANNED = "PLANNED"
    SCHEDULED = "SCHEDULED"

    ON_HOLD = "ON_HOLD"
    IN_PROGRESS = "IN_PROGRESS"

    COMPLETED = "COMPLETED"
    VERIFIED = "VERIFIED"

    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


class EventType(str, enum.Enum):
    FROST_HAZARD = "FROST_HAZARD"
    HEAT_STRESS = "HEAT_STRESS"
    HEAVY_RAIN = "HEAVY_RAIN"
    HAIL_STORM = "HAIL_STORM"
    HIGH_WIND = "HIGH_WIND"
    DROUGHT_WARNING = "DROUGHT_WARNING"
    LIGHTNING_STRIKE = "LIGHTNING_STRIKE"

    LOW_SOIL_MOISTURE = "LOW_SOIL_MOISTURE"
    HIGH_SOIL_MOISTURE = "HIGH_SOIL_MOISTURE"
    SOIL_TEMP_LOW = "SOIL_TEMP_LOW"
    SOIL_TEMP_HIGH = "SOIL_TEMP_HIGH"
    EC_LEVEL_HIGH = "EC_LEVEL_HIGH"
    PH_LEVEL_OUT_OF_RANGE = "PH_LEVEL_OUT_OF_RANGE"
    NPK_LEVEL_LOW = "NPK_LEVEL_LOW"

    NDVI_DROP = "NDVI_DROP"
    EVI_ANOMALY = "EVI_ANOMALY"
    PEST_OUTBREAK = "PEST_OUTBREAK"
    DISEASE_DETECTION = "DISEASE_DETECTION"
    WEED_INFESTATION = "WEED_INFESTATION"
    LODGING_DETECTED = "LODGING_DETECTED"
    METRIC_ANOMALY = "METRIC_ANOMALY"

    BOUNDARY_EXIT = "BOUNDARY_EXIT"
    OFF_TRACK_MOVEMENT = "OFF_TRACK_MOVEMENT"
    STUCK_EQUIPMENT = "STUCK_EQUIPMENT"
    FUEL_LEVEL_LOW = "FUEL_LEVEL_LOW"
    UNAUTHORIZED_ACCESS = "UNAUTHORIZED_ACCESS"

    SENSOR_OFFLINE = "SENSOR_OFFLINE"
    LOW_BATTERY = "LOW_BATTERY"
    GATEWAY_DISCONNECTED = "GATEWAY_DISCONNECTED"
    DATA_CORRUPTION = "DATA_CORRUPTION"
    API_ERROR = "API_ERROR"

    MANUAL_ALERT = "MANUAL_ALERT"
    OTHER = "OTHER"


class StatusType(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"
    ARCHIVED = "ARCHIVED"
    IGNORED = "IGNORED"


class Status_task(str, enum.Enum):
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    ON_HOLD = "ON_HOLD"
    REVIEW = "REVIEW"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class Priority_task(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AnomalyType(str, enum.Enum):
    OUT_OF_BOUNDS = "out_of_bounds"
    SUDDEN_CHANGE = "sudden_change"
    DATA_DRIFT = "data_drift"
    UNKNOWN = "unknown"


class RotationStatus(str, enum.Enum):
    PLANNED   = "PLANNED"
    GRAZING   = "GRAZING"
    RESTING   = "RESTING"
    COMPLETED = "COMPLETED"
    SKIPPED   = "SKIPPED"


class FertilizationMethod(str, enum.Enum):
    BROADCAST = "BROADCAST"
    INJECTION = "INJECTION"
    INCORPORATION = "INCORPORATION"
    FOLIAR = "FOLIAR"
    FERTIGATION = "FERTIGATION"
    BAND_PLACEMENT = "BAND_PLACEMENT"
    TOP_DRESSING = "TOP_DRESSING"
    SIDE_DRESSING = "SIDE_DRESSING"
    OTHER = "OTHER"


class PesticideTargetType(str, enum.Enum):
    PEST = "PEST"
    DISEASE = "DISEASE"
    WEED = "WEED"
    GROWTH = "GROWTH"
    OTHER = "OTHER"


class SeedTreatmentType(str, enum.Enum):
    NONE = "NONE"
    FUNGICIDE = "FUNGICIDE"
    INSECTICIDE = "INSECTICIDE"
    COMBINED = "COMBINED"
    BIOLOGICAL = "BIOLOGICAL"
    PELLETING = "PELLETING"
    OTHER = "OTHER"


class TillageType(str, enum.Enum):
    CONVENTIONAL = "CONVENTIONAL"
    MINIMUM = "MINIMUM"
    NO_TILL = "NO_TILL"
    STRIP_TILL = "STRIP_TILL"
    DEEP_LOOSENING = "DEEP_LOOSENING"


class HarvestQualityUnit(str, enum.Enum):
    PERCENT = "PERCENT"
    MG_KG = "MG_KG"
    KG_HL = "KG_HL"
    OTHER = "OTHER"


# =============================================================================
# Equipment / Machinery
# =============================================================================

class EquipmentType(str, enum.Enum):
    # Tillage
    TRACTOR          = "TRACTOR"
    PLOW             = "PLOW"
    DISC_HARROW      = "DISC_HARROW"
    CULTIVATOR       = "CULTIVATOR"
    SUBSOILER        = "SUBSOILER"
    ROLLER           = "ROLLER"

    # Sowing / planting
    SEEDER           = "SEEDER"
    TRANSPLANTER     = "TRANSPLANTER"
    POTATO_PLANTER   = "POTATO_PLANTER"

    # Crop care
    SPRAYER          = "SPRAYER"
    FERTILIZER_SPREADER = "FERTILIZER_SPREADER"
    IRRIGATION_SYSTEM   = "IRRIGATION_SYSTEM"
    MOWER            = "MOWER"
    BALER            = "BALER"
    RAKE             = "RAKE"

    # Harvest
    COMBINE_HARVESTER = "COMBINE_HARVESTER"
    FORAGE_HARVESTER  = "FORAGE_HARVESTER"
    GRAIN_CART        = "GRAIN_CART"
    TRAILER           = "TRAILER"

    # Transport / utility
    LOADER            = "LOADER"
    TELEHANDLER       = "TELEHANDLER"
    ATV               = "ATV"
    TRUCK             = "TRUCK"

    # Other
    DRONE             = "DRONE"
    OTHER             = "OTHER"


class EquipmentStatus(str, enum.Enum):
    OPERATIONAL   = "OPERATIONAL"   # ready to work
    IN_USE        = "IN_USE"        # currently deployed
    MAINTENANCE   = "MAINTENANCE"   # scheduled maintenance
    REPAIR        = "REPAIR"        # broken / being repaired
    IDLE          = "IDLE"          # available but unused
    RETIRED       = "RETIRED"       # decommissioned


class FuelType(str, enum.Enum):
    DIESEL   = "DIESEL"
    PETROL   = "PETROL"
    ELECTRIC = "ELECTRIC"
    LPG      = "LPG"
    NONE     = "NONE"           # non-motorised implements


class MaintenanceType(str, enum.Enum):
    OIL_CHANGE       = "OIL_CHANGE"
    FILTER_CHANGE    = "FILTER_CHANGE"
    TYRE_SERVICE     = "TYRE_SERVICE"
    BRAKE_SERVICE    = "BRAKE_SERVICE"
    BELT_REPLACEMENT = "BELT_REPLACEMENT"
    BLADE_SHARPENING = "BLADE_SHARPENING"
    HYDRAULIC_SERVICE= "HYDRAULIC_SERVICE"
    ELECTRICAL       = "ELECTRICAL"
    ANNUAL_SERVICE   = "ANNUAL_SERVICE"
    REPAIR           = "REPAIR"
    INSPECTION       = "INSPECTION"
    OTHER            = "OTHER"

class PersonnelRole(str, enum.Enum):
    FARM_MANAGER      = "FARM_MANAGER"
    AGRONOMIST        = "AGRONOMIST"
    FIELD_OPERATOR    = "FIELD_OPERATOR"
    SPRAYER_OPERATOR  = "SPRAYER_OPERATOR"
    HARVESTER_OPERATOR= "HARVESTER_OPERATOR"
    IRRIGATOR         = "IRRIGATOR"
    LIVESTOCK_WORKER  = "LIVESTOCK_WORKER"
    SEASONAL_WORKER   = "SEASONAL_WORKER"
    CONTRACTOR        = "CONTRACTOR"
    DRIVER            = "DRIVER"
    TECHNICIAN        = "TECHNICIAN"
    ADMIN             = "ADMIN"
    OTHER             = "OTHER"


class EmploymentType(str, enum.Enum):
    FULL_TIME    = "FULL_TIME"
    PART_TIME    = "PART_TIME"
    SEASONAL     = "SEASONAL"
    CONTRACTOR   = "CONTRACTOR"
    VOLUNTEER    = "VOLUNTEER"


class PersonnelStatus(str, enum.Enum):
    ACTIVE       = "ACTIVE"
    ON_LEAVE     = "ON_LEAVE"
    INACTIVE     = "INACTIVE"
    TERMINATED   = "TERMINATED"


class CertificationType(str, enum.Enum):
    PESTICIDE_APPLICATOR  = "PESTICIDE_APPLICATOR"
    PESTICIDE_ADVISOR     = "PESTICIDE_ADVISOR"

    # Machinery
    TRACTOR_LICENCE       = "TRACTOR_LICENCE"
    FORKLIFT_LICENCE      = "FORKLIFT_LICENCE"
    CRANE_LICENCE         = "CRANE_LICENCE"
    CHAINSAW_LICENCE      = "CHAINSAW_LICENCE"
    DRONE_OPERATOR        = "DRONE_OPERATOR"

    # Safety
    FIRST_AID             = "FIRST_AID"
    FIRE_SAFETY           = "FIRE_SAFETY"
    HAZMAT                = "HAZMAT"

    # Agricultural professional
    AGRONOMIST_LICENCE    = "AGRONOMIST_LICENCE"
    IRRIGATION_TECHNICIAN = "IRRIGATION_TECHNICIAN"
    ORGANIC_FARMING_CERT  = "ORGANIC_FARMING_CERT"

    OTHER                 = "OTHER"


class PayRateUnit(str, enum.Enum):
    PER_HOUR  = "PER_HOUR"
    PER_DAY   = "PER_DAY"
    PER_MONTH = "PER_MONTH"
    PER_SEASON= "PER_SEASON"
    FIXED     = "FIXED"