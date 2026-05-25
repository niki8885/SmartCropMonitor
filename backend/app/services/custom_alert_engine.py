import hashlib
import operator
from datetime import datetime
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional


COMPARATORS = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}

METRIC_ALIASES = {
    "sensor_temp": "temp",
    "sensor_temperature": "temp",
    "sensor_humidity": "humidity",
    "sensor_pressure": "pressure",
    "soil_moisture": "soil_moisture_0_to_1cm",
    "soil_temperature": "soil_temperature_0cm",
    "gdd": "gdd_base_10",
    "water_deficit": "water_deficit_7d",
}


def _coerce_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row_to_metrics(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, Mapping):
        items = row.items()
    else:
        items = getattr(row, "__dict__", {}).items()

    metrics = {}
    for key, value in items:
        if key.startswith("_") or value is None:
            continue
        if isinstance(value, (datetime, Mapping, list, tuple, set)):
            continue
        metrics[key] = _coerce_number(value)
    return {key: value for key, value in metrics.items() if value is not None}


def build_metric_snapshot(*rows: Any, extra: Optional[Mapping[str, Any]] = None) -> dict[str, float]:
    snapshot: dict[str, float] = {}
    for row in rows:
        snapshot.update(_row_to_metrics(row))
    if extra:
        for key, value in extra.items():
            number = _coerce_number(value)
            if number is not None:
                snapshot[key] = number
    return snapshot


def _metric_value(metric: str, telemetry: Mapping[str, Any]) -> Optional[float]:
    value = telemetry.get(metric)
    if value is None:
        value = telemetry.get(METRIC_ALIASES.get(metric, ""))
    return _coerce_number(value)


def evaluate_rule_condition(condition: Mapping[str, Any], telemetry: Mapping[str, Any]) -> bool:
    """
    Evaluate either a legacy single condition:
      {"metric": "temp", "operator": ">", "value": 25}

    or a compound condition:
      {"logic": "AND", "conditions": [{...}, {...}]}
    """
    if not condition:
        return False

    nested = condition.get("conditions")
    if nested is not None:
        children = [item for item in nested if isinstance(item, Mapping)]
        if not children:
            return False
        logic = str(condition.get("logic", "AND")).upper()
        if logic == "OR":
            return any(evaluate_rule_condition(item, telemetry) for item in children)
        return all(evaluate_rule_condition(item, telemetry) for item in children)

    metric = condition.get("metric")
    comparator = COMPARATORS.get(str(condition.get("operator", "")).strip())
    expected = _coerce_number(condition.get("value"))
    actual = _metric_value(str(metric), telemetry) if metric else None

    if comparator is None or actual is None or expected is None:
        return False
    return bool(comparator(actual, expected))


def _iter_condition_nodes(condition: Mapping[str, Any]) -> Iterable[Mapping[str, Any]]:
    yield condition
    for child in condition.get("conditions") or []:
        if isinstance(child, Mapping):
            yield from _iter_condition_nodes(child)


def _context_matches(
    condition: Mapping[str, Any],
    location_id: Optional[int] = None,
    sensor_id: Optional[int] = None,
) -> bool:
    for node in _iter_condition_nodes(condition):
        rule_location = node.get("location_id")
        rule_sensor = node.get("sensor_id")
        if rule_location is not None and location_id is not None and int(rule_location) != int(location_id):
            return False
        if rule_sensor is not None and sensor_id is not None and int(rule_sensor) != int(sensor_id):
            return False
    return True


def evaluate_custom_alert_rules(
    db: Any,
    user_id: int,
    telemetry: Mapping[str, Any],
    *,
    location_id: Optional[int] = None,
    sensor_id: Optional[int] = None,
    source: str = "telemetry",
) -> list[Any]:
    from sqlalchemy import select

    from app.core.database import Events, EventsRules
    from app.core.schemas import StatusType

    rules = (
        db.execute(
            select(EventsRules)
            .where(EventsRules.user_id == user_id, EventsRules.is_active == True)
            .order_by(EventsRules.id.asc())
        )
        .scalars()
        .all()
    )

    created = []
    for rule in rules:
        condition = rule.condition or {}
        if not _context_matches(condition, location_id=location_id, sensor_id=sensor_id):
            continue
        if not evaluate_rule_condition(condition, telemetry):
            continue

        context_key = f"location:{location_id}" if location_id is not None else f"sensor:{sensor_id}"
        dedup_key = f"custom_rule:{rule.id}:{context_key}"
        existing = db.execute(
            select(Events).where(
                Events.user_id == user_id,
                Events.dedup_key == dedup_key,
                Events.status == StatusType.ACTIVE,
            )
        ).scalar_one_or_none()
        if existing:
            continue

        triggered_at = datetime.utcnow().isoformat()
        event_hash = hashlib.sha256(f"{dedup_key}|{rule.event_type}|{triggered_at}".encode()).hexdigest()
        event = Events(
            user_id=user_id,
            event_type=rule.event_type,
            event_hash=event_hash,
            dedup_key=dedup_key,
            severity=(rule.action or {}).get("severity", "WARNING"),
            status=StatusType.ACTIVE,
            extra_metadata={
                "rule_id": rule.id,
                "rule_name": rule.name,
                "condition": condition,
                "notify": (rule.action or {}).get("notify", True),
                "source": source,
                "location_id": location_id,
                "sensor_id": sensor_id,
                "triggered_at": triggered_at,
                "telemetry": dict(telemetry),
            },
        )
        db.add(event)
        created.append(event)

    return created
