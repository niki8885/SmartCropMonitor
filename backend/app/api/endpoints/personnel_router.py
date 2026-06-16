from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc, extract

from app.core.database import (
    get_db,
    Personnel,
    PersonnelCertification,
    PersonnelWorkLog,
    FieldWork,
    FieldUnit,
    EquipmentUsageLog,
    UserDB,
)
from app.core.security import get_current_user
from app.core.schemas import (
    PersonnelRole, EmploymentType, PersonnelStatus,
    CertificationType, PayRateUnit,
)

router = APIRouter()


class PersonnelCreate(BaseModel):
    first_name:      str
    last_name:       str
    middle_name:     Optional[str]  = None
    role:            PersonnelRole
    employment_type: Optional[EmploymentType]  = EmploymentType.FULL_TIME
    status:          Optional[PersonnelStatus] = PersonnelStatus.ACTIVE
    phone:           Optional[str]  = None
    email:           Optional[str]  = None
    address:         Optional[str]  = None
    hire_date:       Optional[date] = None
    termination_date:Optional[date] = None
    pay_rate:        Optional[float]= None
    pay_rate_unit:   Optional[PayRateUnit] = None
    national_id:     Optional[str]  = None
    social_sec_no:   Optional[str]  = None
    driving_licence: Optional[str]  = None
    notes:           Optional[str]  = None


class PersonnelUpdate(BaseModel):
    first_name:      Optional[str]  = None
    last_name:       Optional[str]  = None
    middle_name:     Optional[str]  = None
    role:            Optional[PersonnelRole]    = None
    employment_type: Optional[EmploymentType]   = None
    status:          Optional[PersonnelStatus]  = None
    phone:           Optional[str]  = None
    email:           Optional[str]  = None
    address:         Optional[str]  = None
    hire_date:       Optional[date] = None
    termination_date:Optional[date] = None
    pay_rate:        Optional[float]= None
    pay_rate_unit:   Optional[PayRateUnit] = None
    national_id:     Optional[str]  = None
    social_sec_no:   Optional[str]  = None
    driving_licence: Optional[str]  = None
    notes:           Optional[str]  = None


class CertRead(BaseModel):
    id:          int
    cert_type:   str
    cert_number: Optional[str]
    issued_by:   Optional[str]
    issue_date:  Optional[date]
    expiry_date: Optional[date]
    is_active:   bool
    days_until_expiry: Optional[int] = None   # computed
    notes:       Optional[str]

    class Config:
        from_attributes = True


class PersonnelRead(BaseModel):
    id:              int
    user_id:         int
    first_name:      str
    last_name:       str
    middle_name:     Optional[str]
    full_name:       str                        # computed
    role:            str
    employment_type: str
    status:          str
    phone:           Optional[str]
    email:           Optional[str]
    address:         Optional[str]
    hire_date:       Optional[date]
    termination_date:Optional[date]
    pay_rate:        Optional[float]
    pay_rate_unit:   Optional[str]
    national_id:     Optional[str]
    social_sec_no:   Optional[str]
    driving_licence: Optional[str]
    notes:           Optional[str]
    created_at:      datetime
    updated_at:      datetime
    deleted_at:      Optional[datetime]

    # Computed / summarised
    certifications:         List[CertRead] = []
    expiring_certs_count:   int = 0          # certs expiring within 60 days
    expired_certs_count:    int = 0
    total_hours_this_year:  Optional[float] = None
    total_labour_cost_year: Optional[float] = None

    class Config:
        from_attributes = True


# ── Certifications ────────────────────────────────────────────────────────────

class CertCreate(BaseModel):
    cert_type:   CertificationType
    cert_number: Optional[str]  = None
    issued_by:   Optional[str]  = None
    issue_date:  Optional[date] = None
    expiry_date: Optional[date] = None
    is_active:   Optional[bool] = True
    notes:       Optional[str]  = None


class CertUpdate(BaseModel):
    cert_type:   Optional[CertificationType] = None
    cert_number: Optional[str]  = None
    issued_by:   Optional[str]  = None
    issue_date:  Optional[date] = None
    expiry_date: Optional[date] = None
    is_active:   Optional[bool] = None
    notes:       Optional[str]  = None


# ── Work log ──────────────────────────────────────────────────────────────────

class WorkLogCreate(BaseModel):
    work_date:         date
    field_work_id:     Optional[int]   = None
    equipment_usage_id:Optional[int]   = None
    field_id:          Optional[int]   = None
    hours_worked:      Optional[float] = None
    start_time:        Optional[str]   = None   # "08:00"
    end_time:          Optional[str]   = None   # "17:30"
    area_ha:           Optional[float] = None
    labour_cost:       Optional[float] = None
    task_description:  Optional[str]   = None
    notes:             Optional[str]   = None


class WorkLogUpdate(BaseModel):
    work_date:         Optional[date]  = None
    field_work_id:     Optional[int]   = None
    equipment_usage_id:Optional[int]   = None
    field_id:          Optional[int]   = None
    hours_worked:      Optional[float] = None
    start_time:        Optional[str]   = None
    end_time:          Optional[str]   = None
    area_ha:           Optional[float] = None
    labour_cost:       Optional[float] = None
    task_description:  Optional[str]   = None
    notes:             Optional[str]   = None


class WorkLogRead(BaseModel):
    id:                int
    personnel_id:      int
    user_id:           int
    field_work_id:     Optional[int]
    equipment_usage_id:Optional[int]
    field_id:          Optional[int]
    work_date:         date
    hours_worked:      Optional[float]
    start_time:        Optional[str]
    end_time:          Optional[str]
    area_ha:           Optional[float]
    labour_cost:       Optional[float]
    task_description:  Optional[str]
    notes:             Optional[str]
    created_at:        datetime

    # Denormalised labels
    person_full_name:  Optional[str] = None
    field_label:       Optional[str] = None
    work_type:         Optional[str] = None

    class Config:
        from_attributes = True


# =============================================================================
# Helpers
# =============================================================================

def _person_or_404(db: Session, personnel_id: int, user_id: int) -> Personnel:
    p = db.get(Personnel, personnel_id)
    if not p or p.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Personnel record not found")
    if p.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your personnel record")
    return p


def _build_cert_read(c: PersonnelCertification) -> dict:
    row = {col.name: getattr(c, col.name) for col in c.__table__.columns}
    row["days_until_expiry"] = None
    if c.expiry_date:
        row["days_until_expiry"] = (c.expiry_date - date.today()).days
    return row


def _build_person_read(p: Personnel, db: Session) -> dict:
    row = {col.name: getattr(p, col.name) for col in p.__table__.columns}
    row["full_name"] = f"{p.first_name} {p.last_name}"

    # Enum values as strings
    row["role"]            = p.role.value if hasattr(p.role, "value") else p.role
    row["employment_type"] = p.employment_type.value if hasattr(p.employment_type, "value") else p.employment_type
    row["status"]          = p.status.value if hasattr(p.status, "value") else p.status
    row["pay_rate_unit"]   = p.pay_rate_unit.value if p.pay_rate_unit and hasattr(p.pay_rate_unit, "value") else p.pay_rate_unit

    # Certifications
    certs = (
        db.query(PersonnelCertification)
        .filter_by(personnel_id=p.id)
        .order_by(PersonnelCertification.expiry_date)
        .all()
    )
    cert_reads = [_build_cert_read(c) for c in certs]
    row["certifications"] = cert_reads

    today = date.today()
    row["expiring_certs_count"] = sum(
        1 for c in certs
        if c.expiry_date and 0 <= (c.expiry_date - today).days <= 60 and c.is_active
    )
    row["expired_certs_count"] = sum(
        1 for c in certs
        if c.expiry_date and c.expiry_date < today and c.is_active
    )

    # Year-to-date labour summary
    current_year = datetime.utcnow().year
    agg = (
        db.query(
            sqlfunc.sum(PersonnelWorkLog.hours_worked).label("hrs"),
            sqlfunc.sum(PersonnelWorkLog.labour_cost).label("cost"),
        )
        .filter(
            PersonnelWorkLog.personnel_id == p.id,
            extract("year", PersonnelWorkLog.work_date) == current_year,
        )
        .first()
    )
    row["total_hours_this_year"]  = float(agg.hrs)  if agg and agg.hrs  else None
    row["total_labour_cost_year"] = float(agg.cost) if agg and agg.cost else None

    return row


def _build_log_read(log: PersonnelWorkLog, db: Session) -> dict:
    row = {col.name: getattr(log, col.name) for col in log.__table__.columns}
    p = db.get(Personnel, log.personnel_id)
    row["person_full_name"] = f"{p.first_name} {p.last_name}" if p else None
    if log.field_id:
        f = db.get(FieldUnit, log.field_id)
        row["field_label"] = f.label if f else None
    else:
        row["field_label"] = None
    if log.field_work_id:
        fw = db.get(FieldWork, log.field_work_id)
        row["work_type"] = fw.work_type.value if fw else None
    else:
        row["work_type"] = None
    return row


# =============================================================================
# Personnel CRUD
# NOTE: literal-prefix routes (/user, /roles, /summary, /expiring-certs,
# /{id}/certifications, /{id}/work-log) BEFORE bare /{personnel_id} wildcard.
# =============================================================================

@router.get("/user", response_model=List[PersonnelRead])
def list_personnel(
    role:    Optional[str] = None,
    status:  Optional[str] = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all staff for the current user's farm with certification and YTD labour summary."""
    user_id = current_user.id
    q = db.query(Personnel).filter(
        Personnel.user_id == user_id,
        Personnel.deleted_at.is_(None),
    )
    if role:
        q = q.filter(Personnel.role == role)
    if status:
        q = q.filter(Personnel.status == status)
    items = q.order_by(Personnel.last_name, Personnel.first_name).all()
    return [_build_person_read(p, db) for p in items]


@router.get("/roles", response_model=List[str])
def list_roles():
    """Valid PersonnelRole values for frontend dropdowns."""
    return [r.value for r in PersonnelRole]


@router.get("/summary/user")
def personnel_summary(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Headcount by role/status, overdue certs count, YTD hours and cost."""
    user_id = current_user.id
    from collections import defaultdict

    staff = db.query(Personnel).filter(
        Personnel.user_id == user_id,
        Personnel.deleted_at.is_(None),
    ).all()

    by_role   = defaultdict(int)
    by_status = defaultdict(int)
    for p in staff:
        by_role[p.role.value]     += 1
        by_status[p.status.value] += 1

    today = date.today()
    expired_certs = (
        db.query(PersonnelCertification)
        .join(Personnel, PersonnelCertification.personnel_id == Personnel.id)
        .filter(
            Personnel.user_id == user_id,
            Personnel.deleted_at.is_(None),
            PersonnelCertification.expiry_date < today,
            PersonnelCertification.is_active == True,
        )
        .count()
    )
    expiring_soon = (
        db.query(PersonnelCertification)
        .join(Personnel, PersonnelCertification.personnel_id == Personnel.id)
        .filter(
            Personnel.user_id == user_id,
            Personnel.deleted_at.is_(None),
            PersonnelCertification.expiry_date >= today,
            PersonnelCertification.expiry_date <= date.fromordinal(today.toordinal() + 60),
            PersonnelCertification.is_active == True,
        )
        .count()
    )

    current_year = datetime.utcnow().year
    agg = (
        db.query(
            sqlfunc.sum(PersonnelWorkLog.hours_worked).label("hrs"),
            sqlfunc.sum(PersonnelWorkLog.labour_cost).label("cost"),
        )
        .join(Personnel, PersonnelWorkLog.personnel_id == Personnel.id)
        .filter(
            Personnel.user_id == user_id,
            extract("year", PersonnelWorkLog.work_date) == current_year,
        )
        .first()
    )

    return {
        "total_staff":           len(staff),
        "by_role":               dict(by_role),
        "by_status":             dict(by_status),
        "expired_certs":         expired_certs,
        "expiring_certs_60d":    expiring_soon,
        "year_hours_total":      float(agg.hrs)  if agg and agg.hrs  else 0.0,
        "year_labour_cost_total":float(agg.cost) if agg and agg.cost else 0.0,
    }


@router.get("/expiring-certs/user")
def expiring_certifications(
    days: int = 60,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all certifications expiring within `days` days (default 60),
    plus already-expired ones.  Used for compliance dashboard / alerts."""
    user_id = current_user.id
    today = date.today()
    deadline = date.fromordinal(today.toordinal() + days)

    rows = (
        db.query(PersonnelCertification, Personnel)
        .join(Personnel, PersonnelCertification.personnel_id == Personnel.id)
        .filter(
            Personnel.user_id == user_id,
            Personnel.deleted_at.is_(None),
            PersonnelCertification.is_active == True,
            PersonnelCertification.expiry_date <= deadline,
        )
        .order_by(PersonnelCertification.expiry_date)
        .all()
    )

    result = []
    for cert, person in rows:
        result.append({
            "personnel_id":   person.id,
            "full_name":      f"{person.first_name} {person.last_name}",
            "role":           person.role.value,
            "cert_id":        cert.id,
            "cert_type":      cert.cert_type.value,
            "cert_number":    cert.cert_number,
            "expiry_date":    cert.expiry_date,
            "days_remaining": (cert.expiry_date - today).days if cert.expiry_date else None,
            "expired":        cert.expiry_date < today if cert.expiry_date else False,
        })
    return result


@router.get("/work-log/user", response_model=List[WorkLogRead])
def list_all_work_logs(
    year:    Optional[int] = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All work logs across all staff for the current user's farm (optionally filtered by year)."""
    user_id = current_user.id
    q = (
        db.query(PersonnelWorkLog)
        .join(Personnel, PersonnelWorkLog.personnel_id == Personnel.id)
        .filter(
            Personnel.user_id == user_id,
            Personnel.deleted_at.is_(None),
        )
    )
    if year:
        q = q.filter(extract("year", PersonnelWorkLog.work_date) == year)
    logs = q.order_by(PersonnelWorkLog.work_date.desc()).all()
    return [_build_log_read(log, db) for log in logs]


@router.post("/create", response_model=PersonnelRead, status_code=201)
def create_personnel(
    data: PersonnelCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = Personnel(user_id=current_user.id, **data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _build_person_read(p, db)


# ── WILDCARD routes (must be LAST at this path level) ─────────────────────────

@router.get("/{personnel_id}", response_model=PersonnelRead)
def get_personnel(
    personnel_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _person_or_404(db, personnel_id, current_user.id)
    return _build_person_read(p, db)


@router.patch("/{personnel_id}", response_model=PersonnelRead)
def update_personnel(
    personnel_id: int,
    data: PersonnelUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _person_or_404(db, personnel_id, current_user.id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _build_person_read(p, db)


@router.delete("/{personnel_id}", status_code=200)
def delete_personnel(
    personnel_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _person_or_404(db, personnel_id, current_user.id)
    p.deleted_at = datetime.utcnow()
    db.commit()
    return {"message": "Personnel record deleted", "id": personnel_id}


# =============================================================================
# Certifications  (sub-resource of /{personnel_id})
# =============================================================================

@router.get("/{personnel_id}/certifications", response_model=List[CertRead])
def list_certifications(
    personnel_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    certs = (
        db.query(PersonnelCertification)
        .filter_by(personnel_id=personnel_id)
        .order_by(PersonnelCertification.expiry_date)
        .all()
    )
    return [_build_cert_read(c) for c in certs]


@router.post("/{personnel_id}/certifications",
             response_model=CertRead, status_code=201)
def add_certification(
    personnel_id: int,
    data: CertCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    c = PersonnelCertification(
        personnel_id=personnel_id,
        user_id=current_user.id,
        **data.model_dump(),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _build_cert_read(c)


@router.patch("/{personnel_id}/certifications/{cert_id}",
              response_model=CertRead)
def update_certification(
    personnel_id: int,
    cert_id: int,
    data: CertUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    c = db.get(PersonnelCertification, cert_id)
    if not c or c.personnel_id != personnel_id:
        raise HTTPException(status_code=404, detail="Certification not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return _build_cert_read(c)


@router.delete("/{personnel_id}/certifications/{cert_id}", status_code=200)
def delete_certification(
    personnel_id: int,
    cert_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    c = db.get(PersonnelCertification, cert_id)
    if not c or c.personnel_id != personnel_id:
        raise HTTPException(status_code=404, detail="Certification not found")
    db.delete(c)
    db.commit()
    return {"message": "Certification deleted", "id": cert_id}


# =============================================================================
# Work log  (sub-resource of /{personnel_id})
# =============================================================================

@router.get("/{personnel_id}/work-log", response_model=List[WorkLogRead])
def list_work_log(
    personnel_id: int,
    year: Optional[int] = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    q = (
        db.query(PersonnelWorkLog)
        .filter_by(personnel_id=personnel_id)
    )
    if year:
        q = q.filter(extract("year", PersonnelWorkLog.work_date) == year)
    logs = q.order_by(PersonnelWorkLog.work_date.desc()).all()
    return [_build_log_read(log, db) for log in logs]


@router.post("/{personnel_id}/work-log",
             response_model=WorkLogRead, status_code=201)
def add_work_log(
    personnel_id: int,
    data: WorkLogCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)

    # Auto-compute hours from start/end time if hours_worked not given
    hours = data.hours_worked
    if hours is None and data.start_time and data.end_time:
        try:
            sh, sm = map(int, data.start_time.split(":"))
            eh, em = map(int, data.end_time.split(":"))
            hours = round(max(0.0, (eh * 60 + em - sh * 60 - sm) / 60), 2)
        except (ValueError, AttributeError):
            pass

    # Auto-compute labour_cost from hours × pay_rate if not explicitly given
    labour_cost = data.labour_cost
    if labour_cost is None and hours is not None:
        person = db.get(Personnel, personnel_id)
        if person and person.pay_rate and person.pay_rate_unit and \
           person.pay_rate_unit.value == "PER_HOUR":
            labour_cost = round(float(person.pay_rate) * hours, 2)

    log = PersonnelWorkLog(
        personnel_id=personnel_id,
        user_id=current_user.id,
        hours_worked=hours,
        labour_cost=labour_cost,
        **{k: v for k, v in data.model_dump().items()
           if k not in ("hours_worked", "labour_cost")},
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _build_log_read(log, db)


@router.patch("/{personnel_id}/work-log/{log_id}",
              response_model=WorkLogRead)
def update_work_log(
    personnel_id: int,
    log_id: int,
    data: WorkLogUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    log = db.get(PersonnelWorkLog, log_id)
    if not log or log.personnel_id != personnel_id:
        raise HTTPException(status_code=404, detail="Work log entry not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(log, k, v)
    # Re-derive hours if times updated but hours_worked not explicitly patched
    if data.start_time is not None or data.end_time is not None:
        if log.start_time and log.end_time and data.hours_worked is None:
            try:
                sh, sm = map(int, log.start_time.split(":"))
                eh, em = map(int, log.end_time.split(":"))
                log.hours_worked = round(
                    max(0.0, (eh * 60 + em - sh * 60 - sm) / 60), 2
                )
            except (ValueError, AttributeError):
                pass
    db.commit()
    db.refresh(log)
    return _build_log_read(log, db)


@router.delete("/{personnel_id}/work-log/{log_id}", status_code=200)
def delete_work_log(
    personnel_id: int,
    log_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _person_or_404(db, personnel_id, current_user.id)
    log = db.get(PersonnelWorkLog, log_id)
    if not log or log.personnel_id != personnel_id:
        raise HTTPException(status_code=404, detail="Work log entry not found")
    db.delete(log)
    db.commit()
    return {"message": "Work log entry deleted", "id": log_id}