from datetime import date, datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import (
    get_db,
    Equipment,
    EquipmentMaintenance,
    EquipmentUsageLog,
    FieldWork,
    FieldUnit,
    UserDB,
)
from app.core.security import get_current_user
from app.core.schemas import (
    EquipmentType, EquipmentStatus, FuelType, MaintenanceType,
)

router = APIRouter()

class EquipmentCreate(BaseModel):
    name:               str
    equipment_type:     EquipmentType
    manufacturer:       Optional[str]  = None
    model:              Optional[str]  = None
    year_of_manufacture: Optional[int] = None
    serial_number:      Optional[str]  = None
    registration_plate: Optional[str]  = None
    inventory_number:   Optional[str]  = None

    power_kw:           Optional[float] = None
    working_width_m:    Optional[float] = None
    tank_capacity_l:    Optional[float] = None
    fuel_type:          Optional[FuelType] = FuelType.DIESEL
    weight_kg:          Optional[float] = None

    hours_initial:      Optional[float] = 0
    hours_service_interval: Optional[float] = None

    status:             Optional[EquipmentStatus] = EquipmentStatus.OPERATIONAL
    is_owned:           Optional[bool]  = True
    purchase_date:      Optional[date]  = None
    purchase_price:     Optional[float] = None
    insurance_expiry:   Optional[date]  = None
    next_service_date:  Optional[date]  = None
    notes:              Optional[str]   = None


class EquipmentUpdate(BaseModel):
    name:               Optional[str]  = None
    equipment_type:     Optional[EquipmentType] = None
    manufacturer:       Optional[str]  = None
    model:              Optional[str]  = None
    year_of_manufacture: Optional[int] = None
    serial_number:      Optional[str]  = None
    registration_plate: Optional[str]  = None
    inventory_number:   Optional[str]  = None

    power_kw:           Optional[float] = None
    working_width_m:    Optional[float] = None
    tank_capacity_l:    Optional[float] = None
    fuel_type:          Optional[FuelType] = None
    weight_kg:          Optional[float] = None

    hours_current:      Optional[float] = None
    hours_service_interval: Optional[float] = None

    status:             Optional[EquipmentStatus] = None
    is_owned:           Optional[bool]  = None
    purchase_date:      Optional[date]  = None
    purchase_price:     Optional[float] = None
    insurance_expiry:   Optional[date]  = None
    next_service_date:  Optional[date]  = None
    notes:              Optional[str]   = None


class EquipmentRead(BaseModel):
    id:                 int
    user_id:            int
    name:               str
    equipment_type:     str
    manufacturer:       Optional[str]
    model:              Optional[str]
    year_of_manufacture: Optional[int]
    serial_number:      Optional[str]
    registration_plate: Optional[str]
    inventory_number:   Optional[str]

    power_kw:           Optional[float]
    working_width_m:    Optional[float]
    tank_capacity_l:    Optional[float]
    fuel_type:          Optional[str]
    weight_kg:          Optional[float]

    hours_initial:      Optional[float]
    hours_current:      Optional[float]
    hours_service_interval: Optional[float]

    status:             str
    is_owned:           bool
    purchase_date:      Optional[date]
    purchase_price:     Optional[float]
    insurance_expiry:   Optional[date]
    next_service_date:  Optional[date]
    notes:              Optional[str]
    created_at:         datetime
    updated_at:         datetime
    deleted_at:         Optional[datetime]

    # Computed summary (populated by endpoint, not stored)
    total_hours_logged:   Optional[float] = None
    total_fuel_logged_l:  Optional[float] = None
    total_area_logged_ha: Optional[float] = None
    last_maintenance_date: Optional[date] = None

    class Config:
        from_attributes = True


# ── Maintenance ───────────────────────────────────────────────────────────────

class MaintenanceCreate(BaseModel):
    maintenance_date:  date
    maintenance_type:  MaintenanceType
    description:       Optional[str]  = None
    hours_at_service:  Optional[float] = None
    cost:              Optional[float] = None
    parts_cost:        Optional[float] = None
    labour_cost:       Optional[float] = None
    performed_by:      Optional[str]  = None
    invoice_ref:       Optional[str]  = None
    next_service_hours: Optional[float] = None
    next_service_date:  Optional[date]  = None
    notes:             Optional[str]  = None


class MaintenanceUpdate(BaseModel):
    maintenance_date:  Optional[date]  = None
    maintenance_type:  Optional[MaintenanceType] = None
    description:       Optional[str]  = None
    hours_at_service:  Optional[float] = None
    cost:              Optional[float] = None
    parts_cost:        Optional[float] = None
    labour_cost:       Optional[float] = None
    performed_by:      Optional[str]  = None
    invoice_ref:       Optional[str]  = None
    next_service_hours: Optional[float] = None
    next_service_date:  Optional[date]  = None
    notes:             Optional[str]  = None


class MaintenanceRead(BaseModel):
    id:               int
    equipment_id:     int
    user_id:          int
    maintenance_date: date
    maintenance_type: str
    description:      Optional[str]
    hours_at_service: Optional[float]
    cost:             Optional[float]
    parts_cost:       Optional[float]
    labour_cost:      Optional[float]
    performed_by:     Optional[str]
    invoice_ref:      Optional[str]
    next_service_hours: Optional[float]
    next_service_date:  Optional[date]
    notes:            Optional[str]
    created_at:       datetime

    class Config:
        from_attributes = True


# ── Usage log ─────────────────────────────────────────────────────────────────

class UsageCreate(BaseModel):
    used_date:        date
    field_work_id:    Optional[int]   = None
    field_id:         Optional[int]   = None
    hours_start:      Optional[float] = None
    hours_end:        Optional[float] = None
    hours_worked:     Optional[float] = None   # override if odometer not tracked
    area_ha:          Optional[float] = None
    distance_km:      Optional[float] = None
    fuel_consumed_l:  Optional[float] = None
    fuel_cost:        Optional[float] = None
    operator_name:    Optional[str]   = None
    notes:            Optional[str]   = None


class UsageUpdate(BaseModel):
    used_date:        Optional[date]  = None
    field_work_id:    Optional[int]   = None
    field_id:         Optional[int]   = None
    hours_start:      Optional[float] = None
    hours_end:        Optional[float] = None
    hours_worked:     Optional[float] = None
    area_ha:          Optional[float] = None
    distance_km:      Optional[float] = None
    fuel_consumed_l:  Optional[float] = None
    fuel_cost:        Optional[float] = None
    operator_name:    Optional[str]   = None
    notes:            Optional[str]   = None


class UsageRead(BaseModel):
    id:              int
    equipment_id:    int
    user_id:         int
    field_work_id:   Optional[int]
    field_id:        Optional[int]
    used_date:       date
    hours_start:     Optional[float]
    hours_end:       Optional[float]
    hours_worked:    Optional[float]
    area_ha:         Optional[float]
    distance_km:     Optional[float]
    fuel_consumed_l: Optional[float]
    fuel_cost:       Optional[float]
    operator_name:   Optional[str]
    notes:           Optional[str]
    created_at:      datetime

    # Denormalised labels (populated by endpoint)
    field_label:      Optional[str] = None
    work_type:        Optional[str] = None

    class Config:
        from_attributes = True


# =============================================================================
# Helpers
# =============================================================================

def _eq_or_404(db: Session, equipment_id: int, user_id: int) -> Equipment:
    eq = db.get(Equipment, equipment_id)
    if not eq or eq.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if eq.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your equipment")
    return eq


def _build_eq_read(eq: Equipment, db: Session) -> dict:
    """Augment ORM object with computed aggregates."""
    from sqlalchemy import func as sqlfunc
    row = eq.__dict__.copy()

    agg = (
        db.query(
            sqlfunc.sum(EquipmentUsageLog.hours_worked).label("hrs"),
            sqlfunc.sum(EquipmentUsageLog.fuel_consumed_l).label("fuel"),
            sqlfunc.sum(EquipmentUsageLog.area_ha).label("area"),
        )
        .filter_by(equipment_id=eq.id)
        .first()
    )
    row["total_hours_logged"]   = float(agg.hrs)  if agg.hrs  else None
    row["total_fuel_logged_l"]  = float(agg.fuel) if agg.fuel else None
    row["total_area_logged_ha"] = float(agg.area) if agg.area else None

    last_m = (
        db.query(EquipmentMaintenance.maintenance_date)
        .filter_by(equipment_id=eq.id)
        .order_by(EquipmentMaintenance.maintenance_date.desc())
        .first()
    )
    row["last_maintenance_date"] = last_m.maintenance_date if last_m else None
    return row


# =============================================================================
# Equipment CRUD
# NOTE: All literal-prefix routes (/user, /types, /summary) are declared
# BEFORE the bare /{equipment_id} wildcard so FastAPI matches them correctly.
# =============================================================================

@router.get("/user", response_model=List[EquipmentRead])
def list_equipment(
    status: Optional[str] = None,
    equipment_type: Optional[str] = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all active equipment for the current user, with computed usage/maintenance summary."""
    user_id = current_user.id
    q = db.query(Equipment).filter(
        Equipment.user_id == user_id,
        Equipment.deleted_at.is_(None),
    )
    if status:
        q = q.filter(Equipment.status == status)
    if equipment_type:
        q = q.filter(Equipment.equipment_type == equipment_type)
    items = q.order_by(Equipment.equipment_type, Equipment.name).all()
    return [_build_eq_read(eq, db) for eq in items]


@router.get("/types", response_model=List[str])
def list_equipment_types():
    """Return all valid EquipmentType values for frontend dropdowns."""
    return [e.value for e in EquipmentType]


@router.get("/summary/user")
def equipment_summary(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fleet summary: counts by type and status, total hours logged this year."""
    user_id = current_user.id
    from sqlalchemy import func as sqlfunc, extract
    from collections import defaultdict

    items = db.query(Equipment).filter(
        Equipment.user_id == user_id,
        Equipment.deleted_at.is_(None),
    ).all()

    by_type   = defaultdict(int)
    by_status = defaultdict(int)
    for eq in items:
        by_type[eq.equipment_type.value]   += 1
        by_status[eq.status.value]         += 1

    current_year = datetime.utcnow().year
    year_hours = (
        db.query(sqlfunc.sum(EquipmentUsageLog.hours_worked))
        .join(Equipment, EquipmentUsageLog.equipment_id == Equipment.id)
        .filter(
            Equipment.user_id == user_id,
            extract("year", EquipmentUsageLog.used_date) == current_year,
        )
        .scalar()
    )

    due_service = (
        db.query(Equipment)
        .filter(
            Equipment.user_id == user_id,
            Equipment.deleted_at.is_(None),
            Equipment.next_service_date <= date.today(),
        )
        .count()
    )

    return {
        "total":          len(items),
        "by_type":        dict(by_type),
        "by_status":      dict(by_status),
        "year_hours_logged": float(year_hours) if year_hours else 0.0,
        "overdue_service":   due_service,
    }


@router.post("/create", response_model=EquipmentRead, status_code=201)
def create_equipment(
    data: EquipmentCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = Equipment(
        user_id=current_user.id,
        **data.model_dump(),
    )
    eq.hours_current = data.hours_initial or 0
    db.add(eq)
    db.commit()
    db.refresh(eq)
    return _build_eq_read(eq, db)


@router.get("/{equipment_id}", response_model=EquipmentRead)
def get_equipment(
    equipment_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _eq_or_404(db, equipment_id, current_user.id)
    return _build_eq_read(eq, db)


@router.patch("/{equipment_id}", response_model=EquipmentRead)
def update_equipment(
    equipment_id: int,
    data: EquipmentUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _eq_or_404(db, equipment_id, current_user.id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(eq, k, v)
    db.commit()
    db.refresh(eq)
    return _build_eq_read(eq, db)


@router.delete("/{equipment_id}", status_code=200)
def delete_equipment(
    equipment_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _eq_or_404(db, equipment_id, current_user.id)
    eq.deleted_at = datetime.utcnow()   # soft-delete
    db.commit()
    return {"message": "Equipment deleted", "id": equipment_id}


# =============================================================================
# Maintenance log
# =============================================================================

@router.get("/{equipment_id}/maintenance", response_model=List[MaintenanceRead])
def list_maintenance(
    equipment_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _eq_or_404(db, equipment_id, current_user.id)
    return (
        db.query(EquipmentMaintenance)
        .filter_by(equipment_id=equipment_id)
        .order_by(EquipmentMaintenance.maintenance_date.desc())
        .all()
    )


@router.post("/{equipment_id}/maintenance", response_model=MaintenanceRead, status_code=201)
def add_maintenance(
    equipment_id: int,
    data: MaintenanceCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _eq_or_404(db, equipment_id, current_user.id)

    m = EquipmentMaintenance(
        equipment_id=equipment_id,
        user_id=current_user.id,
        **data.model_dump(),
    )
    db.add(m)

    # Propagate next service date / hours back to the equipment record
    if data.next_service_date:
        eq.next_service_date = data.next_service_date
    if data.hours_at_service is not None and (
        eq.hours_current is None or float(data.hours_at_service) > float(eq.hours_current)
    ):
        eq.hours_current = data.hours_at_service

    db.commit()
    db.refresh(m)
    return m


@router.patch("/{equipment_id}/maintenance/{maintenance_id}", response_model=MaintenanceRead)
def update_maintenance(
    equipment_id: int,
    maintenance_id: int,
    data: MaintenanceUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _eq_or_404(db, equipment_id, current_user.id)
    m = db.get(EquipmentMaintenance, maintenance_id)
    if not m or m.equipment_id != equipment_id:
        raise HTTPException(status_code=404, detail="Maintenance record not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m


@router.delete("/{equipment_id}/maintenance/{maintenance_id}", status_code=200)
def delete_maintenance(
    equipment_id: int,
    maintenance_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _eq_or_404(db, equipment_id, current_user.id)
    m = db.get(EquipmentMaintenance, maintenance_id)
    if not m or m.equipment_id != equipment_id:
        raise HTTPException(status_code=404, detail="Maintenance record not found")
    db.delete(m)
    db.commit()
    return {"message": "Maintenance record deleted", "id": maintenance_id}

@router.get("/{equipment_id}/usage", response_model=List[UsageRead])
def list_usage(
    equipment_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _eq_or_404(db, equipment_id, current_user.id)
    logs = (
        db.query(EquipmentUsageLog)
        .filter_by(equipment_id=equipment_id)
        .order_by(EquipmentUsageLog.used_date.desc())
        .all()
    )
    result = []
    for log in logs:
        row = {c.name: getattr(log, c.name) for c in log.__table__.columns}
        if log.field_id:
            f = db.get(FieldUnit, log.field_id)
            row["field_label"] = f.label if f else None
        if log.field_work_id:
            fw = db.get(FieldWork, log.field_work_id)
            row["work_type"] = fw.work_type.value if fw else None
        result.append(row)
    return result


@router.post("/{equipment_id}/usage", response_model=UsageRead, status_code=201)
def log_usage(
    equipment_id: int,
    data: UsageCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _eq_or_404(db, equipment_id, current_user.id)

    hours_worked = data.hours_worked
    if hours_worked is None and data.hours_start is not None and data.hours_end is not None:
        hours_worked = max(0.0, float(data.hours_end) - float(data.hours_start))

    log = EquipmentUsageLog(
        equipment_id=equipment_id,
        user_id=current_user.id,
        hours_worked=hours_worked,
        **{k: v for k, v in data.model_dump().items() if k != "hours_worked"},
    )
    db.add(log)

    if data.hours_end is not None and (
        eq.hours_current is None or float(data.hours_end) > float(eq.hours_current)
    ):
        eq.hours_current = data.hours_end

    db.commit()
    db.refresh(log)
    return log


@router.patch("/{equipment_id}/usage/{usage_id}", response_model=UsageRead)
def update_usage(
    equipment_id: int,
    usage_id: int,
    data: UsageUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _eq_or_404(db, equipment_id, current_user.id)
    log = db.get(EquipmentUsageLog, usage_id)
    if not log or log.equipment_id != equipment_id:
        raise HTTPException(status_code=404, detail="Usage record not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(log, k, v)
    # Recompute hours_worked if both odometer readings present
    if log.hours_start is not None and log.hours_end is not None and data.hours_worked is None:
        log.hours_worked = max(0.0, float(log.hours_end) - float(log.hours_start))
    db.commit()
    db.refresh(log)
    return log


@router.delete("/{equipment_id}/usage/{usage_id}", status_code=200)
def delete_usage(
    equipment_id: int,
    usage_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _eq_or_404(db, equipment_id, current_user.id)
    log = db.get(EquipmentUsageLog, usage_id)
    if not log or log.equipment_id != equipment_id:
        raise HTTPException(status_code=404, detail="Usage record not found")
    db.delete(log)
    db.commit()
    return {"message": "Usage record deleted", "id": usage_id}