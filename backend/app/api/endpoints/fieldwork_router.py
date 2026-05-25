from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, extract as _extract
from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal
from collections import defaultdict as _dd

from app.core.database import get_db, FieldWork, FieldUnit, SeasonRecord, FertilizationLog, PesticideLog
from app.core.schemas import (
    FieldWorkType, FieldWorkStatus,
    FertilizationMethod, PesticideTargetType,
    SeedTreatmentType, TillageType,
)
from pydantic import BaseModel, ConfigDict, field_validator

router = APIRouter(prefix="/fieldwork", tags=["Field Work"])


# =============================================================================
# Helpers
# =============================================================================

def _wt(r):
    return r.work_type.value if hasattr(r.work_type, "value") else str(r.work_type)

def _ws(r):
    return r.work_status.value if hasattr(r.work_status, "value") else str(r.work_status)

def _is_done(r):
    return _ws(r) in ("COMPLETED", "VERIFIED")

def _dec(v):
    return float(v) if isinstance(v, Decimal) else v


# =============================================================================
# Pydantic read schemas
# =============================================================================

class FertilizationLogRead(BaseModel):
    id: int
    field_work_id: int
    field_id: int
    application_date: date
    product_name: Optional[str] = None
    product_type: Optional[str] = None
    is_organic: bool = False
    n_kg_ha:    Optional[float] = None
    p2o5_kg_ha: Optional[float] = None
    k2o_kg_ha:  Optional[float] = None
    s_kg_ha:    Optional[float] = None
    mg_kg_ha:   Optional[float] = None
    dose_kg_ha:         Optional[float] = None
    total_dose_kg:      Optional[float] = None
    application_method: Optional[FertilizationMethod] = None
    operator_name: Optional[str] = None
    equipment:     Optional[str] = None
    notes:         Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class PesticideLogRead(BaseModel):
    id: int
    field_work_id: int
    field_id: int
    application_date: date
    product_trade_name:  str
    active_substance:    Optional[str] = None
    registration_number: Optional[str] = None
    dose_l_ha:          Optional[float] = None
    dose_kg_ha:         Optional[float] = None
    water_volume_l_ha:  Optional[float] = None
    total_product_used: Optional[float] = None
    target_crop:        Optional[str] = None
    target_type:        Optional[PesticideTargetType] = None
    target_organism:    Optional[str] = None
    wind_speed_ms:      Optional[float] = None
    temperature_c:      Optional[float] = None
    bbch_stage:         Optional[str] = None
    pre_harvest_interval_days: Optional[int] = None
    operator_name: Optional[str] = None
    operator_cert: Optional[str] = None
    equipment:     Optional[str] = None
    notes:         Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class SeasonRecordRead(BaseModel):
    id: int
    field_id: int
    user_id: int
    season_year: int
    crop: str
    variety: Optional[str] = None
    sowing_date: Optional[date] = None
    sowing_rate_kg_ha: Optional[float] = None
    seed_treatment: Optional[SeedTreatmentType] = None
    seed_treatment_note: Optional[str] = None
    tillage_type: Optional[TillageType] = None
    harvest_date:    Optional[date] = None
    harvest_area_ha: Optional[float] = None
    harvest_total_t: Optional[float] = None
    yield_t_ha:      Optional[float] = None
    moisture_pct:    Optional[float] = None
    protein_pct:     Optional[float] = None
    quality_extra:   Optional[dict] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class FieldWorkRead(BaseModel):
    id: int
    field_id: int
    user_id: int
    work_date: datetime
    work_type: FieldWorkType
    work_status: FieldWorkStatus
    season_id:      Optional[int]   = None
    operator_name:  Optional[str]   = None
    equipment:      Optional[str]   = None
    tillage_depth_cm: Optional[float] = None
    irrigation_mm:    Optional[float] = None
    work_cost:    Optional[float] = None
    harvest_ton:  Optional[float] = None
    extra_metadata: Optional[dict] = None
    created_at: datetime
    updated_at: datetime
    field_label: Optional[str] = None

    # Typed sub-records (present only when relevant)
    fertilization: Optional[FertilizationLogRead] = None
    pesticide:     Optional[PesticideLogRead]     = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_full(cls, obj: FieldWork) -> "FieldWorkRead":
        data = cls.model_validate(obj)
        data.field_label = obj.field.label if obj.field else None
        data.work_cost   = _dec(obj.work_cost)
        data.harvest_ton = _dec(obj.harvest_ton)
        if obj.fertilization_log:
            data.fertilization = FertilizationLogRead.model_validate(obj.fertilization_log)
        if obj.pesticide_log:
            data.pesticide = PesticideLogRead.model_validate(obj.pesticide_log)
        return data


# =============================================================================
# Create schemas
# =============================================================================

class FieldWorkCreate(BaseModel):
    """Generic operation – no sub-record."""
    user_id: int
    field_id: int
    work_type: FieldWorkType
    work_status: FieldWorkStatus = FieldWorkStatus.PLANNED
    work_date: datetime
    season_id:     Optional[int]   = None
    operator_name: Optional[str]   = None
    equipment:     Optional[str]   = None
    tillage_depth_cm: Optional[float] = None
    irrigation_mm:    Optional[float] = None
    work_cost:    Optional[float] = None
    harvest_ton:  Optional[float] = None
    extra_metadata: Optional[dict] = None


class SowingCreate(BaseModel):
    """
    eGN 3.3 – Sowing / planting operation.
    Creates a FieldWork (SOWING or PLANTING) + a SeasonRecord.
    """
    user_id:  int
    field_id: int
    work_date: datetime
    work_status: FieldWorkStatus = FieldWorkStatus.COMPLETED

    # Season / crop
    season_year: int
    crop: str                           # FieldCrop value
    variety: Optional[str] = None
    sowing_date: Optional[date] = None  # defaults to work_date.date()
    sowing_rate_kg_ha: Optional[float] = None
    seed_treatment: Optional[SeedTreatmentType] = None
    seed_treatment_note: Optional[str] = None
    tillage_type: Optional[TillageType] = None

    # Operation meta
    operator_name: Optional[str] = None
    equipment:     Optional[str] = None
    work_cost:     Optional[float] = None
    notes:         Optional[str] = None
    extra_metadata: Optional[dict] = None


class FertilizationCreate(BaseModel):
    """
    eGN 3.4 – Fertilization event.
    """
    user_id:  int
    field_id: int
    work_date: datetime
    work_status: FieldWorkStatus = FieldWorkStatus.COMPLETED
    season_id: Optional[int] = None

    application_date: Optional[date] = None
    product_name:  Optional[str] = None
    product_type:  Optional[str] = None
    is_organic:    bool = False

    n_kg_ha:    Optional[float] = None
    p2o5_kg_ha: Optional[float] = None
    k2o_kg_ha:  Optional[float] = None
    s_kg_ha:    Optional[float] = None
    mg_kg_ha:   Optional[float] = None

    dose_kg_ha:    Optional[float] = None
    total_dose_kg: Optional[float] = None
    application_method: Optional[FertilizationMethod] = None

    operator_name: Optional[str] = None
    equipment:     Optional[str] = None
    work_cost:     Optional[float] = None
    notes:         Optional[str] = None
    extra_metadata: Optional[dict] = None


class SprayingCreate(BaseModel):
    """
    eGN 3.5 – Pesticide / PPP application.
    """
    user_id:  int
    field_id: int
    work_date: datetime
    work_status: FieldWorkStatus = FieldWorkStatus.COMPLETED
    season_id: Optional[int] = None

    application_date: Optional[date] = None
    product_trade_name: str
    active_substance:    Optional[str] = None
    registration_number: Optional[str] = None

    dose_l_ha:          Optional[float] = None
    dose_kg_ha:         Optional[float] = None
    water_volume_l_ha:  Optional[float] = None
    total_product_used: Optional[float] = None

    target_crop:     Optional[str] = None
    target_type:     Optional[PesticideTargetType] = None
    target_organism: Optional[str] = None

    wind_speed_ms: Optional[float] = None
    temperature_c: Optional[float] = None
    bbch_stage:    Optional[str]   = None
    pre_harvest_interval_days: Optional[int] = None

    operator_name: Optional[str] = None
    operator_cert: Optional[str] = None
    equipment:     Optional[str] = None
    work_cost:     Optional[float] = None
    notes:         Optional[str]  = None
    extra_metadata: Optional[dict] = None


class HarvestUpdate(BaseModel):
    harvest_date:    Optional[date]  = None
    harvest_area_ha: Optional[float] = None
    harvest_total_t: Optional[float] = None
    yield_t_ha:      Optional[float] = None
    moisture_pct:    Optional[float] = None
    protein_pct:     Optional[float] = None
    quality_extra:   Optional[dict]  = None
    notes:           Optional[str]   = None
    work_cost:       Optional[float] = None
    operator_name:   Optional[str]   = None
    equipment:       Optional[str]   = None


class FieldWorkUpdate(BaseModel):
    work_status:   Optional[FieldWorkStatus] = None
    work_cost:     Optional[float] = None
    harvest_ton:   Optional[float] = None
    operator_name: Optional[str]   = None
    equipment:     Optional[str]   = None
    extra_metadata: Optional[dict] = None


class SeasonUpdate(BaseModel):
    crop: Optional[str] = None
    variety: Optional[str] = None
    sowing_date: Optional[date] = None
    sowing_rate_kg_ha: Optional[float] = None
    seed_treatment: Optional[SeedTreatmentType] = None
    seed_treatment_note: Optional[str] = None
    tillage_type: Optional[TillageType] = None
    harvest_date:    Optional[date]  = None
    harvest_area_ha: Optional[float] = None
    harvest_total_t: Optional[float] = None
    yield_t_ha:      Optional[float] = None
    moisture_pct:    Optional[float] = None
    protein_pct:     Optional[float] = None
    quality_extra:   Optional[dict]  = None
    notes:           Optional[str]   = None


# =============================================================================
# Endpoints – read
# =============================================================================

@router.get("/user/{user_id}", response_model=List[FieldWorkRead])
def get_user_fieldwork(
    user_id: int,
    limit: int = 100,
    offset: int = 0,
    work_type: Optional[FieldWorkType] = None,
    db: Session = Depends(get_db),
):
    """All field-work records for a user, newest first. Optional filter by work_type."""
    q = select(FieldWork).where(FieldWork.user_id == user_id)
    if work_type:
        q = q.where(FieldWork.work_type == work_type)
    records = db.execute(q.order_by(FieldWork.work_date.desc()).limit(limit).offset(offset)).scalars().all()
    return [FieldWorkRead.from_orm_full(r) for r in records]


@router.get("/field/{field_id}", response_model=List[FieldWorkRead])
def get_field_fieldwork(
    field_id: int,
    limit: int = 50,
    work_type: Optional[FieldWorkType] = None,
    db: Session = Depends(get_db),
):
    q = select(FieldWork).where(FieldWork.field_id == field_id)
    if work_type:
        q = q.where(FieldWork.work_type == work_type)
    records = db.execute(q.order_by(FieldWork.work_date.desc()).limit(limit)).scalars().all()
    return [FieldWorkRead.from_orm_full(r) for r in records]


@router.get("/{work_id}", response_model=FieldWorkRead)
def get_fieldwork(work_id: int, db: Session = Depends(get_db)):
    record = db.get(FieldWork, work_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return FieldWorkRead.from_orm_full(record)


@router.post("/create", response_model=FieldWorkRead)
def create_fieldwork(data: FieldWorkCreate, db: Session = Depends(get_db)):
    """Generic agronomic operation – no typed sub-record."""
    field = db.get(FieldUnit, data.field_id)
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    record = FieldWork(**data.model_dump())
    db.add(record)
    try:
        db.commit()
        db.refresh(record)
        return FieldWorkRead.from_orm_full(record)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Failed to create field work record")


@router.post("/sowing", response_model=FieldWorkRead, summary="eGN 3.3 – Sowing / planting")
def create_sowing(data: SowingCreate, db: Session = Depends(get_db)):
    field = db.get(FieldUnit, data.field_id)
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    sowing_date = data.sowing_date or data.work_date.date()

    season = (
        db.query(SeasonRecord)
        .filter_by(field_id=data.field_id, season_year=data.season_year, crop=data.crop)
        .first()
    )
    if not season:
        season = SeasonRecord(
            field_id=data.field_id,
            user_id=data.user_id,
            season_year=data.season_year,
            crop=data.crop,
            variety=data.variety,
            sowing_date=sowing_date,
            sowing_rate_kg_ha=data.sowing_rate_kg_ha,
            seed_treatment=data.seed_treatment,
            seed_treatment_note=data.seed_treatment_note,
            tillage_type=data.tillage_type,
            notes=data.notes,
        )
        db.add(season)
        db.flush()

    wtype = FieldWorkType.PLANTING if data.crop in (
        "TOMATO", "ONION", "CARROT", "CABBAGE",
        "APPLE", "PEAR", "CHERRY", "GRAPES_WINE", "GRAPES_TABLE",
        "STRAWBERRY", "BLUEBERRY",
    ) else FieldWorkType.SOWING

    fw = FieldWork(
        user_id=data.user_id,
        field_id=data.field_id,
        work_type=wtype,
        work_status=data.work_status,
        work_date=data.work_date,
        season_id=season.id,
        operator_name=data.operator_name,
        equipment=data.equipment,
        work_cost=data.work_cost,
        extra_metadata=data.extra_metadata,
    )
    db.add(fw)
    # Update field quick-view columns
    field.crop_type   = data.crop
    field.season_year = data.season_year

    try:
        db.commit()
        db.refresh(fw)
        return FieldWorkRead.from_orm_full(fw)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Failed to create sowing record")


@router.post("/fertilization", response_model=FieldWorkRead, summary="eGN 3.4 – Fertilization")
def create_fertilization(data: FertilizationCreate, db: Session = Depends(get_db)):
    field = db.get(FieldUnit, data.field_id)
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    app_date = data.application_date or data.work_date.date()

    fw = FieldWork(
        user_id=data.user_id,
        field_id=data.field_id,
        work_type=FieldWorkType.FERTILIZATION,
        work_status=data.work_status,
        work_date=data.work_date,
        season_id=data.season_id,
        operator_name=data.operator_name,
        equipment=data.equipment,
        work_cost=data.work_cost,
        extra_metadata=data.extra_metadata,
    )
    db.add(fw)
    db.flush()

    log = FertilizationLog(
        field_work_id=fw.id,
        field_id=data.field_id,
        user_id=data.user_id,
        season_id=data.season_id,
        application_date=app_date,
        product_name=data.product_name,
        product_type=data.product_type,
        is_organic=data.is_organic,
        n_kg_ha=data.n_kg_ha,
        p2o5_kg_ha=data.p2o5_kg_ha,
        k2o_kg_ha=data.k2o_kg_ha,
        s_kg_ha=data.s_kg_ha,
        mg_kg_ha=data.mg_kg_ha,
        dose_kg_ha=data.dose_kg_ha,
        total_dose_kg=data.total_dose_kg,
        application_method=data.application_method,
        operator_name=data.operator_name,
        equipment=data.equipment,
        notes=data.notes,
    )
    db.add(log)

    try:
        db.commit()
        db.refresh(fw)
        return FieldWorkRead.from_orm_full(fw)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Failed to create fertilization record")


@router.post("/spraying", response_model=FieldWorkRead, summary="eGN 3.5 – Pesticide / PPP")
def create_spraying(data: SprayingCreate, db: Session = Depends(get_db)):
    field = db.get(FieldUnit, data.field_id)
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    app_date = data.application_date or data.work_date.date()

    fw = FieldWork(
        user_id=data.user_id,
        field_id=data.field_id,
        work_type=FieldWorkType.SPRAYING,
        work_status=data.work_status,
        work_date=data.work_date,
        season_id=data.season_id,
        operator_name=data.operator_name,
        equipment=data.equipment,
        work_cost=data.work_cost,
        extra_metadata=data.extra_metadata,
    )
    db.add(fw)
    db.flush()

    log = PesticideLog(
        field_work_id=fw.id,
        field_id=data.field_id,
        user_id=data.user_id,
        season_id=data.season_id,
        application_date=app_date,
        product_trade_name=data.product_trade_name,
        active_substance=data.active_substance,
        registration_number=data.registration_number,
        dose_l_ha=data.dose_l_ha,
        dose_kg_ha=data.dose_kg_ha,
        water_volume_l_ha=data.water_volume_l_ha,
        total_product_used=data.total_product_used,
        target_crop=data.target_crop,
        target_type=data.target_type,
        target_organism=data.target_organism,
        wind_speed_ms=data.wind_speed_ms,
        temperature_c=data.temperature_c,
        bbch_stage=data.bbch_stage,
        pre_harvest_interval_days=data.pre_harvest_interval_days,
        operator_name=data.operator_name,
        operator_cert=data.operator_cert,
        equipment=data.equipment,
        notes=data.notes,
    )
    db.add(log)

    try:
        db.commit()
        db.refresh(fw)
        return FieldWorkRead.from_orm_full(fw)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Failed to create spraying record")


@router.post(
    "/harvest/{season_id}",
    response_model=SeasonRecordRead,
    summary="eGN 3.7 – Record harvest result",
)
def record_harvest(
    season_id: int,
    data: HarvestUpdate,
    db: Session = Depends(get_db),
):

    season = db.get(SeasonRecord, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season record not found")

    for field_name, value in data.model_dump(exclude_unset=True).items():
        if field_name not in ("work_cost", "operator_name", "equipment"):
            setattr(season, field_name, value)

    if season.harvest_total_t and season.harvest_area_ha and not data.yield_t_ha:
        season.yield_t_ha = round(float(season.harvest_total_t) / float(season.harvest_area_ha), 3)

    existing_hw = (
        db.query(FieldWork)
        .filter_by(field_id=season.field_id, season_id=season_id)
        .filter(FieldWork.work_type == FieldWorkType.HARVESTING)
        .first()
    )
    if not existing_hw:
        hw = FieldWork(
            user_id=season.user_id,
            field_id=season.field_id,
            work_type=FieldWorkType.HARVESTING,
            work_status=FieldWorkStatus.COMPLETED,
            work_date=datetime.combine(data.harvest_date or date.today(), datetime.min.time()),
            season_id=season_id,
            harvest_ton=float(season.harvest_total_t) if season.harvest_total_t else None,
            work_cost=data.work_cost,
            operator_name=data.operator_name,
            equipment=data.equipment,
        )
        db.add(hw)

    try:
        db.commit()
        db.refresh(season)
        return SeasonRecordRead.model_validate(season)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Failed to record harvest")


# =============================================================================
# Endpoints – update / delete
# =============================================================================

@router.patch("/{work_id}", response_model=FieldWorkRead)
def update_fieldwork(work_id: int, data: FieldWorkUpdate, db: Session = Depends(get_db)):
    record = db.get(FieldWork, work_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    if data.work_status   is not None: record.work_status   = data.work_status
    if data.work_cost     is not None: record.work_cost     = data.work_cost
    if data.harvest_ton   is not None: record.harvest_ton   = data.harvest_ton
    if data.operator_name is not None: record.operator_name = data.operator_name
    if data.equipment     is not None: record.equipment     = data.equipment
    if data.extra_metadata is not None:
        record.extra_metadata = {**(record.extra_metadata or {}), **data.extra_metadata}

    db.commit()
    db.refresh(record)
    return FieldWorkRead.from_orm_full(record)


@router.delete("/{work_id}")
def delete_fieldwork(work_id: int, user_id: int, db: Session = Depends(get_db)):
    record = db.get(FieldWork, work_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if record.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your record")
    db.delete(record)
    db.commit()
    return {"message": "Record deleted", "id": work_id}


# =============================================================================
# Endpoints – SeasonRecord CRUD
# =============================================================================

@router.get("/seasons/field/{field_id}", response_model=List[SeasonRecordRead])
def get_field_seasons(field_id: int, db: Session = Depends(get_db)):
    """Full crop-rotation history for a field, newest season first."""
    seasons = (
        db.query(SeasonRecord)
        .filter_by(field_id=field_id)
        .order_by(SeasonRecord.season_year.desc(), SeasonRecord.sowing_date.desc())
        .all()
    )
    return [SeasonRecordRead.model_validate(s) for s in seasons]


@router.get("/seasons/{season_id}", response_model=SeasonRecordRead)
def get_season(season_id: int, db: Session = Depends(get_db)):
    season = db.get(SeasonRecord, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    return SeasonRecordRead.model_validate(season)


@router.patch("/seasons/{season_id}", response_model=SeasonRecordRead)
def update_season(season_id: int, data: SeasonUpdate, db: Session = Depends(get_db)):
    season = db.get(SeasonRecord, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(season, k, v)
    # Auto-compute yield
    if season.harvest_total_t and season.harvest_area_ha:
        season.yield_t_ha = round(float(season.harvest_total_t) / float(season.harvest_area_ha), 3)
    db.commit()
    db.refresh(season)
    return SeasonRecordRead.model_validate(season)


# =============================================================================
# Analytics – by work type (unchanged logic)
# =============================================================================

@router.get("/analytics/work-types/user/{user_id}")
def get_work_type_analytics(
    user_id: int,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Deep statistics broken down by work type."""
    q = db.query(FieldWork).filter(FieldWork.user_id == user_id)
    if year:
        q = q.filter(_extract("year", FieldWork.work_date) == year)
    records = q.order_by(FieldWork.work_date).all()

    if not records:
        return {"year_filter": year, "types": [], "summary": {}}

    buckets = _dd(lambda: {
        "count": 0, "completed": 0, "cancelled": 0, "failed": 0,
        "costs": [], "harvests": [], "fields": set(),
        "months": _dd(lambda: {"count": 0, "total_cost": 0.0}),
        "statuses": _dd(int),
    })

    for r in records:
        wt  = _wt(r)
        ws  = _ws(r)
        b   = buckets[wt]
        b["count"]        += 1
        b["statuses"][ws] += 1
        b["fields"].add(r.field_id)
        month = r.work_date.strftime("%Y-%m")
        b["months"][month]["count"]      += 1
        b["months"][month]["total_cost"] += float(r.work_cost or 0)
        if r.work_cost:    b["costs"].append(float(r.work_cost))
        if r.harvest_ton:  b["harvests"].append(float(r.harvest_ton))
        if _is_done(r):    b["completed"] += 1
        if ws == "CANCELLED": b["cancelled"] += 1
        if ws == "FAILED":    b["failed"]    += 1

    types_out = []
    for wt, b in sorted(buckets.items(), key=lambda x: -x[1]["count"]):
        costs    = b["costs"]
        harvests = b["harvests"]
        count    = b["count"]
        types_out.append({
            "work_type":         wt,
            "count":             count,
            "completed":         b["completed"],
            "completion_rate":   round(b["completed"] / count, 3) if count else 0,
            "cancelled":         b["cancelled"],
            "failed":            b["failed"],
            "total_cost":        round(sum(costs), 2),
            "avg_cost":          round(sum(costs) / len(costs), 2) if costs else 0,
            "min_cost":          round(min(costs), 2) if costs else 0,
            "max_cost":          round(max(costs), 2) if costs else 0,
            "total_harvest_ton": round(sum(harvests), 3),
            "avg_harvest_ton":   round(sum(harvests) / len(harvests), 3) if harvests else 0,
            "fields_involved":   len(b["fields"]),
            "by_month": [
                {"month": m, "count": v["count"], "total_cost": round(v["total_cost"], 2)}
                for m, v in sorted(b["months"].items())
            ],
            "by_status": [
                {"status": s, "count": c}
                for s, c in sorted(b["statuses"].items(), key=lambda x: -x[1])
            ],
        })

    def _pick(lst, key, best=True):
        filtered = [t for t in lst if t[key] > 0]
        if not filtered: return None
        return (max if best else min)(filtered, key=lambda x: x[key])["work_type"]

    summary = {
        "most_frequent":         types_out[0]["work_type"] if types_out else None,
        "most_expensive_avg":    _pick(types_out, "avg_cost"),
        "best_completion_rate":  _pick(types_out, "completion_rate"),
        "worst_completion_rate": _pick([t for t in types_out if t["count"] >= 2], "completion_rate", best=False),
        "total_cost":            round(sum(t["total_cost"] for t in types_out), 2),
        "total_harvest_ton":     round(sum(t["total_harvest_ton"] for t in types_out), 3),
    }

    return {"year_filter": year, "types": types_out, "summary": summary}


# =============================================================================
# Analytics – by location / farm (unchanged logic)
# =============================================================================

@router.get("/analytics/locations/user/{user_id}")
def get_location_analytics(
    user_id: int,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Farm-level and per-location breakdown of field work."""
    from app.core.database import UserLocation, UserDB

    user         = db.query(UserDB).filter(UserDB.id == user_id).first()
    farm_name    = getattr(user, "farm_name",    None) if user else None
    farm_size_ha = float(getattr(user, "farm_size_ha", 0) or 0) if user else 0

    locations = db.query(UserLocation).filter(UserLocation.user_id == user_id).all()
    loc_map   = {loc.id: loc for loc in locations}

    all_fields = db.query(FieldUnit).filter(FieldUnit.location_id.in_(list(loc_map.keys()))).all()
    fields_by_loc = _dd(list)
    area_by_loc   = _dd(float)
    for f in all_fields:
        fields_by_loc[f.location_id].append(f.id)
        area_by_loc[f.location_id] += float(f.area_ha or 0)

    field_ids_all = [f.id for f in all_fields]
    if not field_ids_all:
        return {"farm": {}, "locations": []}

    q = db.query(FieldWork).filter(
        FieldWork.user_id == user_id,
        FieldWork.field_id.in_(field_ids_all),
    )
    if year:
        q = q.filter(_extract("year", FieldWork.work_date) == year)
    records = q.order_by(FieldWork.work_date).all()

    fid_to_loc = {f.id: f.location_id for f in all_fields}

    loc_buckets = _dd(lambda: {
        "ops": 0, "completed": 0, "cost": 0.0, "harvest": 0.0,
        "types": _dd(lambda: {"count": 0, "cost": 0.0}),
        "months": _dd(lambda: {"count": 0, "cost": 0.0}),
    })

    for r in records:
        lid  = fid_to_loc.get(r.field_id)
        if lid is None: continue
        b    = loc_buckets[lid]
        wt   = _wt(r)
        mon  = r.work_date.strftime("%Y-%m")
        cost = float(r.work_cost or 0)
        harv = float(r.harvest_ton or 0)
        b["ops"] += 1
        b["cost"] += cost
        b["harvest"] += harv
        if _is_done(r): b["completed"] += 1
        b["types"][wt]["count"] += 1
        b["types"][wt]["cost"]  += cost
        b["months"][mon]["count"] += 1
        b["months"][mon]["cost"]  += cost

    locations_out = []
    for loc in locations:
        lid  = loc.id
        b    = loc_buckets[lid]
        area = area_by_loc[lid]
        ops  = b["ops"]
        cost = b["cost"]
        harv = b["harvest"]
        by_type_sorted = sorted(b["types"].items(), key=lambda x: -x[1]["count"])
        most_common    = by_type_sorted[0][0] if by_type_sorted else None

        locations_out.append({
            "location_id":       lid,
            "location_label":    loc.label or f"Location {lid}",
            "total_ops":         ops,
            "completed":         b["completed"],
            "completion_rate":   round(b["completed"] / ops, 3) if ops else 0,
            "total_cost":        round(cost, 2),
            "avg_cost_per_op":   round(cost / ops, 2) if ops else 0,
            "total_harvest_ton": round(harv, 3),
            "fields_count":      len(fields_by_loc[lid]),
            "total_area_ha":     round(area, 2),
            "cost_per_ha":       round(cost / area, 2) if area else None,
            "harvest_per_ha":    round(harv / area, 3) if area else None,
            "most_common_type":  most_common,
            "by_type": [
                {"work_type": wt, "count": v["count"], "total_cost": round(v["cost"], 2)}
                for wt, v in by_type_sorted
            ],
            "by_month": [
                {"month": m, "count": v["count"], "total_cost": round(v["cost"], 2)}
                for m, v in sorted(b["months"].items())
            ],
        })

    locations_out.sort(key=lambda x: -x["total_ops"])

    total_ops   = sum(x["total_ops"]         for x in locations_out)
    total_cost  = sum(x["total_cost"]        for x in locations_out)
    total_harv  = sum(x["total_harvest_ton"] for x in locations_out)
    total_compl = sum(x["completed"]         for x in locations_out)
    total_area  = sum(area_by_loc[loc.id]    for loc in locations)

    farm = {
        "farm_name":         farm_name,
        "farm_size_ha":      round(farm_size_ha, 2) if farm_size_ha else None,
        "total_ops":         total_ops,
        "total_cost":        round(total_cost, 2),
        "cost_per_ha":       round(total_cost / total_area, 2) if total_area else None,
        "total_harvest_ton": round(total_harv, 3),
        "harvest_per_ha":    round(total_harv / total_area, 3) if total_area else None,
        "completion_rate":   round(total_compl / total_ops, 3) if total_ops else 0,
        "locations_count":   len(locations),
        "total_area_ha":     round(total_area, 2),
    }

    return {"farm": farm, "locations": locations_out}