import logging
import datetime
from typing import Callable

from sqlalchemy.orm import Session

from app.core.database import get_db
from app.events.sensor_alerts import check_sensors_offline

try:
    from app.events.weather_threshold_alerts import check_weather_environmental_alerts
except ModuleNotFoundError as exc:
    if exc.name != "app.events.weather_threshold_alerts":
        raise
    check_weather_environmental_alerts = None

try:
    from app.events.irrigation_alerts import check_irrigation_alerts
except ModuleNotFoundError as exc:
    if exc.name != "app.events.irrigation_alerts":
        raise
    check_irrigation_alerts = None

logger = logging.getLogger(__name__)


ALERT_CHECKS: list[tuple[str, Callable[[Session], dict | None]]] = [
    ("sensor_offline_check", check_sensors_offline),
    *(
        [("weather_environmental_threshold_check", check_weather_environmental_alerts)]
        if check_weather_environmental_alerts
        else []
    ),
    *(
        [("irrigation_alert_check", check_irrigation_alerts)]
        if check_irrigation_alerts
        else []
    ),
    # ("frost_hazard_check", check_frost_hazard),
    # ("drought_warning_check", check_drought_warning),
]


def run_all_alert_checks() -> None:
    started_at = datetime.datetime.utcnow()
    logger.info("=== Alert orchestrator started at %s ===", started_at.isoformat())

    results = {}

    for check_name, check_fn in ALERT_CHECKS:
        db_gen = get_db()
        db: Session = next(db_gen)
        try:
            logger.info("Running check: %s", check_name)
            result = check_fn(db)
            results[check_name] = {"status": "ok", "result": result}
        except Exception as exc:
            logger.exception("Check '%s' failed: %s", check_name, exc)
            results[check_name] = {"status": "error", "error": str(exc)}
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass

    finished_at = datetime.datetime.utcnow()
    elapsed = (finished_at - started_at).total_seconds()
    logger.info(
        "=== Alert orchestrator finished in %.2fs. Results: %s ===",
        elapsed, results
    )
    try:
        from app.events.urgent_email_alerts import deliver_pending_urgent_alerts

        db_gen = get_db()
        db: Session = next(db_gen)
        try:
            results["urgent_email_delivery"] = {
                "status": "ok",
                "result": deliver_pending_urgent_alerts(db),
            }
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass
    except Exception as exc:
        logger.exception("Urgent email delivery failed: %s", exc)
        results["urgent_email_delivery"] = {"status": "error", "error": str(exc)}

    return results
