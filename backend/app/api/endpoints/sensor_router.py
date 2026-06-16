from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc
from datetime import datetime, timedelta
from pydantic import BaseModel
from app.core.database import get_db, SensorsDB, WeatherSensors, UserDB
from app.core.security import get_current_user
from app.services.sensor_servise import process_and_add_sensor_data
from app.core.schemas import SensorCreate, SensorDataBatch, SensorUpdate
from geoalchemy2.elements import WKTElement
import secrets

router = APIRouter()


def _owned_sensor_or_404(db: Session, sensor_id: int, user_id: int) -> SensorsDB:
    """Fetch a sensor only if it belongs to the authenticated user."""
    sensor = db.get(SensorsDB, sensor_id)
    if not sensor or sensor.user_id != user_id:
        raise HTTPException(status_code=404, detail="Sensor not found")
    return sensor


@router.post("/add_sensor", tags=["sensor_management"])
async def add_sensor(
    payload: SensorCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    unique_key = secrets.token_urlsafe(24)

    point = f'POINT({payload.longitude} {payload.latitude})'

    new_sensor = SensorsDB(
        hashed_key=unique_key,
        label=payload.label,
        location=WKTElement(point, srid=4326),
        user_id=current_user.id,
        meteorological=payload.meteorological,
        activation_status=True
    )

    db.add(new_sensor)
    try:
        db.commit()
        db.refresh(new_sensor)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="Error creating sensor")

    return {
        "status": "sensor added",
        "sensor_id": new_sensor.id,
        "sensor_api_key": unique_key  # Return plain key once
    }


@router.post("/sensor_data", tags=["sensor_data"])
async def add_sensor_data(payload: SensorDataBatch, db: Session = Depends(get_db)):
    try:
        count = process_and_add_sensor_data(db, payload.model_dump())
        return {"status": "success", "processed_items": count}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error during processing")


@router.get("/user_sensors", tags=["sensor_management"])
async def get_user_sensors(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    query = select(SensorsDB).where(SensorsDB.user_id == user_id)
    result = db.execute(query).scalars().all()

    return [
        {
            "id": s.id,
            "label": s.label,
            "activation_status": s.activation_status,
            "meteorological": s.meteorological,
            "added_at": s.added_at
        }
        for s in result
    ]


@router.get("/sensor_status/{sensor_id}", tags=["sensor_management"])
async def get_sensor_status(
    sensor_id: int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sensor = _owned_sensor_or_404(db, sensor_id, current_user.id)

    last_data_query = (
        select(func.max(WeatherSensors.timestamp))
        .where(WeatherSensors.sensor_id == sensor_id)
    )
    last_contact = db.execute(last_data_query).scalar()

    return {
        "sensor_id": sensor.id,
        "label": sensor.label,
        "activation_status": sensor.activation_status,
        "last_contact": last_contact,
        "is_active": sensor.activation_status
    }


@router.get("/user_sensors_latest", tags=["sensor_data"])
async def get_all_sensors_latest_data(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    sensors = db.execute(
        select(SensorsDB).where(SensorsDB.user_id == user_id)
    ).scalars().all()

    results = []
    for sensor in sensors:
        latest_data = db.execute(
            select(WeatherSensors)
            .where(WeatherSensors.sensor_id == sensor.id)
            .order_by(desc(WeatherSensors.timestamp))
            .limit(1)
        ).scalar_one_or_none()

        results.append({
            "sensor_id": sensor.id,
            "label": sensor.label,
            "last_seen": latest_data.timestamp if latest_data else None,
            "current_values": {
                "temp": latest_data.temp if latest_data else None,
                "humidity": latest_data.humidity if latest_data else None,
                "pressure": latest_data.pressure if latest_data else None,
                "status": latest_data.sensor_status if latest_data else None
            }
        })

    return results


@router.get("/sensor_history/{sensor_id}", tags=["sensor_data"])
async def get_sensor_history(
    sensor_id: int,
    days: int = Query(default=7, ge=1, le=30),
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _owned_sensor_or_404(db, sensor_id, current_user.id)

    start_date = datetime.utcnow() - timedelta(days=days)

    history = db.execute(
        select(WeatherSensors)
        .where(WeatherSensors.sensor_id == sensor_id)
        .where(WeatherSensors.timestamp >= start_date)
        .order_by(WeatherSensors.timestamp.asc())
    ).scalars().all()

    return {
        "sensor_id": sensor_id,
        "labels": [h.timestamp for h in history],
        "datasets": {
            "temp": [h.temp for h in history],
            "humidity": [h.humidity for h in history],
            "pressure": [h.pressure for h in history]
        }
    }


@router.patch("/update_sensor/{sensor_id}", tags=["sensor_management"])
async def update_sensor(
        sensor_id: int,
        payload: SensorUpdate,
        current_user: UserDB = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    sensor = _owned_sensor_or_404(db, sensor_id, current_user.id)

    update_data = payload.dict(exclude_unset=True)

    if "longitude" in update_data or "latitude" in update_data:
        lon = update_data.pop("longitude", None)
        lat = update_data.pop("latitude", None)

        if lon is not None and lat is not None:
            point = f'POINT({lon} {lat})'
            sensor.location = WKTElement(point, srid=4326)

    for key, value in update_data.items():
        setattr(sensor, key, value)

    try:
        db.commit()
        db.refresh(sensor)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="Error updating sensor")

    return {
        "status": "updated",
        "sensor_id": sensor.id,
        "updated_fields": list(update_data.keys()) + (
            ["location"] if "longitude" in payload.dict(exclude_unset=True) else [])
    }