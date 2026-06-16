import os

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from decimal import Decimal
from typing import List, Optional
from app.core.database import UserLocation, FieldAnalysis, get_db, FieldUnit, Biomass, UserDB
from app.core.security import get_current_user
from app.core.schemas import FieldType
from app.services.segmentation import (
    perform_temp_segmentation_and_save,
    run_segmentation_preview,
    confirm_segmentation_fields,
)
from app.services.orchestrator import full_sync_process
from app.services.spatial_harmonizer import process_and_align_nc
from app.utils.fields import (
    validate_field_shape,
    calculate_field_area,
    detect_intersections_single
)
from app.core.database import GrazingRotation, GrazingRotationEntry
from app.core.schemas  import RotationStatus
from geoalchemy2.elements import WKTElement
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import shape, MultiPolygon
from shapely.validation import explain_validity
import datetime as _dt

router = APIRouter()


def _owned_location_or_404(db: Session, location_id: int, user_id: int) -> UserLocation:
    """Fetch a location only if it belongs to the authenticated user."""
    loc = (
        db.query(UserLocation)
        .filter(UserLocation.id == location_id, UserLocation.user_id == user_id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found or access denied")
    return loc


def _owned_field_or_404(db: Session, field_id: int, user_id: int) -> FieldUnit:
    """Fetch a field only if it belongs to the authenticated user."""
    field = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(FieldUnit.id == field_id, UserLocation.user_id == user_id)
        .first()
    )
    if not field:
        raise HTTPException(status_code=404, detail="Field not found or access denied")
    return field


class LocationCreate(BaseModel):
    label: str
    lat: float
    lon: float


class SegmentationConfirmPayload(BaseModel):
    selected_ids: List[int]
    fields_data: List[dict]

@router.post("/locations")
async def add_location(
    loc: LocationCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id
    point = f"POINT({loc.lon} {loc.lat})"

    new_loc = UserLocation(
        user_id=user_id,
        label=loc.label,
        location=WKTElement(point, srid=4326)
    )

    db.add(new_loc)
    db.commit()
    db.refresh(new_loc)

    return {
        "status": "location added",
        "id": new_loc.id
    }

@router.post("/segment-preview/{location_id}", tags=["Segmentation"])
async def segment_preview(
    location_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_location_or_404(db, location_id, current_user.id)
    try:
        result = run_segmentation_preview(location_id, db)
        return {
            "status": "ok",
            "location_id": location_id,
            "num_detected": result["num_detected"],
            "fields": result["fields"],
            "preview_b64": result["preview_b64"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation error: {str(e)}")


@router.post("/segment-confirm/{location_id}", tags=["Segmentation"])
async def segment_confirm(
    location_id: int,
    payload: SegmentationConfirmPayload,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _owned_location_or_404(db, location_id, current_user.id)
    try:
        result = confirm_segmentation_fields(
            location_id=location_id,
            selected_field_ids=payload.selected_ids,
            fields_data=payload.fields_data,
            db=db,
        )
        return {
            "status": "ok",
            "location_id": location_id,
            "saved_count": result["saved_count"],
            "field_ids": result["field_ids"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Confirm error: {str(e)}")


@router.post("/segment-fields/{location_id}", tags=["Segmentation"])
async def segment_fields(
    location_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_location_or_404(db, location_id, current_user.id)
    try:
        perform_temp_segmentation_and_save(location_id, db)
        return {"status": "success", "message": f"Segmentation completed for location {location_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation error: {str(e)}")


# =========================
# History Endpoint
# =========================
@router.get("/user/files", tags=["History"])
async def get_user_files(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    history = (
        db.query(FieldAnalysis)
        .join(UserLocation)
        .filter(UserLocation.user_id == user_id)
        .all()
    )

    return [
        {
            "id": h.id,
            "location_label": h.location.label,
            "date": h.last_data_request_date,
            "filename": h.nc_filename,
            "fields_found": h.fields_count,
            "download_url": f"/api/v1/download/{h.nc_filename}"
        }
        for h in history
    ]


@router.post("/locations/{location_id}/generate-grid", tags=["Data"])
async def generate_location_grid(
        location_id: int,
        use_sr: bool = False,
        current_user: UserDB = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    _owned_location_or_404(db, location_id, current_user.id)
    try:
        grid_path = process_and_align_nc(db, location_id, use_sr=use_sr)

        if not grid_path:
            raise HTTPException(
                status_code=404,
                detail="No files available for grid generation"
            )

        return {
            "status": "success",
            "message": "Grid timeseries generated successfully",
            "location_id": location_id,
            "grid_path": grid_path
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"[ERROR] Grid generation failed: {e}")
        raise HTTPException(status_code=500, detail="Internal processing error")


class ManualFieldCreate(BaseModel):
    location_id: int

    label: str = Field(..., min_length=1, max_length=128)

    field_type: FieldType

    geometry: dict

    crop_type: str | None = None

    season_year: int | None = None


@router.post("/manual-add-field", tags=["Fields"])
async def manual_add_field(
    payload: ManualFieldCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    location = (
        db.query(UserLocation)
        .filter(UserLocation.id == payload.location_id,
                UserLocation.user_id == current_user.id)
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=404,
            detail="Location not found or access denied"
        )

    try:
        shapely_geometry = shape(payload.geometry)

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid GeoJSON: {str(e)}"
        )

    if not isinstance(shapely_geometry, MultiPolygon):
        raise HTTPException(
            status_code=400,
            detail="Geometry must be MULTIPOLYGON"
        )

    validation_result = validate_field_shape(shapely_geometry)

    if not validation_result["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation_result["error"]
        )

    existing_fields = (
        db.query(FieldUnit)
        .filter(FieldUnit.location_id == payload.location_id)
        .all()
    )

    existing_geoms = [
        to_shape(f.geometry) for f in existing_fields
    ]

    conflicts = detect_intersections_single(
        shapely_geometry,
        existing_geoms
    )

    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Field intersects with existing fields",
                "conflicts": conflicts
            }
        )

    area_ha = calculate_field_area(shapely_geometry)

    geometry_db = from_shape(
        shapely_geometry,
        srid=4326
    )

    field = FieldUnit(
        location_id=payload.location_id,

        label=payload.label,

        geometry=geometry_db,

        area_ha=Decimal(str(round(area_ha, 2))),

        field_type=payload.field_type,

        manual_added=True,

        source="manual",

        crop_type=payload.crop_type,

        season_year=payload.season_year,

        status="active"
    )

    db.add(field)

    db.commit()

    db.refresh(field)

    return {
        "message": "Field created successfully",

        "field": {
            "id": field.id,
            "label": field.label,
            "field_type": field.field_type,
            "area_ha": float(field.area_ha),
            "manual_added": field.manual_added,
            "status": field.status
        }
    }


# =========================
# Biomass Endpoints
# =========================

@router.get("/locations/{location_id}/biomass", tags=["Biomass"])
async def get_biomass_for_location(
    location_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    location = _owned_location_or_404(db, location_id, current_user.id)

    fields = (
        db.query(FieldUnit)
        .filter(
            FieldUnit.location_id == location_id,
            FieldUnit.status == "active",
        )
        .all()
    )

    if not fields:
        raise HTTPException(status_code=404, detail="No active fields for this location")

    field_ids = [f.id for f in fields]
    field_map  = {f.id: f for f in fields}

    latest_subq = (
        db.query(
            Biomass.field_id,
            func.max(Biomass.analysis_date).label("max_date")
        )
        .filter(Biomass.field_id.in_(field_ids))
        .group_by(Biomass.field_id)
        .subquery()
    )

    records = (
        db.query(Biomass)
        .join(
            latest_subq,
            (Biomass.field_id    == latest_subq.c.field_id) &
            (Biomass.analysis_date == latest_subq.c.max_date)
        )
        .all()
    )

    return {
        "location_id": location_id,
        "location_label": location.label,
        "fields": [
            {
                "field_id":    r.field_id,
                "field_label": field_map[r.field_id].label,
                "field_type":  field_map[r.field_id].field_type,
                "area_ha":     float(field_map[r.field_id].area_ha or 0),
                "analysis_date": r.analysis_date,
                "biomass_tha": float(r.biomass_tha),
                "confidence":  float(r.confidence),
                "evi":  float(r.evi),
                "msi":  float(r.msi),
                "ci":   float(r.ci),
                "ground_truth": float(r.ground_truth) if r.ground_truth is not None else None,
                "extra": r.extra,
            }
            for r in records
        ]
    }


@router.get("/fields/{field_id}/biomass", tags=["Biomass"])
async def get_biomass_history_for_field(
    field_id: int,
    limit: int = 20,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    field = _owned_field_or_404(db, field_id, current_user.id)

    records = (
        db.query(Biomass)
        .filter(Biomass.field_id == field_id)
        .order_by(Biomass.analysis_date.desc())
        .limit(limit)
        .all()
    )

    return {
        "field_id":    field.id,
        "field_label": field.label,
        "field_type":  field.field_type,
        "area_ha":     float(field.area_ha or 0),
        "history": [
            {
                "id":            r.id,
                "analysis_date": r.analysis_date,
                "biomass_tha":   float(r.biomass_tha),
                "confidence":    float(r.confidence),
                "evi":  float(r.evi),
                "msi":  float(r.msi),
                "ci":   float(r.ci),
                "ground_truth": float(r.ground_truth) if r.ground_truth is not None else None,
                "extra": r.extra,
            }
            for r in records
        ]
    }


_KG_DM_PER_AUM_DAY   = 12.0
_BIOMASS_TO_DM_RATIO = 0.25
_UTILISATION_RATE    = 0.50
_DAYS_PER_MONTH      = 30

def _growth_stage(evi: float, biomass_tha: float) -> dict:
    if evi < 0.15 or biomass_tha < 0.3:
        return {"stage": "Dormant / Bare",  "code": "dormant",  "color": "#bdbdbd", "icon": "💤"}
    if evi < 0.30 or biomass_tha < 1.0:
        return {"stage": "Early Growth",    "code": "early",    "color": "#aed581", "icon": "🌱"}
    if evi < 0.50 or biomass_tha < 2.5:
        return {"stage": "Active Growth",   "code": "active",   "color": "#66bb6a", "icon": "🌿"}
    if evi < 0.65 or biomass_tha < 4.0:
        return {"stage": "Peak / Mature",   "code": "peak",     "color": "#2e7d32", "icon": "🌾"}
    return         {"stage": "Overmature",  "code": "over",     "color": "#827717", "icon": "🍂"}


def _rotation_recommendation(stage_code: str, area_ha: float, aum_capacity: float) -> dict:
    recs = {
        "dormant": {
            "action":  "Rest field — avoid grazing",
            "rest_days": 60,
            "graze_days": 0,
            "note": "Biomass too low. Allow recovery before introducing livestock.",
        },
        "early": {
            "action":  "Light grazing only (< 30 % utilisation)",
            "rest_days": 45,
            "graze_days": 3,
            "note": "Short grazing pass (≤ 3 days) then rest for full tiller development.",
        },
        "active": {
            "action":  "Begin rotation block",
            "rest_days": 28,
            "graze_days": 5,
            "note": "Optimum window. Graze for 4–6 days then rotate to next paddock.",
        },
        "peak": {
            "action":  "Graze now — prime condition",
            "rest_days": 21,
            "graze_days": 7,
            "note": "Peak DM availability. Maximise AUM stocking for 5–8 days.",
        },
        "over": {
            "action":  "Mow / top before grazing",
            "rest_days": 14,
            "graze_days": 4,
            "note": "Overmature biomass reduces palatability. Consider topping first.",
        },
    }
    r = recs.get(stage_code, recs["dormant"])
    r["aum_capacity"] = round(aum_capacity, 2)
    r["area_ha"]      = round(area_ha, 2)
    return r


@router.get("/locations/{location_id}/pasture", tags=["Pasture"])
def get_pasture_overview(
    location_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    location = _owned_location_or_404(db, location_id, current_user.id)

    pasture_fields = (
        db.query(FieldUnit)
        .filter(
            FieldUnit.location_id == location_id,
            FieldUnit.field_type  == "pasture",
            FieldUnit.status      == "active",
            FieldUnit.deleted_at.is_(None),
        )
        .all()
    )

    if not pasture_fields:
        return {"location_id": location_id, "location_label": location.label, "fields": []}

    field_ids = [f.id for f in pasture_fields]
    field_map  = {f.id: f for f in pasture_fields}

    latest_subq = (
        db.query(
            Biomass.field_id,
            func.max(Biomass.analysis_date).label("max_date"),
        )
        .filter(Biomass.field_id.in_(field_ids))
        .group_by(Biomass.field_id)
        .subquery()
    )

    biomass_records = (
        db.query(Biomass)
        .join(
            latest_subq,
            (Biomass.field_id     == latest_subq.c.field_id) &
            (Biomass.analysis_date == latest_subq.c.max_date),
        )
        .all()
    )
    biomass_map = {r.field_id: r for r in biomass_records}

    result_fields = []
    total_aum = 0.0

    for field in pasture_fields:
        area = float(field.area_ha or 0)
        b    = biomass_map.get(field.id)

        if b:
            evi_val      = float(b.evi)
            biomass_val  = float(b.biomass_tha)
            msi_val      = float(b.msi)
            ci_val       = float(b.ci)
            confidence   = float(b.confidence)
            analysis_date = b.analysis_date

            dm_total_kg   = biomass_val * 1000 * area * _BIOMASS_TO_DM_RATIO * _UTILISATION_RATE
            aum_capacity  = dm_total_kg / (_KG_DM_PER_AUM_DAY * _DAYS_PER_MONTH)
        else:
            evi_val = msi_val = ci_val = biomass_val = confidence = 0.0
            dm_total_kg  = 0.0
            aum_capacity = 0.0
            analysis_date = None

        stage  = _growth_stage(evi_val, biomass_val)
        recco  = _rotation_recommendation(stage["code"], area, aum_capacity)
        total_aum += aum_capacity

        result_fields.append({
            "field_id":      field.id,
            "label":         field.label,
            "area_ha":       area,
            "analysis_date": analysis_date,
            "biomass_tha":   round(biomass_val, 4),
            "evi":           round(evi_val, 4),
            "msi":           round(msi_val, 4),
            "ci":            round(ci_val, 4),
            "confidence":    round(confidence, 4),
            "dm_available_kg": round(dm_total_kg, 1),
            "aum_capacity":    round(aum_capacity, 2),
            "growth_stage":       stage,
            "recommendation":     recco,
            "has_biomass_data":   b is not None,
        })

    return {
        "location_id":    location_id,
        "location_label": location.label,
        "total_pasture_ha":  round(sum(f["area_ha"] for f in result_fields), 2),
        "total_aum_capacity": round(total_aum, 2),
        "field_count":    len(result_fields),
        "fields":         result_fields,
    }


@router.get("/fields/{field_id}/pasture-history", tags=["Pasture"])
def get_pasture_field_history(
    field_id: int,
    limit: int = 30,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns biomass history for a single pasture field enriched with
    growth stage and grazing capacity per reading.
    """
    field = _owned_field_or_404(db, field_id, current_user.id)
    if str(field.field_type).replace("FieldType.", "") != "pasture":
        raise HTTPException(status_code=400, detail="Field is not of type 'pasture'")

    area = float(field.area_ha or 0)

    records = (
        db.query(Biomass)
        .filter(Biomass.field_id == field_id)
        .order_by(Biomass.analysis_date.desc())
        .limit(limit)
        .all()
    )

    history = []
    for r in records:
        evi_val     = float(r.evi)
        biomass_val = float(r.biomass_tha)
        dm_kg       = biomass_val * 1000 * area * _BIOMASS_TO_DM_RATIO * _UTILISATION_RATE
        aum         = dm_kg / (_KG_DM_PER_AUM_DAY * _DAYS_PER_MONTH)
        stage       = _growth_stage(evi_val, biomass_val)

        history.append({
            "id":            r.id,
            "analysis_date": r.analysis_date,
            "biomass_tha":   float(r.biomass_tha),
            "evi":           float(r.evi),
            "msi":           float(r.msi),
            "ci":            float(r.ci),
            "confidence":    float(r.confidence),
            "dm_available_kg": round(dm_kg, 1),
            "aum_capacity":    round(aum, 2),
            "growth_stage":    stage,
        })

    return {
        "field_id":    field.id,
        "label":       field.label,
        "area_ha":     area,
        "history":     history,
    }


@router.get("/user_fields", tags=["Fields"])
def get_user_fields_list(
    location_id: Optional[int] = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """GET /api/v1/fields/user_fields?location_id=2
    Returns full field info list (not GeoJSON) for the management panel."""
    user_id = current_user.id
    query = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(UserLocation.user_id == user_id, FieldUnit.deleted_at.is_(None))
    )
    if location_id:
        query = query.filter(FieldUnit.location_id == location_id)

    fields = query.order_by(FieldUnit.created_at.desc()).all()

    return [
        {
            "id":           f.id,
            "location_id":  f.location_id,
            "label":        f.label,
            "field_type":   f.field_type.value if hasattr(f.field_type, "value") else f.field_type,
            "crop_type":    f.crop_type,
            "season_year":  f.season_year,
            "area_ha":      float(f.area_ha) if f.area_ha is not None else None,
            "status":       f.status,
            "source":       f.source,
            "manual_added": f.manual_added,
            "created_at":   f.created_at.isoformat() if f.created_at else None,
            "updated_at":   f.updated_at.isoformat() if f.updated_at else None,
        }
        for f in fields
    ]


class FieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[FieldType] = None
    crop_type: Optional[str] = None
    season_year: Optional[int] = None
    status: Optional[str] = None


@router.patch("/{field_id}", tags=["Fields"])
def update_field(
    field_id: int,
    payload: FieldUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """PATCH /api/v1/fields/{field_id}"""
    user_id = current_user.id
    field = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(FieldUnit.id == field_id, UserLocation.user_id == user_id)
        .first()
    )
    if not field:
        raise HTTPException(status_code=404, detail="Field not found or access denied")

    if payload.label       is not None: field.label       = payload.label.strip()
    if payload.field_type  is not None: field.field_type  = payload.field_type
    if payload.crop_type   is not None: field.crop_type   = payload.crop_type or None
    if payload.season_year is not None: field.season_year = payload.season_year
    if payload.status      is not None:
        if payload.status not in ("active", "inactive", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status value")
        field.status = payload.status

    import datetime
    field.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(field)

    return {
        "message":     "Field updated successfully",
        "id":          field.id,
        "label":       field.label,
        "field_type":  field.field_type.value if hasattr(field.field_type, "value") else field.field_type,
        "crop_type":   field.crop_type,
        "season_year": field.season_year,
        "status":      field.status,
    }