import datetime
import html
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import (
    ALERT_EMAIL_ENABLED,
    ALERT_FROM_EMAIL,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USER,
    URGENT_ALERT_DUPLICATE_SUPPRESSION_HOURS,
    URGENT_ALERT_LOOKBACK_HOURS,
    URGENT_ALERT_MIN_PRIORITY,
    URGENT_ALERT_RATE_LIMIT_PER_HOUR,
    URGENT_ALERT_RETRY_BACKOFF_MINUTES,
    URGENT_ALERT_RETRY_MAX_ATTEMPTS,
)
from app.core.database import AlertDeliveryLog, Events, SessionLocal, UserDB
from app.core.schemas import EventType, StatusType

logger = logging.getLogger(__name__)

CHANNEL_EMAIL = "email"
STATUS_PENDING = "PENDING"
STATUS_SENT = "SENT"
STATUS_FAILED = "FAILED"
STATUS_SUPPRESSED = "SUPPRESSED"
STATUS_RATE_LIMITED = "RATE_LIMITED"

PRIORITY_ORDER = {
    "LOW": 10,
    "MEDIUM": 20,
    "HIGH": 30,
    "CRITICAL": 40,
}

SEVERITY_TO_PRIORITY = {
    "INFO": "LOW",
    "WARNING": "MEDIUM",
    "HIGH": "HIGH",
    "ERROR": "CRITICAL",
    "CRITICAL": "CRITICAL",
}

SYSTEM_CRITICAL_TYPES = {
    EventType.API_ERROR,
    EventType.DATA_CORRUPTION,
    EventType.GATEWAY_DISCONNECTED,
    EventType.SENSOR_OFFLINE,
}


def priority_for_event(event: Events) -> str:
    severity = str(event.severity or "INFO").upper()
    priority = SEVERITY_TO_PRIORITY.get(severity, "LOW")
    if event.event_type in SYSTEM_CRITICAL_TYPES and priority == "MEDIUM":
        return "HIGH"
    return priority


def _priority_at_least(priority: str, minimum: str) -> bool:
    return PRIORITY_ORDER.get(priority, 0) >= PRIORITY_ORDER.get(minimum, PRIORITY_ORDER["HIGH"])


def _event_title(event: Events) -> str:
    return str(event.event_type.value if hasattr(event.event_type, "value") else event.event_type).replace("_", " ").title()


def _recommended_action(event: Events) -> str:
    meta = event.extra_metadata or {}
    if meta.get("recommended_action"):
        return str(meta["recommended_action"])

    actions = {
        EventType.DISEASE_DETECTION: "Inspect the affected crop block and review treatment timing.",
        EventType.FROST_HAZARD: "Protect sensitive crops and delay frost-sensitive work.",
        EventType.HEAT_STRESS: "Check irrigation readiness and inspect vulnerable fields.",
        EventType.HEAVY_RAIN: "Inspect drainage and avoid heavy field traffic.",
        EventType.HIGH_WIND: "Secure equipment and avoid spraying.",
        EventType.DROUGHT_WARNING: "Prioritize irrigation and monitor stressed fields.",
        EventType.LOW_SOIL_MOISTURE: "Check soil moisture and consider irrigation.",
        EventType.HIGH_SOIL_MOISTURE: "Avoid field traffic and inspect drainage.",
        EventType.SENSOR_OFFLINE: "Check the sensor power, connectivity, and last transmission.",
        EventType.METRIC_ANOMALY: "Review the affected metric and inspect the field if confirmed.",
        EventType.NDVI_DROP: "Inspect crop vigor and compare with recent satellite imagery.",
        EventType.EVI_ANOMALY: "Review vegetation index change and inspect the field.",
        EventType.API_ERROR: "Check service logs and restore the failing integration.",
        EventType.DATA_CORRUPTION: "Pause dependent processing and verify the affected data.",
        EventType.GATEWAY_DISCONNECTED: "Check gateway power and network connectivity.",
    }
    return actions.get(event.event_type, "Review the alert in SmartCrop Monitor and take the appropriate action.")


def _context_lines(event: Events) -> list[tuple[str, str]]:
    meta = event.extra_metadata or {}
    keys = [
        "location_label",
        "field_label",
        "sensor_label",
        "model",
        "risk_level",
        "metric",
        "metric_type",
        "value",
        "threshold",
        "confidence",
        "urgency",
        "score",
        "source_timestamp",
        "window_end_date",
        "reason",
    ]

    lines = []
    for key in keys:
        value = meta.get(key)
        if value is not None:
            label = key.replace("_", " ").title()
            lines.append((label, str(value)))
    return lines[:10]


def _build_email(event: Events, user: UserDB, priority: str) -> tuple[str, str, str]:
    title = _event_title(event)
    created_at = event.created_at or datetime.datetime.utcnow()
    action = _recommended_action(event)
    context = _context_lines(event)

    subject = f"[{priority}] SmartCrop urgent alert: {title}"

    text_lines = [
        f"{title}",
        f"Priority: {priority}",
        f"Severity: {event.severity}",
        f"Detected: {created_at:%Y-%m-%d %H:%M UTC}",
        "",
        f"Action: {action}",
    ]
    if context:
        text_lines.extend(["", "Context:"])
        text_lines.extend(f"- {label}: {value}" for label, value in context)

    context_rows = "".join(
        "<tr>"
        f"<td style=\"padding:4px 0;color:#667085;width:150px;\">{html.escape(label)}</td>"
        f"<td style=\"padding:4px 0;color:#101828;font-weight:600;\">{html.escape(value)}</td>"
        "</tr>"
        for label, value in context
    )

    html_body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#101828;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:24px 12px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e7ec;border-radius:8px;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #e4e7ec;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#b42318;font-weight:700;">Urgent SmartCrop Alert</div>
          <div style="font-size:22px;line-height:1.25;font-weight:700;margin-top:6px;">{html.escape(title)}</div>
          <div style="font-size:13px;color:#667085;margin-top:6px;">{html.escape(created_at.strftime('%Y-%m-%d %H:%M UTC'))}</div>
        </td></tr>
        <tr><td style="padding:18px 24px;">
          <div style="font-size:14px;color:#667085;">Priority</div>
          <div style="font-size:16px;font-weight:700;color:#b42318;">{html.escape(priority)} / {html.escape(str(event.severity))}</div>
          <div style="margin-top:16px;font-size:14px;color:#667085;">Recommended action</div>
          <div style="font-size:16px;line-height:1.45;font-weight:700;">{html.escape(action)}</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
            {context_rows}
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    return subject, "\n".join(text_lines), html_body


def _smtp_ready() -> bool:
    return bool(ALERT_EMAIL_ENABLED and SMTP_HOST and SMTP_USER and SMTP_PASSWORD and ALERT_FROM_EMAIL)


def _send_email(recipient: str, subject: str, text_body: str, html_body: str) -> None:
    if not _smtp_ready():
        raise RuntimeError("Urgent email alert SMTP configuration is incomplete or disabled")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = ALERT_FROM_EMAIL
    msg["To"] = recipient
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(ALERT_FROM_EMAIL, recipient, msg.as_string())


def _delivery_log(db: Session, event: Events, user: UserDB, priority: str) -> AlertDeliveryLog:
    log = (
        db.query(AlertDeliveryLog)
        .filter(
            AlertDeliveryLog.event_id == event.id,
            AlertDeliveryLog.channel == CHANNEL_EMAIL,
        )
        .first()
    )
    if log:
        return log

    log = AlertDeliveryLog(
        event_id=event.id,
        user_id=event.user_id,
        channel=CHANNEL_EMAIL,
        recipient=user.email,
        priority=priority,
        status=STATUS_PENDING,
    )
    db.add(log)
    db.flush()
    return log


def _sent_duplicate_exists(db: Session, event: Events, now: datetime.datetime) -> bool:
    since = now - datetime.timedelta(hours=URGENT_ALERT_DUPLICATE_SUPPRESSION_HOURS)
    return (
        db.query(AlertDeliveryLog)
        .join(Events, AlertDeliveryLog.event_id == Events.id)
        .filter(
            AlertDeliveryLog.user_id == event.user_id,
            AlertDeliveryLog.channel == CHANNEL_EMAIL,
            AlertDeliveryLog.status == STATUS_SENT,
            AlertDeliveryLog.sent_at >= since,
            Events.dedup_key == event.dedup_key,
            Events.id != event.id,
        )
        .first()
        is not None
    )


def _rate_limited(db: Session, user_id: int, now: datetime.datetime) -> bool:
    since = now - datetime.timedelta(hours=1)
    sent_count = (
        db.query(func.count(AlertDeliveryLog.id))
        .filter(
            AlertDeliveryLog.user_id == user_id,
            AlertDeliveryLog.channel == CHANNEL_EMAIL,
            AlertDeliveryLog.status == STATUS_SENT,
            AlertDeliveryLog.sent_at >= since,
        )
        .scalar()
        or 0
    )
    return sent_count >= URGENT_ALERT_RATE_LIMIT_PER_HOUR


def _mark_retryable_failure(log: AlertDeliveryLog, error: str, now: datetime.datetime) -> None:
    log.attempt_count = (log.attempt_count or 0) + 1
    log.status = STATUS_FAILED
    log.last_error = error[:1000]
    log.next_retry_at = now + datetime.timedelta(
        minutes=URGENT_ALERT_RETRY_BACKOFF_MINUTES * max(1, log.attempt_count)
    )


def _is_due(log: AlertDeliveryLog | None, now: datetime.datetime) -> bool:
    if log is None:
        return True
    if log.status == STATUS_SENT:
        return False
    if (log.attempt_count or 0) >= URGENT_ALERT_RETRY_MAX_ATTEMPTS and log.status == STATUS_FAILED:
        return False
    return log.next_retry_at is None or log.next_retry_at <= now


def _candidate_query(db: Session, event_ids: Optional[Iterable[int]] = None):
    now = datetime.datetime.utcnow()
    since = now - datetime.timedelta(hours=URGENT_ALERT_LOOKBACK_HOURS)
    query = db.query(Events).filter(
        Events.status == StatusType.ACTIVE,
        Events.created_at >= since,
    )
    if event_ids is not None:
        ids = [int(event_id) for event_id in event_ids]
        if not ids:
            return []
        query = query.filter(Events.id.in_(ids))
    return query.order_by(Events.created_at.asc()).all()


def deliver_pending_urgent_alerts(
    db: Session,
    event_ids: Optional[Iterable[int]] = None,
    *,
    min_priority: str = URGENT_ALERT_MIN_PRIORITY,
) -> dict:
    stats = {"checked": 0, "sent": 0, "suppressed": 0, "rate_limited": 0, "failed": 0, "skipped": 0}
    now = datetime.datetime.utcnow()

    for event in _candidate_query(db, event_ids):
        if (event.extra_metadata or {}).get("notify") is False:
            stats["skipped"] += 1
            continue

        priority = priority_for_event(event)
        if not _priority_at_least(priority, min_priority):
            continue

        stats["checked"] += 1
        user = db.get(UserDB, event.user_id)
        if not user or not user.email:
            logger.info("Urgent alert %s skipped: user has no email", event.id)
            stats["skipped"] += 1
            continue
        if not user.email_enabled:
            logger.info("Urgent alert %s skipped: email notifications disabled for user %s", event.id, user.id)
            stats["skipped"] += 1
            continue

        log = _delivery_log(db, event, user, priority)
        if not _is_due(log, now):
            stats["skipped"] += 1
            continue

        if log.status == STATUS_PENDING and _sent_duplicate_exists(db, event, now):
            log.status = STATUS_SUPPRESSED
            log.last_error = None
            log.next_retry_at = None
            log.extra_metadata = {"reason": "duplicate_dedup_key_within_suppression_window"}
            logger.info("Urgent alert %s suppressed as duplicate (%s)", event.id, event.dedup_key)
            stats["suppressed"] += 1
            continue

        if _rate_limited(db, event.user_id, now):
            log.status = STATUS_RATE_LIMITED
            log.next_retry_at = now + datetime.timedelta(hours=1)
            log.extra_metadata = {"reason": "per_user_hourly_rate_limit"}
            logger.warning("Urgent alert %s deferred by user rate limit", event.id)
            stats["rate_limited"] += 1
            continue

        subject, text_body, html_body = _build_email(event, user, priority)
        try:
            _send_email(user.email, subject, text_body, html_body)
            log.status = STATUS_SENT
            log.priority = priority
            log.recipient = user.email
            log.sent_at = now
            log.next_retry_at = None
            log.last_error = None
            log.attempt_count = (log.attempt_count or 0) + 1
            logger.info("Urgent alert %s delivered to %s", event.id, user.email)
            stats["sent"] += 1
        except Exception as exc:
            _mark_retryable_failure(log, str(exc), now)
            logger.error("Urgent alert %s delivery failed: %s", event.id, exc)
            stats["failed"] += 1

    db.commit()
    return stats


def run_urgent_alert_delivery() -> dict:
    db = SessionLocal()
    try:
        return deliver_pending_urgent_alerts(db)
    except Exception:
        db.rollback()
        logger.exception("Urgent alert delivery job failed")
        raise
    finally:
        db.close()
