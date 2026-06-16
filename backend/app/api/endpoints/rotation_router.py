from __future__ import annotations

import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import (
    Biomass,
    FieldUnit,
    GrazingRotation,
    GrazingRotationEntry,
    UserLocation,
    UserDB,
    get_db,
)
from app.core.schemas import RotationStatus
from app.core.security import get_current_user

# ── Helper functions copied from field_router ────────────────────────────────
# (avoids circular imports — keep them local or move to a shared service module)

_KG_DM_PER_AUM_DAY   = 12.0
_BIOMASS_TO_DM_RATIO = 0.25
_UTILISATION_RATE    = 0.50
_DAYS_PER_MONTH      = 30

_STAGE_PRIORITY = {"peak": 4, "over": 3, "active": 2, "early": 1, "dormant": 0}


def _growth_stage(evi: float, biomass_tha: float) -> dict:
    if evi < 0.15 or biomass_tha < 0.3:
        return {"stage": "Dormant / Bare", "code": "dormant", "color": "#bdbdbd", "icon": "💤"}
    if evi < 0.30 or biomass_tha < 1.0:
        return {"stage": "Early Growth",   "code": "early",   "color": "#aed581", "icon": "🌱"}
    if evi < 0.50 or biomass_tha < 2.5:
        return {"stage": "Active Growth",  "code": "active",  "color": "#66bb6a", "icon": "🌿"}
    if evi < 0.65 or biomass_tha < 4.0:
        return {"stage": "Peak / Mature",  "code": "peak",    "color": "#2e7d32", "icon": "🌾"}
    return             {"stage": "Overmature",   "code": "over",    "color": "#827717", "icon": "🍂"}


def _rotation_recommendation(stage_code: str, area_ha: float, aum_capacity: float) -> dict:
    recs = {
        "dormant": {"action": "Rest field — avoid grazing", "rest_days": 60, "graze_days": 0},
        "early":   {"action": "Light grazing only (< 30 % utilisation)", "rest_days": 45, "graze_days": 3},
        "active":  {"action": "Begin rotation block",       "rest_days": 28, "graze_days": 5},
        "peak":    {"action": "Graze now — prime condition","rest_days": 21, "graze_days": 7},
        "over":    {"action": "Mow / top before grazing",   "rest_days": 14, "graze_days": 4},
    }
    r = dict(recs.get(stage_code, recs["dormant"]))
    r["aum_capacity"] = round(aum_capacity, 2)
    r["area_ha"]      = round(area_ha, 2)
    return r


# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter()


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class RotationEntryRead(BaseModel):
    id:               int
    rotation_id:      int
    field_id:         int
    field_label:      Optional[str]   = None
    sequence:         int
    graze_start:      datetime.datetime
    graze_end:        datetime.datetime
    rest_end:         datetime.datetime
    planned_aum:      Optional[float] = None
    actual_aum:       Optional[float] = None
    status:           str
    biomass_at_start: Optional[float] = None
    biomass_at_end:   Optional[float] = None
    notes:            Optional[str]   = None
    growth_stage:     Optional[dict]  = None

    class Config:
        from_attributes = True


class RotationRead(BaseModel):
    id:               int
    location_id:      int
    user_id:          int
    name:             str
    description:      Optional[str]            = None
    plan_start:       datetime.datetime
    plan_end:         Optional[datetime.datetime] = None
    total_aum_target: Optional[float]          = None
    notes:            Optional[str]            = None
    created_at:       datetime.datetime
    entries:          List[RotationEntryRead]  = []

    class Config:
        from_attributes = True


class RotationPlanRequest(BaseModel):
    user_id:          Optional[int] = None   # ignored — owner comes from the auth token
    location_id:      int
    name:             str
    plan_start:       datetime.datetime
    total_aum_target: Optional[float] = None
    description:      Optional[str]   = None
    notes:            Optional[str]   = None


class RotationEntryUpdate(BaseModel):
    status:           Optional[str]            = None
    actual_aum:       Optional[float]          = None
    biomass_at_start: Optional[float]          = None
    biomass_at_end:   Optional[float]          = None
    notes:            Optional[str]            = None
    graze_start:      Optional[datetime.datetime] = None
    graze_end:        Optional[datetime.datetime] = None
    rest_end:         Optional[datetime.datetime] = None


# ── Internal helpers ─────────────────────────────────────────────────────────

def _entry_from_field(
    rotation_id: int,
    field: FieldUnit,
    biomass: Biomass | None,
    sequence: int,
    window_start: datetime.datetime,
) -> GrazingRotationEntry:
    area    = float(field.area_ha or 0)
    evi_val = float(biomass.evi)         if biomass else 0.0
    bio_val = float(biomass.biomass_tha) if biomass else 0.0

    stage      = _growth_stage(evi_val, bio_val)
    recco      = _rotation_recommendation(stage["code"], area, 0.0)
    graze_days = max(recco["graze_days"], 1)
    rest_days  = max(recco["rest_days"],  1)
    graze_end  = window_start + datetime.timedelta(days=graze_days)
    rest_end   = graze_end    + datetime.timedelta(days=rest_days)

    dm_kg = bio_val * 1000 * area * _BIOMASS_TO_DM_RATIO * _UTILISATION_RATE
    aum   = dm_kg / (_KG_DM_PER_AUM_DAY * _DAYS_PER_MONTH)

    return GrazingRotationEntry(
        rotation_id      = rotation_id,
        field_id         = field.id,
        sequence         = sequence,
        graze_start      = window_start,
        graze_end        = graze_end,
        rest_end         = rest_end,
        planned_aum      = round(aum, 2),
        biomass_at_start = round(bio_val, 4) if biomass else None,
        status           = RotationStatus.PLANNED,
    )


def _serialize_rotation(rotation: GrazingRotation, db: Session) -> dict:
    entries_out = []
    for e in (rotation.entries or []):
        field = db.get(FieldUnit, e.field_id)
        stage = None
        if field:
            latest_b = (
                db.query(Biomass)
                .filter(Biomass.field_id == e.field_id)
                .order_by(Biomass.analysis_date.desc())
                .first()
            )
            if latest_b:
                stage = _growth_stage(float(latest_b.evi), float(latest_b.biomass_tha))

        entries_out.append({
            "id":               e.id,
            "rotation_id":      e.rotation_id,
            "field_id":         e.field_id,
            "field_label":      field.label if field else None,
            "sequence":         e.sequence,
            "graze_start":      e.graze_start,
            "graze_end":        e.graze_end,
            "rest_end":         e.rest_end,
            "planned_aum":      float(e.planned_aum)      if e.planned_aum      is not None else None,
            "actual_aum":       float(e.actual_aum)       if e.actual_aum       is not None else None,
            "status":           e.status.value if hasattr(e.status, "value") else e.status,
            "biomass_at_start": float(e.biomass_at_start) if e.biomass_at_start is not None else None,
            "biomass_at_end":   float(e.biomass_at_end)   if e.biomass_at_end   is not None else None,
            "notes":            e.notes,
            "growth_stage":     stage,
        })

    return {
        "id":               rotation.id,
        "location_id":      rotation.location_id,
        "user_id":          rotation.user_id,
        "name":             rotation.name,
        "description":      rotation.description,
        "plan_start":       rotation.plan_start,
        "plan_end":         rotation.plan_end,
        "total_aum_target": float(rotation.total_aum_target) if rotation.total_aum_target is not None else None,
        "notes":            rotation.notes,
        "created_at":       rotation.created_at,
        "entries":          entries_out,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/plan", response_model=RotationRead)
def create_rotation_plan(
    payload: RotationPlanRequest,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    POST /api/v1/rotation/plan

    Auto-generates a rotation schedule for all active pasture fields at the
    given location, sorted by growth-stage readiness (peak → over → active →
    early → dormant). Each paddock gets sequential graze / rest windows.
    """
    location = db.query(UserLocation).filter(
        UserLocation.id == payload.location_id,
        UserLocation.user_id == current_user.id,
    ).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found or access denied")

    pasture_fields = (
        db.query(FieldUnit)
        .filter(
            FieldUnit.location_id == payload.location_id,
            FieldUnit.field_type  == "pasture",
            FieldUnit.status      == "active",
            FieldUnit.deleted_at.is_(None),
        )
        .all()
    )
    if not pasture_fields:
        raise HTTPException(status_code=404, detail="No active pasture fields at this location")

    field_ids = [f.id for f in pasture_fields]
    latest_subq = (
        db.query(
            Biomass.field_id,
            func.max(Biomass.analysis_date).label("max_date"),
        )
        .filter(Biomass.field_id.in_(field_ids))
        .group_by(Biomass.field_id)
        .subquery()
    )
    biomass_rows = (
        db.query(Biomass)
        .join(
            latest_subq,
            (Biomass.field_id      == latest_subq.c.field_id) &
            (Biomass.analysis_date == latest_subq.c.max_date),
        )
        .all()
    )
    biomass_map = {r.field_id: r for r in biomass_rows}

    def _sort_key(f: FieldUnit) -> int:
        b     = biomass_map.get(f.id)
        evi   = float(b.evi)         if b else 0.0
        bio   = float(b.biomass_tha) if b else 0.0
        stage = _growth_stage(evi, bio)
        return _STAGE_PRIORITY.get(stage["code"], 0)

    ordered = sorted(pasture_fields, key=_sort_key, reverse=True)

    rotation = GrazingRotation(
        location_id      = payload.location_id,
        user_id          = current_user.id,
        name             = payload.name,
        description      = payload.description,
        plan_start       = payload.plan_start,
        total_aum_target = payload.total_aum_target,
        notes            = payload.notes,
    )
    db.add(rotation)
    db.flush()

    cursor: datetime.datetime = payload.plan_start
    entries: list[GrazingRotationEntry] = []

    for seq, field in enumerate(ordered):
        entry = _entry_from_field(rotation.id, field, biomass_map.get(field.id), seq, cursor)
        entries.append(entry)
        cursor = entry.graze_end

    rotation.plan_end = entries[-1].rest_end if entries else None
    db.add_all(entries)
    db.commit()
    db.refresh(rotation)

    return _serialize_rotation(rotation, db)


@router.get("/location/{location_id}", response_model=List[RotationRead])
def get_rotations_for_location(
    location_id: int,
    limit: int = 10,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    GET /api/v1/rotation/location/{location_id}

    Returns all rotation plans for a location, newest first,
    enriched with current growth-stage per entry.
    """
    rotations = (
        db.query(GrazingRotation)
        .filter(
            GrazingRotation.location_id == location_id,
            GrazingRotation.user_id == current_user.id,
        )
        .order_by(GrazingRotation.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_rotation(r, db) for r in rotations]


@router.patch("/entry/{entry_id}")
def update_rotation_entry(
    entry_id: int,
    payload: RotationEntryUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    PATCH /api/v1/rotation/entry/{entry_id}

    Update status, actual AUM, biomass snapshots, dates, or notes.

    Valid transitions:
      PLANNED   → GRAZING | SKIPPED
      GRAZING   → RESTING | COMPLETED | SKIPPED
      RESTING   → COMPLETED | GRAZING | SKIPPED
      COMPLETED → (none)
      SKIPPED   → PLANNED
    """
    VALID_TRANSITIONS: dict[str, set[str]] = {
        "PLANNED":   {"GRAZING",   "SKIPPED"},
        "GRAZING":   {"RESTING",   "SKIPPED", "COMPLETED"},
        "RESTING":   {"COMPLETED", "GRAZING", "SKIPPED"},
        "COMPLETED": set(),
        "SKIPPED":   {"PLANNED"},
    }

    entry = db.get(GrazingRotationEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Rotation entry not found")

    rotation = db.get(GrazingRotation, entry.rotation_id)
    if not rotation or rotation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Rotation entry not found")

    if payload.status is not None:
        new_status = payload.status.upper()
        current    = entry.status.value if hasattr(entry.status, "value") else str(entry.status)
        allowed    = VALID_TRANSITIONS.get(current, set())
        if new_status not in allowed and new_status != current:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot transition from {current} to {new_status}. "
                    f"Allowed: {sorted(allowed) or 'none'}"
                ),
            )
        entry.status = new_status

    if payload.actual_aum       is not None: entry.actual_aum       = payload.actual_aum
    if payload.biomass_at_start is not None: entry.biomass_at_start = payload.biomass_at_start
    if payload.biomass_at_end   is not None: entry.biomass_at_end   = payload.biomass_at_end
    if payload.notes            is not None: entry.notes            = payload.notes
    if payload.graze_start      is not None: entry.graze_start      = payload.graze_start
    if payload.graze_end        is not None: entry.graze_end        = payload.graze_end
    if payload.rest_end         is not None: entry.rest_end         = payload.rest_end

    entry.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(entry)

    field = db.get(FieldUnit, entry.field_id)
    return {
        "message":     "Entry updated",
        "id":          entry.id,
        "status":      entry.status.value if hasattr(entry.status, "value") else entry.status,
        "field_label": field.label if field else None,
    }


@router.delete("/{rotation_id}")
def delete_rotation(
    rotation_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    DELETE /api/v1/rotation/{rotation_id}
    """
    rotation = db.get(GrazingRotation, rotation_id)
    if not rotation:
        raise HTTPException(status_code=404, detail="Rotation not found")
    if rotation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    db.delete(rotation)
    db.commit()
    return {"message": "Rotation deleted", "id": rotation_id}