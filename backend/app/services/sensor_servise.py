import datetime
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.core.database import SensorsDB, WeatherSensors
from app.events.sensor_alerts import handle_sensor_came_online
from app.services.custom_alert_engine import build_metric_snapshot, evaluate_custom_alert_rules
from app.events.urgent_email_alerts import deliver_pending_urgent_alerts


def process_and_add_sensor_data(db: Session, payload: dict):
    """
    JSON:
    {
        "key": "sensor_secret_hash",
        "data": [
            {"ts": "2026-05-09T10:00:00", "t": 22.5, "p": 750, "h": 45},
            {"ts": "2026-05-09T10:10:00", "t": 22.6, "p": 749, "h": 46}
        ]
    }
    """
    sensor = db.execute(
        select(SensorsDB).where(SensorsDB.hashed_key == payload.get("key"))
    ).scalar_one_or_none()

    if not sensor:
        raise ValueError("Invalid sensor key")

    new_records = []
    for item in payload.get("data", []):
        new_record = WeatherSensors(
            sensor_id=sensor.id,
            timestamp=item["ts"],
            temp=item.get("t"),
            pressure=item.get("p"),
            humidity=item.get("h"),
            sensor_status=True,
            extra_data=item.get("extra")
        )
        new_records.append(new_record)

    if new_records:
        db.add_all(new_records)
        handle_sensor_came_online(db, sensor.id)
        latest_record = max(new_records, key=lambda record: record.timestamp)
        created = evaluate_custom_alert_rules(
            db,
            sensor.user_id,
            build_metric_snapshot(latest_record, extra=latest_record.extra_data),
            sensor_id=sensor.id,
            source="sensor_stream",
        )
        try:
            db.commit()
            if created:
                deliver_pending_urgent_alerts(db, event_ids=[event.id for event in created])
            return len(new_records)
        except Exception as e:
            db.rollback()
            raise e
    return 0
