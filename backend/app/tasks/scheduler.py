from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.executors.pool import ThreadPoolExecutor
from app.core.database import SessionLocal
from app.services.orchestrator import full_sync_process, short_sync_process
from app.services.storage_cleanup import cleanup_failed_datasets
from app.events.morning_briefing_email import run_morning_briefing
from app.events.alerts_orchestrator import run_all_alert_checks
from app.events.urgent_email_alerts import run_urgent_alert_delivery
import logging

executors = {
    'default': ThreadPoolExecutor(2)
}

scheduler = BackgroundScheduler(executors=executors, timezone="UTC")
logger = logging.getLogger(__name__)


def scheduled_update_full():
    db = SessionLocal()
    try:
        full_sync_process(db)
        logger.info("Full sync completed successfully.")
    except Exception as e:
        logger.error(f"Full sync failed: {e}")
    finally:
        db.close()


def scheduled_update_short():
    db = SessionLocal()
    try:
        short_sync_process(db)
        logger.info("Short sync completed successfully.")
    except Exception as e:
        logger.error(f"Short sync failed: {e}")
    finally:
        db.close()


def scheduled_storage_cleanup():
    db = SessionLocal()
    try:
        report = cleanup_failed_datasets(db, dry_run=False)
        logger.info("Storage cleanup completed: %s", report.to_dict())
    except Exception as e:
        logger.error(f"Storage cleanup failed: {e}", exc_info=True)
    finally:
        db.close()


scheduler.add_job(
    scheduled_update_full,
    "cron",
    hour=23,
    minute=45,
    id="daily_sync_job",
    replace_existing=True,
)

scheduler.add_job(
    scheduled_update_short,
    "cron",
    hour="0,4,8,12,16,20",
    minute=15,
    id="hourly_sync_job",
    replace_existing=True,
)

scheduler.add_job(
    scheduled_storage_cleanup,
    "cron",
    hour=1,
    minute=30,
    id="daily_storage_cleanup",
    replace_existing=True,
)

scheduler.add_job(
    run_all_alert_checks,
    "interval",
    minutes=15,
    id="near_real_time_alert_checks",
    replace_existing=True,
    max_instances=1,
)

scheduler.add_job(
    run_urgent_alert_delivery,
    "interval",
    minutes=5,
    id="urgent_alert_email_retry",
    replace_existing=True,
    max_instances=1,
)

scheduler.add_job(
    run_morning_briefing,
    "cron",
    hour=7,
    minute=0,
    id="morning_briefing",
    replace_existing=True,
    misfire_grace_time=3600,
)
