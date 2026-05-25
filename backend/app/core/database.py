# =========================
# Imports
# =========================
import datetime

from sqlalchemy import (
    create_engine, Column, Integer, Float, Enum, Numeric,
    ForeignKey, String, DateTime, JSON, Boolean, UniqueConstraint, func, Index, Date, Text
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

from pydantic import BaseModel
from app.core.config import SQLALCHEMY_DATABASE_URL
from app.core.schemas import (
    FieldType, FieldWorkType, FieldWorkStatus, EventType, StatusType,
    Status_task, Priority_task, AnomalyType, RotationStatus,
    FertilizationMethod, PesticideTargetType, HarvestQualityUnit,
    SeedTreatmentType, TillageType,
)
import enum
from geoalchemy2 import Geometry

# =========================
# Engine / Session
# =========================
engine = create_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# =========================
# Base
# =========================
Base = declarative_base()


# =========================
# Models
# =========================

class UserDB(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

    email        = Column(String, nullable=True, unique=True, index=True)
    first_name   = Column(String(100), nullable=True)
    last_name    = Column(String(100), nullable=True)
    phone        = Column(String(30),  nullable=True)

    country      = Column(String(100), nullable=True)
    city         = Column(String(100), nullable=True)

    farm_name        = Column(String(200), nullable=True)
    farm_size_ha     = Column(Numeric(10, 2), nullable=True)

    # eGN: registration
    farm_reg_number  = Column(String(100), nullable=True)   # registration number (EORI / national)
    farm_owner_name  = Column(String(200), nullable=True)   # legal owner if different from user
    farm_operator    = Column(String(200), nullable=True)   # operator name

    created_at   = Column(DateTime, default=datetime.datetime.utcnow, nullable=True)

    locations = relationship("UserLocation", back_populates="owner")
    sensors   = relationship("SensorsDB",    back_populates="owner")


class UserLocation(Base):
    __tablename__ = "user_locations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))

    label = Column(String)

    location = Column(Geometry(geometry_type='POINT', srid=4326))

    segmentation_status = Column(Boolean, default=None, nullable=True)
    last_segm_mask_url  = Column(String, nullable=True)
    last_grid_mask_url  = Column(String, nullable=True)

    owner           = relationship("UserDB", back_populates="locations")
    fields          = relationship("FieldUnit", back_populates="location")
    weather_history = relationship("WeatherHistory", back_populates="location")
    weather_metrics = relationship("WeatherMetrics", back_populates="location")
    analyses        = relationship("FieldAnalysis", back_populates="location")


class FieldAnalysis(Base):
    __tablename__ = "field_analysis_history"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("user_locations.id"))

    nc_filename            = Column(String)
    mask_filename          = Column(String, nullable=True)
    last_data_request_date = Column(DateTime, default=datetime.datetime.utcnow)

    is_valid        = Column(Float, nullable=True, default=None)
    quality_report  = Column(String, nullable=True)
    results_json    = Column(JSON, nullable=True)

    metrics_status     = Column(Boolean, default=None, nullable=True)
    metrics_filename   = Column(String, nullable=True)
    per_metrics_status = Column(Boolean, default=None, nullable=True)

    fields_count = Column(Integer, default=0)

    location = relationship("UserLocation", back_populates="analyses")


class FieldAnalysisResult(Base):
    __tablename__ = "field_analysis_result"

    id = Column(Integer, primary_key=True, index=True)

    analysis_id = Column(Integer, ForeignKey("field_analysis_history.id"), nullable=False, index=True)
    result_type = Column(String(50), nullable=False, index=True)
    source_file_id = Column(Integer, nullable=True, index=True)
    extra_metadata = Column(JSONB, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class FieldUnit(Base):
    __tablename__ = "field_units"

    id = Column(Integer, primary_key=True, index=True)

    location_id = Column(Integer, ForeignKey("user_locations.id"), nullable=False, index=True)

    label    = Column(String, nullable=False)
    geometry = Column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False)
    area_ha  = Column(Numeric(12, 2), nullable=True)

    field_type = Column(Enum(FieldType), nullable=False, index=True)

    manual_added = Column(Boolean, default=False)
    source       = Column(String, nullable=True)

    # eGN 3.2 – Field identification
    lpis_id         = Column(String(64),  nullable=True, index=True)   # LPIS parcel identifier
    cadastral_ref   = Column(String(128), nullable=True)               # national cadastral ref

    # eGN 3.2 – Soil
    soil_type       = Column(String(64),  nullable=True)
    soil_texture    = Column(String(64),  nullable=True)
    organic_matter  = Column(Numeric(5, 2), nullable=True)

    # eGN 3.2 – Crop rotation context
    crop_type    = Column(String, nullable=True)
    season_year  = Column(Integer, nullable=True)

    previous_crop = Column(String, nullable=True)
    previous_crop_year = Column(Integer, nullable=True)

    # eGN 3.8 – Eco-scheme flags
    has_buffer_zone      = Column(Boolean, default=False, nullable=True)
    buffer_zone_m        = Column(Numeric(6, 1), nullable=True)
    is_non_productive    = Column(Boolean, default=False, nullable=True)
    in_nitrate_zone      = Column(Boolean, default=False, nullable=True)
    organic_farming      = Column(Boolean, default=False, nullable=True)

    status     = Column(String, default="active", index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)

    location   = relationship("UserLocation", back_populates="fields")
    field_data = relationship("FieldData",    back_populates="field")
    field_work = relationship("FieldWork",    back_populates="field")
    seasons    = relationship("SeasonRecord", back_populates="field", order_by="SeasonRecord.sowing_date.desc()")


class FieldData(Base):
    __tablename__ = "field_data"
    id = Column(Integer, primary_key=True, index=True)

    field_id  = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)

    metric_type = Column(String(50), nullable=False, index=True)
    mean_metric = Column(Numeric(6, 4), nullable=True)
    min_metric  = Column(Numeric(6, 4), nullable=True)
    max_metric  = Column(Numeric(6, 4), nullable=True)
    std_metric  = Column(Numeric(6, 4), nullable=True)

    extra = Column(JSON, nullable=True)

    field = relationship("FieldUnit", back_populates="field_data")


class FieldStatAnomalyAnalysis(Base):
    __tablename__ = "field_stat_anomaly_analysis"

    id            = Column(Integer, primary_key=True, index=True)
    field_id      = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    field_data_id = Column(Integer, ForeignKey("field_data.id"),  nullable=True, index=True)

    analysis_date    = Column(DateTime, nullable=False, index=True)
    anomaly_type     = Column(Enum(AnomalyType), default=AnomalyType.UNKNOWN, nullable=False, index=True)
    metrics_summary  = Column(JSON, nullable=False)
    confidence_score = Column(Numeric(5, 4), nullable=False)

    status     = Column(Enum(StatusType), default=StatusType.ACTIVE, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, onupdate=func.now(), nullable=True)

    extra = Column(JSON, nullable=True)


class Biomass(Base):
    __tablename__ = "biomass"

    id          = Column(Integer, primary_key=True, index=True)
    field_id    = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    analysis_id = Column(Integer, ForeignKey("field_analysis_history.id"), nullable=False, index=True)
    reference_weather_id = Column(Integer, ForeignKey("weather_history.id"), nullable=True)
    reference_metrics_id = Column(Integer, ForeignKey("weather_metrics.id"), nullable=True)

    analysis_date = Column(DateTime, nullable=False, index=True)

    evi         = Column(Numeric(6, 4), nullable=False)
    msi         = Column(Numeric(6, 4), nullable=False)
    ci          = Column(Numeric(6, 4), nullable=False)
    biomass_tha = Column(Numeric(8, 4), nullable=False)
    confidence  = Column(Numeric(5, 4), nullable=False)
    ground_truth = Column(Numeric(8, 4), nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    extra      = Column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_biomass_field_date", "field_id", "analysis_date"),
        Index("ix_biomass_analysis", "analysis_id"),
    )


class GrazingRotation(Base):
    __tablename__ = "grazing_rotation"

    id          = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("user_locations.id"), nullable=False, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    name        = Column(String(128), nullable=False)
    description = Column(String(512), nullable=True)
    plan_start  = Column(DateTime, nullable=False)
    plan_end    = Column(DateTime, nullable=True)

    total_aum_target = Column(Float, nullable=True)
    notes            = Column(String(1024), nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    location = relationship("UserLocation")
    entries  = relationship(
        "GrazingRotationEntry",
        back_populates="rotation",
        order_by="GrazingRotationEntry.graze_start",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_grazing_rotation_location", "location_id"),
        Index("ix_grazing_rotation_user", "user_id"),
    )


class GrazingRotationEntry(Base):
    __tablename__ = "grazing_rotation_entry"

    id          = Column(Integer, primary_key=True, index=True)
    rotation_id = Column(Integer, ForeignKey("grazing_rotation.id", ondelete="CASCADE"), nullable=False, index=True)
    field_id    = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    sequence    = Column(Integer, nullable=False, default=0)

    graze_start = Column(DateTime, nullable=False)
    graze_end   = Column(DateTime, nullable=False)
    rest_end    = Column(DateTime, nullable=False)

    planned_aum = Column(Float, nullable=True)
    actual_aum  = Column(Float, nullable=True)

    status = Column(Enum(RotationStatus), nullable=False, default=RotationStatus.PLANNED, index=True)

    biomass_at_start = Column(Float, nullable=True)
    biomass_at_end   = Column(Float, nullable=True)
    notes = Column(String(512), nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    rotation = relationship("GrazingRotation", back_populates="entries")
    field    = relationship("FieldUnit")

    __table_args__ = (
        UniqueConstraint("rotation_id", "field_id", "graze_start", name="uq_rotation_entry_slot"),
        Index("ix_rotation_entry_field", "field_id"),
        Index("ix_rotation_entry_status", "status"),
        Index("ix_rotation_entry_dates", "graze_start", "rest_end"),
    )


class WeatherHistory(Base):
    __tablename__ = "weather_history"

    id          = Column(Integer, primary_key=True)
    location_id = Column(Integer, ForeignKey("user_locations.id"))
    timestamp   = Column(DateTime, nullable=False, index=True)

    temp          = Column(Float)
    humidity      = Column(Float)
    precipitation = Column(Float)
    rain          = Column(Float)
    showers       = Column(Float)
    snowfall      = Column(Float)

    soil_temperature_0cm    = Column(Float)
    soil_moisture_0_to_1cm  = Column(Float)

    pressure       = Column(Float)
    cloud_coverage = Column(Float)
    wind_speed     = Column(Float)
    wind_deg       = Column(Float)

    dew_point               = Column(Float)
    vapour_pressure_deficit = Column(Float)

    sunrise    = Column(DateTime)
    sunset     = Column(DateTime)
    is_night   = Column(Boolean, default=False)

    data_source = Column(String, default="open-meteo")
    created_at  = Column(DateTime, default=datetime.datetime.utcnow)
    metrics_status = Column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint("location_id", "timestamp", "data_source", name="uq_weather_location_timestamp"),
    )

    location = relationship("UserLocation", back_populates="weather_history")
    metrics  = relationship("WeatherMetrics", back_populates="weather")


class WeatherMetrics(Base):
    __tablename__ = "weather_metrics"

    id                   = Column(Integer, primary_key=True, index=True)
    location_id          = Column(Integer, ForeignKey("user_locations.id"), index=True)
    reference_weather_id = Column(Integer, ForeignKey("weather_history.id"), index=True)
    window_end_date      = Column(DateTime, default=datetime.datetime.utcnow)

    temp_min_day_7d   = Column(Float)
    temp_max_day_7d   = Column(Float)
    temp_min_night_7d = Column(Float)
    temp_max_night_7d = Column(Float)

    gdd_base_10    = Column(Float)
    rain_cum_7d    = Column(Float)
    rain_cum_30d   = Column(Float)
    water_deficit_7d  = Column(Float)
    water_deficit_30d = Column(Float)
    et0            = Column(Float)

    humidity_mean_7d  = Column(Float)
    humidity_mean_30d = Column(Float)

    heat_days_count_7d   = Column(Integer)
    heat_days_count_30d  = Column(Integer)
    frost_days_count_7d  = Column(Integer)
    frost_days_count_30d = Column(Integer)

    spi_1m       = Column(Float)
    ra_mj_m2_day = Column(Float)
    rs_mj_m2_day = Column(Float)

    location = relationship("UserLocation", back_populates="weather_metrics")
    weather  = relationship("WeatherHistory", back_populates="metrics")

    __table_args__ = (
        UniqueConstraint("location_id", "reference_weather_id", name="uq_weather_metrics_location_weather"),
        Index("ix_weather_metrics_location_window", "location_id", "window_end_date"),
    )


class DiseaseRisk(Base):
    __tablename__ = "disease_risk"

    id          = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("user_locations.id"), nullable=False, index=True)
    reference_weather_id = Column(Integer, ForeignKey("weather_history.id"), nullable=False, index=True)
    window_end_date = Column(DateTime, nullable=False, index=True)

    botrytis_hours_48h      = Column(Integer, nullable=True)
    botrytis_risk_level     = Column(String(10), nullable=True)
    botrytis_action_required = Column(Boolean, nullable=True)

    tomcast_dsv_7d          = Column(Float, nullable=True)
    tomcast_dsv_since_spray = Column(Float, nullable=True)
    tomcast_action_required = Column(Boolean, nullable=True)

    blitecast_p_value_day   = Column(Integer, nullable=True)
    blitecast_p_value_7d    = Column(Float, nullable=True)
    blitecast_dsv_7d        = Column(Float, nullable=True)
    blitecast_risk_level    = Column(String(10), nullable=True)
    blitecast_action_required = Column(Boolean, nullable=True)

    plasmopara_bbch_stage         = Column(Integer, nullable=True)
    plasmopara_leaf_wetness_hours = Column(Integer, nullable=True)
    plasmopara_rain_10d           = Column(Float, nullable=True)
    plasmopara_rule_triggered     = Column(Boolean, nullable=True)
    plasmopara_epi                = Column(Float, nullable=True)
    plasmopara_risk_level         = Column(String(10), nullable=True)
    plasmopara_action_required    = Column(Boolean, nullable=True)

    computed_at         = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    any_action_required = Column(Boolean, nullable=False, default=False)

    location = relationship("UserLocation")
    weather  = relationship("WeatherHistory")

    __table_args__ = (
        UniqueConstraint("location_id", "reference_weather_id", name="uq_disease_risk_location_weather"),
        Index("ix_disease_risk_location_date", "location_id", "window_end_date"),
        Index("ix_disease_risk_action", "any_action_required", "window_end_date"),
    )


class IrrigationRecommendation(Base):
    __tablename__ = "irrigation_recommendations"

    id          = Column(Integer, primary_key=True, index=True)
    field_id    = Column(Integer, ForeignKey("field_units.id"),    nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("user_locations.id"), nullable=False, index=True)
    window_end_date = Column(DateTime, nullable=False, index=True)

    urgency         = Column(String(10), nullable=False, default="NONE")
    should_irrigate = Column(Boolean,    nullable=False, default=False)
    score           = Column(Float,      nullable=True)

    recommended_mm    = Column(Float, nullable=True)
    recommended_m3_ha = Column(Float, nullable=True)
    total_volume_m3   = Column(Float, nullable=True)

    et0              = Column(Float, nullable=True)
    water_deficit_7d = Column(Float, nullable=True)
    rain_cum_7d      = Column(Float, nullable=True)
    soil_moisture    = Column(Float, nullable=True)
    ndwi_mean        = Column(Float, nullable=True)
    spi_1m           = Column(Float, nullable=True)

    reason           = Column(String(1000), nullable=True)
    haskell_snapshot = Column(JSONB, nullable=True)
    computed_at      = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("field_id", "window_end_date", name="uq_irrigation_field_window"),
        Index("ix_irrigation_urgency_date",  "urgency",     "window_end_date"),
        Index("ix_irrigation_location_date", "location_id", "window_end_date"),
    )


class SensorsDB(Base):
    __tablename__ = "sensors"

    id      = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))

    location  = Column(Geometry(geometry_type='POINT', srid=4326))
    label     = Column(String)
    hashed_key = Column(String, unique=True, index=True, nullable=False)

    added_at          = Column(DateTime, nullable=True, default=datetime.datetime.utcnow)
    meteorological    = Column(Boolean, nullable=True)
    activation_status = Column(Boolean, nullable=True, default=True)
    extra_data        = Column(JSON, nullable=True)

    owner       = relationship("UserDB", back_populates="sensors")
    sensor_data = relationship("WeatherSensors", back_populates="sensor")


class WeatherSensors(Base):
    __tablename__ = "weather_sensors"

    id        = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensors.id"))
    timestamp = Column(DateTime, nullable=False, index=True)

    temp     = Column(Float)
    pressure = Column(Float)
    humidity = Column(Float)

    sensor_status = Column(Boolean, nullable=True)
    extra_data    = Column(JSON, nullable=True)

    __table_args__ = (
        UniqueConstraint("sensor_id", "timestamp", name="uq_sensor_timestamp"),
    )

    sensor = relationship("SensorsDB", back_populates="sensor_data")

# eGN 3.3 – Season / Sowing record

class SeasonRecord(Base):
    __tablename__ = "season_records"

    id       = Column(Integer, primary_key=True, index=True)
    field_id = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    user_id  = Column(Integer, ForeignKey("users.id"),       nullable=False, index=True)

    season_year = Column(Integer, nullable=False, index=True)

    # eGN 3.3 Crop
    crop        = Column(String(64), nullable=False)
    variety     = Column(String(128), nullable=True)
    sowing_date = Column(Date, nullable=True)
    sowing_rate_kg_ha = Column(Numeric(8, 2), nullable=True)

    # eGN 3.3 Seed treatment
    seed_treatment      = Column(Enum(SeedTreatmentType), nullable=True)
    seed_treatment_note = Column(String(256), nullable=True)

    # eGN 3.6 Tillage system
    tillage_type = Column(Enum(TillageType), nullable=True)

    # eGN 3.7 Harvest
    harvest_date    = Column(Date, nullable=True)
    harvest_area_ha = Column(Numeric(10, 2), nullable=True)
    harvest_total_t = Column(Numeric(10, 3), nullable=True)
    yield_t_ha      = Column(Numeric(8, 3), nullable=True)

    # Quality params (3.7 optional)
    moisture_pct    = Column(Numeric(5, 2), nullable=True)
    protein_pct     = Column(Numeric(5, 2), nullable=True)
    quality_extra   = Column(JSONB, nullable=True)

    notes      = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    field = relationship("FieldUnit", back_populates="seasons")

    __table_args__ = (
        UniqueConstraint("field_id", "season_year", "crop", name="uq_season_field_year_crop"),
        Index("ix_season_field_year", "field_id", "season_year"),
        Index("ix_season_user_year",  "user_id",  "season_year"),
    )


# eGN 3.4 – Fertilization log

class FertilizationLog(Base):
    __tablename__ = "fertilization_log"

    id           = Column(Integer, primary_key=True, index=True)
    field_work_id = Column(Integer, ForeignKey("field_work.id"), nullable=False, index=True, unique=True)
    field_id     = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"),       nullable=False, index=True)
    season_id    = Column(Integer, ForeignKey("season_records.id"), nullable=True, index=True)

    application_date = Column(Date, nullable=False, index=True)

    # Product info
    product_name  = Column(String(200), nullable=True)
    product_type  = Column(String(64),  nullable=True)
    is_organic    = Column(Boolean, default=False)

    # Active substances (kg/ha of pure element)
    n_kg_ha   = Column(Numeric(8, 3), nullable=True)   # total N
    p2o5_kg_ha = Column(Numeric(8, 3), nullable=True)  # P₂O₅
    k2o_kg_ha  = Column(Numeric(8, 3), nullable=True)  # K₂O
    s_kg_ha    = Column(Numeric(8, 3), nullable=True)  # Sulphur (optional)
    mg_kg_ha   = Column(Numeric(8, 3), nullable=True)  # Magnesium (optional)

    # Dosage and application
    dose_kg_ha        = Column(Numeric(10, 2), nullable=True)  # product dosage kg/ha
    total_dose_kg     = Column(Numeric(12, 2), nullable=True)  # total product applied
    application_method = Column(Enum(FertilizationMethod), nullable=True)

    operator_name = Column(String(128), nullable=True)
    equipment     = Column(String(128), nullable=True)
    notes         = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    field_work = relationship("FieldWork", back_populates="fertilization_log")

    __table_args__ = (
        Index("ix_fert_field_date", "field_id", "application_date"),
        Index("ix_fert_user_date",  "user_id",  "application_date"),
    )


# eGN 3.5 – Pesticide / Plant-protection log

class PesticideLog(Base):

    __tablename__ = "pesticide_log"

    id            = Column(Integer, primary_key=True, index=True)
    field_work_id = Column(Integer, ForeignKey("field_work.id"), nullable=False, index=True, unique=True)
    field_id      = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"),       nullable=False, index=True)
    season_id     = Column(Integer, ForeignKey("season_records.id"), nullable=True, index=True)

    application_date = Column(Date, nullable=False, index=True)

    # Product identification
    product_trade_name     = Column(String(200), nullable=False)
    active_substance       = Column(String(200), nullable=True)
    registration_number    = Column(String(64),  nullable=True)

    # Dosage
    dose_l_ha          = Column(Numeric(8, 3), nullable=True)
    dose_kg_ha         = Column(Numeric(8, 3), nullable=True)
    water_volume_l_ha  = Column(Numeric(8, 1), nullable=True)
    total_product_used = Column(Numeric(10, 3), nullable=True)

    target_crop          = Column(String(64),  nullable=True)
    target_type          = Column(Enum(PesticideTargetType), nullable=True)
    target_organism      = Column(String(200), nullable=True)

    wind_speed_ms     = Column(Numeric(4, 1), nullable=True)
    temperature_c     = Column(Numeric(4, 1), nullable=True)
    bbch_stage        = Column(String(10), nullable=True)
    pre_harvest_interval_days = Column(Integer, nullable=True)

    operator_name   = Column(String(128), nullable=True)
    operator_cert   = Column(String(64),  nullable=True)
    equipment       = Column(String(128), nullable=True)
    notes           = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    field_work = relationship("FieldWork", back_populates="pesticide_log")

    __table_args__ = (
        Index("ix_pest_field_date", "field_id", "application_date"),
        Index("ix_pest_user_date",  "user_id",  "application_date"),
    )


class FieldWork(Base):
    __tablename__ = "field_work"

    id       = Column(Integer, primary_key=True, index=True)
    field_id = Column(Integer, ForeignKey("field_units.id"), nullable=False, index=True)
    user_id  = Column(Integer, ForeignKey("users.id"),       nullable=False, index=True)

    work_date   = Column(DateTime, nullable=False, index=True)
    work_type   = Column(Enum(FieldWorkType), nullable=False, index=True)
    work_status = Column(Enum(FieldWorkStatus), nullable=False, default=FieldWorkStatus.PLANNED)

    # eGN 3.6
    season_id = Column(Integer, ForeignKey("season_records.id"), nullable=True, index=True)
    operator_name = Column(String(128), nullable=True)
    equipment = Column(String(128), nullable=True)

    tillage_depth_cm = Column(Numeric(5, 1), nullable=True)

    irrigation_mm = Column(Numeric(7, 1), nullable=True)

    # Economics / legacy
    work_cost = Column(Numeric(10, 2), nullable=True)
    harvest_ton = Column(Numeric(10, 3), nullable=True)

    extra_metadata = Column(JSONB, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    field             = relationship("FieldUnit", back_populates="field_work")
    fertilization_log = relationship("FertilizationLog", back_populates="field_work", uselist=False)
    pesticide_log     = relationship("PesticideLog",     back_populates="field_work", uselist=False)

    __table_args__ = (
        Index("ix_field_work_field_date", "field_id", "work_date"),
        Index("ix_field_work_user_date",  "user_id",  "work_date"),
        Index("ix_field_work_type_date",  "work_type", "work_date"),
    )


class Events(Base):
    __tablename__ = "events"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    event_type = Column(Enum(EventType), nullable=False, index=True)
    event_hash = Column(String(128), nullable=False, unique=True, index=True)
    dedup_key  = Column(String(255), nullable=False, index=True)
    severity   = Column(String(20), nullable=False, default="INFO")
    status     = Column(Enum(StatusType), nullable=False, default="ACTIVE")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    extra_metadata = Column(JSONB, nullable=True)


class EventsRules(Base):
    __tablename__ = "events_rules"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name      = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    event_type = Column(Enum(EventType), nullable=False)
    condition  = Column(JSONB, nullable=False)
    action     = Column(JSONB, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class UserTask(Base):
    __tablename__ = "user_task"

    id       = Column(Integer, primary_key=True, index=True)
    user_id  = Column(Integer, ForeignKey("users.id"),       nullable=False, index=True)
    field_id = Column(Integer, ForeignKey("field_units.id"), nullable=True,  index=True)
    location = Column(Geometry(geometry_type='POINT', srid=4326), nullable=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=True, index=True)

    task_type       = Column(String(50), nullable=False)
    status          = Column(Enum(Status_task),    nullable=False, default="TODO")
    priority        = Column(Enum(Priority_task),  nullable=False, default="MEDIUM")
    task_timestamp  = Column(DateTime, nullable=False, index=True)
    created_at      = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    extra_metadata  = Column(JSONB, nullable=True)


class FalsePositiveFeedback(Base):
    __tablename__ = "false_positive_feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"),  nullable=False, index=True)
    event_id  = Column(Integer, ForeignKey("events.id"), nullable=True,  index=True)
    anomaly_id = Column(Integer, ForeignKey("field_stat_anomaly_analysis.id"), nullable=True, index=True)

    event_type = Column(String(64),  nullable=True, index=True)
    comment = Column(String(500), nullable=True)
    context_snapshot = Column(JSONB, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        Index("ix_fp_user_created",       "user_id",    "created_at"),
        Index("ix_fp_event_type_created", "event_type", "created_at"),
    )


# =========================
# DB Dependency
# =========================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =========================
# Init DB
# =========================
Base.metadata.create_all(bind=engine)