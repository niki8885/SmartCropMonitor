import datetime
import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import (
    ALERT_DROUGHT_SPI,
    ALERT_FROST_TEMP_C,
    ALERT_HEAT_TEMP_C,
    ALERT_HEAVY_RAIN_1H_MM,
    ALERT_HEAVY_RAIN_7D_MM,
    ALERT_HIGH_WIND_MPS,
    ALERT_SOIL_MOISTURE_MAX,
    ALERT_SOIL_MOISTURE_MIN,
    ALERT_SOIL_TEMP_MAX_C,
    ALERT_SOIL_TEMP_MIN_C,
)
from app.core.database import Events, UserLocation, WeatherHistory, WeatherMetrics
from app.core.schemas import EventType, StatusType
from app.utils.general import _make_event_hash

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ThresholdRule:
    event_type: EventType
    dedup_suffix: str
    metric_name: str
    threshold: float
    severity: str
    action: str
    comparator: str

    def triggered(self, value: Optional[float]) -> bool:
        if value is None:
            return False
        if self.comparator == "<=":
            return value <= self.threshold
        if self.comparator == ">=":
            return value >= self.threshold
        return False


def _latest_weather(db: Session, location_id: int) -> WeatherHistory | None:
    now = datetime.datetime.utcnow()
    return (
        db.query(WeatherHistory)
        .filter(
            WeatherHistory.location_id == location_id,
            WeatherHistory.timestamp <= now,
        )
        .order_by(WeatherHistory.timestamp.desc())
        .first()
    )


def _latest_metrics(db: Session, location_id: int, weather_id: int | None) -> WeatherMetrics | None:
    query = db.query(WeatherMetrics).filter(WeatherMetrics.location_id == location_id)
    if weather_id is not None:
        exact = (
            query.filter(WeatherMetrics.reference_weather_id == weather_id)
            .order_by(WeatherMetrics.id.desc())
            .first()
        )
        if exact:
            return exact
    return query.order_by(WeatherMetrics.window_end_date.desc()).first()


def _dedup_key(location_id: int, suffix: str) -> str:
    return f"threshold:{suffix}:location:{location_id}"


def _active_event(db: Session, dedup_key: str) -> Events | None:
    return db.execute(
        select(Events).where(
            Events.dedup_key == dedup_key,
            Events.status == StatusType.ACTIVE,
        )
    ).scalar_one_or_none()


def _upsert_event(
    db: Session,
    location: UserLocation,
    rule: ThresholdRule,
    value: float,
    source_timestamp: datetime.datetime | None,
) -> bool:
    now = datetime.datetime.utcnow()
    key = _dedup_key(location.id, rule.dedup_suffix)
    event_hash = _make_event_hash(location.id, rule.event_type, key)
    metadata = {
        "location_id": location.id,
        "location_label": location.label,
        "metric": rule.metric_name,
        "value": value,
        "threshold": rule.threshold,
        "comparator": rule.comparator,
        "source_timestamp": source_timestamp.isoformat() if source_timestamp else None,
        "recommended_action": rule.action,
    }

    existing = db.execute(
        select(Events).where(Events.event_hash == event_hash)
    ).scalar_one_or_none()

    if existing:
        existing.status = StatusType.ACTIVE
        existing.severity = rule.severity
        existing.updated_at = now
        existing.expires_at = now + datetime.timedelta(hours=12)
        existing.extra_metadata = metadata
        return False

    db.add(
        Events(
            user_id=location.user_id,
            event_type=rule.event_type,
            event_hash=event_hash,
            dedup_key=key,
            severity=rule.severity,
            status=StatusType.ACTIVE,
            expires_at=now + datetime.timedelta(hours=12),
            extra_metadata=metadata,
        )
    )
    return True


def _resolve_event(db: Session, location_id: int, suffix: str) -> bool:
    event = _active_event(db, _dedup_key(location_id, suffix))
    if not event:
        return False

    now = datetime.datetime.utcnow()
    event.status = StatusType.RESOLVED
    event.updated_at = now
    meta = dict(event.extra_metadata or {})
    meta["resolved_at"] = now.isoformat()
    event.extra_metadata = meta
    return True


def _rules() -> list[ThresholdRule]:
    return [
        ThresholdRule(
            EventType.FROST_HAZARD,
            "frost",
            "temp",
            ALERT_FROST_TEMP_C,
            "CRITICAL",
            "Protect sensitive crops and delay frost-sensitive field work.",
            "<=",
        ),
        ThresholdRule(
            EventType.HEAT_STRESS,
            "heat",
            "temp",
            ALERT_HEAT_TEMP_C,
            "CRITICAL",
            "Check irrigation readiness and inspect vulnerable fields.",
            ">=",
        ),
        ThresholdRule(
            EventType.HIGH_WIND,
            "wind",
            "wind_speed",
            ALERT_HIGH_WIND_MPS,
            "HIGH",
            "Secure equipment and avoid spraying or exposed operations.",
            ">=",
        ),
        ThresholdRule(
            EventType.HEAVY_RAIN,
            "rain_1h",
            "precipitation",
            ALERT_HEAVY_RAIN_1H_MM,
            "HIGH",
            "Inspect drainage and postpone soil-compacting operations.",
            ">=",
        ),
        ThresholdRule(
            EventType.HEAVY_RAIN,
            "rain_7d",
            "rain_cum_7d",
            ALERT_HEAVY_RAIN_7D_MM,
            "HIGH",
            "Inspect drainage and delay traffic on saturated fields.",
            ">=",
        ),
        ThresholdRule(
            EventType.DROUGHT_WARNING,
            "drought_spi",
            "spi_1m",
            ALERT_DROUGHT_SPI,
            "HIGH",
            "Prioritize irrigation and monitor water-stressed fields.",
            "<=",
        ),
        ThresholdRule(
            EventType.LOW_SOIL_MOISTURE,
            "soil_moisture_low",
            "soil_moisture_0_to_1cm",
            ALERT_SOIL_MOISTURE_MIN,
            "HIGH",
            "Check soil moisture and consider irrigation.",
            "<=",
        ),
        ThresholdRule(
            EventType.HIGH_SOIL_MOISTURE,
            "soil_moisture_high",
            "soil_moisture_0_to_1cm",
            ALERT_SOIL_MOISTURE_MAX,
            "HIGH",
            "Avoid field traffic and inspect drainage-sensitive areas.",
            ">=",
        ),
        ThresholdRule(
            EventType.SOIL_TEMP_LOW,
            "soil_temp_low",
            "soil_temperature_0cm",
            ALERT_SOIL_TEMP_MIN_C,
            "HIGH",
            "Delay planting or other temperature-sensitive operations.",
            "<=",
        ),
        ThresholdRule(
            EventType.SOIL_TEMP_HIGH,
            "soil_temp_high",
            "soil_temperature_0cm",
            ALERT_SOIL_TEMP_MAX_C,
            "HIGH",
            "Inspect crop heat stress and surface moisture conditions.",
            ">=",
        ),
    ]


def _metric_value(rule: ThresholdRule, weather: WeatherHistory, metrics: WeatherMetrics | None) -> float | None:
    if hasattr(weather, rule.metric_name):
        return getattr(weather, rule.metric_name)
    if metrics is not None and hasattr(metrics, rule.metric_name):
        return getattr(metrics, rule.metric_name)
    return None


def check_weather_environmental_alerts(db: Session) -> dict:
    stats = {"locations_checked": 0, "created": 0, "updated": 0, "resolved": 0}
    locations = db.execute(select(UserLocation)).scalars().all()

    for location in locations:
        stats["locations_checked"] += 1
        weather = _latest_weather(db, location.id)
        if not weather:
            continue

        metrics = _latest_metrics(db, location.id, weather.id)

        for rule in _rules():
            value = _metric_value(rule, weather, metrics)
            if rule.triggered(value):
                created = _upsert_event(db, location, rule, float(value), weather.timestamp)
                stats["created" if created else "updated"] += 1
            elif _resolve_event(db, location.id, rule.dedup_suffix):
                stats["resolved"] += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("check_weather_environmental_alerts: commit failed: %s", exc)
        raise

    logger.info("check_weather_environmental_alerts finished: %s", stats)
    return stats
