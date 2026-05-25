import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app.core.database import get_db, Events, UserDB
from app.core.config import (
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, BRIEFING_FROM_EMAIL
)
from app.core.schemas import StatusType

logger = logging.getLogger(__name__)


SEV_COLOR = {
    "CRITICAL": "#b71c1c",
    "ERROR":    "#c62828",
    "WARNING":  "#e65100",
    "INFO":     "#0d47a1",
}
SEV_BG = {
    "CRITICAL": "#fce4ec",
    "ERROR":    "#fce4ec",
    "WARNING":  "#fff8e1",
    "INFO":     "#e3f2fd",
}
EVT_ICONS = {
    "DISEASE_DETECTION": "🦠", "FROST_HAZARD": "❄️", "HEAT_STRESS": "🔥",
    "DROUGHT_WARNING": "🏜️",  "HEAVY_RAIN": "🌧️", "HAIL_STORM": "⛈️",
    "HIGH_WIND": "💨",         "NDVI_DROP": "🌿",   "METRIC_ANOMALY": "📊",
    "SENSOR_OFFLINE": "📡",   "LOW_BATTERY": "🔋", "PEST_OUTBREAK": "🐛",
}


def _build_html(user_name: str, alerts: list) -> str:
    today = datetime.now().strftime("%Y. %B %d.")

    if not alerts:
        body_rows = """
        <tr><td style="padding:24px;text-align:center;color:#aaa;font-size:14px;">
            Нет активных алертов. Всё хорошо! ✅
        </td></tr>"""
    else:
        rows = []
        for ev in alerts[:10]:
            icon  = EVT_ICONS.get(ev.event_type, "⚠️")
            color = SEV_COLOR.get(ev.severity, "#333")
            bg    = SEV_BG.get(ev.severity, "#f9f9f9")
            label = ev.event_type.replace("_", " ")
            rows.append(f"""
            <tr>
              <td style="padding:10px 20px;background:{bg};border-bottom:1px solid #eee;">
                <table cellpadding="0" cellspacing="0" width="100%"><tr>
                  <td width="30" style="font-size:20px;vertical-align:middle;">{icon}</td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <div style="font-weight:700;color:{color};font-size:14px;">{label}</div>
                    <div style="font-size:11px;color:#999;margin-top:2px;">
                      {ev.created_at.strftime('%Y-%m-%d %H:%M') if ev.created_at else ''}
                    </div>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="background:{bg};color:{color};border:1px solid {color};
                      border-radius:12px;padding:2px 10px;font-size:10px;font-weight:700;">
                      {ev.severity}
                    </span>
                  </td>
                </tr></table>
              </td>
            </tr>""")
        body_rows = "".join(rows)

        if len(alerts) > 10:
            body_rows += f"""
            <tr><td style="padding:10px 20px;text-align:center;color:#aaa;font-size:12px;">
                ... и ещё {len(alerts) - 10} алертов
            </td></tr>"""

    high_count = sum(1 for e in alerts if e.severity in ("CRITICAL", "ERROR"))
    summary_color = "#b71c1c" if high_count > 0 else ("#e65100" if alerts else "#2e7d32")
    summary_text  = (
        f"🔴 {high_count} критических алертов!" if high_count > 0
        else f"🟡 {len(alerts)} активных алертов" if alerts
        else "🟢 Всё в норме"
    )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:30px 10px;">
  <table width="580" cellpadding="0" cellspacing="0"
    style="background:#fff;border-radius:12px;overflow:hidden;
           box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <!-- Header -->
    <tr><td style="background:#4a2c0a;padding:24px 28px;">
      <div style="color:#f5e6c8;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">
        SmartCrop Monitor · {today}
      </div>
      <div style="color:#fff;font-size:22px;font-weight:bold;">☀️ Утренний брифинг</div>
      <div style="color:#c9a96e;font-size:13px;margin-top:4px;">Добрый день, {user_name}</div>
    </td></tr>

    <!-- Summary -->
    <tr><td style="padding:16px 20px;background:#fdf8f2;border-bottom:1px solid #e8ddd0;">
      <span style="font-size:14px;font-weight:700;color:{summary_color};">{summary_text}</span>
    </td></tr>

    <!-- Alert rows -->
    <table width="100%" cellpadding="0" cellspacing="0">
      {body_rows}
    </table>

    <!-- Footer -->
    <tr><td style="padding:18px 20px;background:#fdf8f2;border-top:1px solid #e8ddd0;
      font-size:11px;color:#bbb;text-align:center;">
      SmartCrop Monitor — автоматическая рассылка. Это письмо отправлено в 07:00 UTC.
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>"""


def send_morning_briefing_for_user(db: Session, user) -> bool:
    """Отправляет письмо одному пользователю. Возвращает True если успешно."""
    if not user.email or not user.email_enabled:
        return False

    active_alerts = (
        db.query(Events)
        .filter(Events.user_id == user.id, Events.status == StatusType.ACTIVE)
        .order_by(Events.created_at.desc())
        .all()
    )

    subject = (
        f"🔴 SmartCrop: {len(active_alerts)} активных алертов — {datetime.now().strftime('%d.%m.%Y')}"
        if active_alerts
        else f"✅ SmartCrop: всё в норме — {datetime.now().strftime('%d.%m.%Y')}"
    )

    html_body = _build_html(
        user_name=getattr(user, "username", None) or user.email.split("@")[0],
        alerts=active_alerts,
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = BRIEFING_FROM_EMAIL
    msg["To"]      = user.email
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(BRIEFING_FROM_EMAIL, user.email, msg.as_string())
        logger.info(f"[Briefing] Sent to {user.email} ({len(active_alerts)} alerts)")
        return True
    except Exception as e:
        logger.error(f"[Briefing] Failed to send to {user.email}: {e}")
        return False


def run_morning_briefing():
    logger.info("[Briefing] Starting morning briefing job...")
    db: Session = next(get_db())
    try:
        users = (
            db.query(UserDB)
            .filter(UserDB.email.isnot(None), UserDB.email_enabled == True)
            .all()
        )
        sent = sum(send_morning_briefing_for_user(db, u) for u in users)
        logger.info(f"[Briefing] Done. Sent: {sent}/{len(users)}")
    finally:
        db.close()


def start_briefing_scheduler():
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        run_morning_briefing,
        trigger=CronTrigger(hour=7, minute=0),
        id="morning_briefing",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("[Briefing] Scheduler started — daily at 07:00 UTC")
    return scheduler
