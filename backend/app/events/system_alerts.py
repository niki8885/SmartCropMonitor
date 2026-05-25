import datetime
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import Events, UserDB
from app.core.schemas import EventType, StatusType
from app.events.urgent_email_alerts import deliver_pending_urgent_alerts
from app.utils.general import _make_event_hash

logger = logging.getLogger(__name__)


def create_system_critical_alerts(
    db: Session,
    *,
    component: str,
    message: str,
    metadata: dict | None = None,
) -> dict:
    stats = {"users": 0, "created": 0, "existing": 0, "delivered": None}
    users = (
        db.query(UserDB)
        .filter(UserDB.email.isnot(None), UserDB.email_enabled == True)
        .all()
    )
    event_ids = []

    for user in users:
        now = datetime.datetime.utcnow()
        stats["users"] += 1
        dedup_key = f"system:{component}:{user.id}"
        existing = db.execute(
            select(Events).where(
                Events.user_id == user.id,
                Events.dedup_key == dedup_key,
                Events.status == StatusType.ACTIVE,
            )
        ).scalar_one_or_none()
        if existing:
            stats["existing"] += 1
            event_ids.append(existing.id)
            continue

        event = Events(
            user_id=user.id,
            event_type=EventType.API_ERROR,
            event_hash=_make_event_hash("system", component, user.id, now.isoformat()),
            dedup_key=dedup_key,
            severity="CRITICAL",
            status=StatusType.ACTIVE,
            expires_at=now + datetime.timedelta(hours=12),
            extra_metadata={
                "component": component,
                "message": message,
                "recommended_action": "Check service logs and restore the failing system component.",
                **(metadata or {}),
            },
        )
        db.add(event)
        db.flush()
        event_ids.append(event.id)
        stats["created"] += 1

    db.commit()
    if event_ids:
        stats["delivered"] = deliver_pending_urgent_alerts(db, event_ids=event_ids)
    logger.warning("System-critical alerts recorded: %s", stats)
    return stats
