
from __future__ import annotations
import datetime
import logging
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.database import (
    AlertSuppressionRule,
    FieldUnit,
    FieldWork,
    SeasonRecord,
    UserDB,
    get_db,
)
from app.core.schemas import FieldWorkType
from app.core.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alert-suppression", tags=["alert-suppression"])

def _in_seasonal_window(rule: AlertSuppressionRule, now: datetime.datetime) -> bool:
    mf = rule.season_month_from
    df = rule.season_day_from
    mt = rule.season_month_to
    dt_ = rule.season_day_to

    if not mf or not mt:
        return True

    df = df or 1
    dt_ = dt_ or 28

    month_now = now.month
    day_now   = now.day

    def _md(m, d):
        return m * 100 + d

    md_now  = _md(month_now, day_now)
    md_from = _md(mf, df)
    md_to   = _md(mt, dt_)

    if md_from <= md_to:
        return md_from <= md_now <= md_to
    else:
        return md_now >= md_from or md_now <= md_to


def _harvested_this_season(db: Session, field_id: int) -> bool:
    year_start = datetime.datetime(datetime.datetime.utcnow().year, 1, 1)
    result = db.execute(
        select(FieldWork)
        .where(
            FieldWork.field_id == field_id,
            FieldWork.work_type == FieldWorkType.HARVESTING,
            FieldWork.work_date >= year_start,
        )
        .limit(1)
    ).scalar_one_or_none()
    return result is not None


def _rule_applies_to_field(
    rule: AlertSuppressionRule,
    field_id: Optional[int],
    crop_type: Optional[str],
    location_id: Optional[int],
) -> bool:
    if rule.location_ids:
        if location_id not in (rule.location_ids or []):
            return False

    if rule.field_ids:
        if field_id not in (rule.field_ids or []):
            return False
        return True

    if rule.crop_types:
        return crop_type in (rule.crop_types or [])

    return True


def _rule_suppresses_alert_type(rule: AlertSuppressionRule, alert_type: str) -> bool:
    if not rule.alert_types:
        return True
    return alert_type in rule.alert_types


def is_suppressed(
    db: Session,
    *,
    user_id: int,
    alert_type: str,
    field_id: Optional[int] = None,
    crop_type: Optional[str] = None,
    location_id: Optional[int] = None,
    now: Optional[datetime.datetime] = None,
) -> bool:
    now = now or datetime.datetime.utcnow()

    rules: list[AlertSuppressionRule] = db.execute(
        select(AlertSuppressionRule).where(
            AlertSuppressionRule.user_id == user_id,
            AlertSuppressionRule.is_active == True,
        )
    ).scalars().all()

    for rule in rules:
        if rule.valid_from and now < rule.valid_from:
            continue
        if rule.valid_until and now > rule.valid_until:
            continue

        if not _rule_applies_to_field(rule, field_id, crop_type, location_id):
            continue

        if not _rule_suppresses_alert_type(rule, alert_type):
            continue

        if not _in_seasonal_window(rule, now):
            continue

        if rule.arm_after_harvest:
            if field_id is None or not _harvested_this_season(db, field_id):
                continue

        logger.debug(
            "[SUPPRESSION] alert_type=%s field_id=%s suppressed by rule #%d '%s'",
            alert_type, field_id, rule.id, rule.name,
        )
        return True

    return False


class SuppressionRuleBase(BaseModel):
    name:        str = Field(..., max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    is_active:   bool = True

    field_ids:    Optional[list[int]]   = None
    crop_types:   Optional[list[str]]   = None
    location_ids: Optional[list[int]]   = None

    alert_types:  Optional[list[str]]   = None

    season_month_from: Optional[int] = Field(None, ge=1, le=12)
    season_day_from:   Optional[int] = Field(None, ge=1, le=31)
    season_month_to:   Optional[int] = Field(None, ge=1, le=12)
    season_day_to:     Optional[int] = Field(None, ge=1, le=31)

    arm_after_harvest: bool = False

    valid_from:  Optional[datetime.datetime] = None
    valid_until: Optional[datetime.datetime] = None


class SuppressionRuleCreate(SuppressionRuleBase):
    pass


class SuppressionRuleUpdate(SuppressionRuleBase):
    name:      Optional[str]  = None
    is_active: Optional[bool] = None


class SuppressionRuleOut(SuppressionRuleBase):
    id:         int
    user_id:    int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


def _get_rule_or_404(db: Session, rule_id: int, user_id: int) -> AlertSuppressionRule:
    rule = db.execute(
        select(AlertSuppressionRule).where(
            AlertSuppressionRule.id == rule_id,
            AlertSuppressionRule.user_id == user_id,
        )
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Suppression rule not found")
    return rule


# API Router

@router.get("/", response_model=list[SuppressionRuleOut])
def list_rules(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    return db.execute(
        select(AlertSuppressionRule)
        .where(AlertSuppressionRule.user_id == user_id)
        .order_by(AlertSuppressionRule.created_at.desc())
    ).scalars().all()


@router.post("/", response_model=SuppressionRuleOut, status_code=201)
def create_rule(
    payload: SuppressionRuleCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    rule = AlertSuppressionRule(user_id=user_id, **payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    logger.info("[SUPPRESSION] user=%d created rule #%d '%s'", user_id, rule.id, rule.name)
    return rule


@router.get("/{rule_id}", response_model=SuppressionRuleOut)
def get_rule(
    rule_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _get_rule_or_404(db, rule_id, current_user.id)


@router.patch("/{rule_id}", response_model=SuppressionRuleOut)
def update_rule(
    rule_id: int,
    payload: SuppressionRuleUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = _get_rule_or_404(db, rule_id, current_user.id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = _get_rule_or_404(db, rule_id, current_user.id)
    db.delete(rule)
    db.commit()


@router.post("/{rule_id}/toggle", response_model=SuppressionRuleOut)
def toggle_rule(
    rule_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = _get_rule_or_404(db, rule_id, current_user.id)
    rule.is_active = not rule.is_active
    db.commit()
    db.refresh(rule)
    return rule
