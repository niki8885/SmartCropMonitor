from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from datetime import datetime, timezone

from app.core.database import UserLocation, FieldAnalysis, get_db, WeatherHistory, WeatherMetrics
from app.services.weather_service import current_weather_request
from app.services.spraying_service import calculate_spraying_window
from app.services.custom_alert_engine import build_metric_snapshot, evaluate_custom_alert_rules
from app.events.urgent_email_alerts import deliver_pending_urgent_alerts
from typing import Any

router = APIRouter()


def _utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")

@router.get("/user/weather-history", tags=["Weather"])
async def get_weather_history(user_id: int, db: Session = Depends(get_db)):
    history = (
        db.query(WeatherHistory)
        .join(UserLocation)
        .filter(UserLocation.user_id == user_id)
        .order_by(WeatherHistory.timestamp.desc())
        .all()
    )
    return history


@router.get("/user/weather-current", tags=["Weather"])
async def get_current_weather(
        location_id: int,
        user_id: int,
        db: Session = Depends(get_db)
):
    location = db.query(UserLocation).filter(
        UserLocation.id == location_id,
        UserLocation.user_id == user_id
    ).first()

    if not location:
        raise HTTPException(
            status_code=404,
            detail="Location not found or access denied"
        )

    weather = current_weather_request(location)

    if not weather:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch weather data"
        )

    created = evaluate_custom_alert_rules(
        db,
        user_id,
        build_metric_snapshot(weather),
        location_id=location_id,
        source="weather_current",
    )
    if created:
        db.commit()
        deliver_pending_urgent_alerts(db, event_ids=[event.id for event in created])

    return weather


@router.get("/location/{location_id}/latest-weather", tags=["Weather"])
async def get_latest_location_weather(
    location_id: int,
    user_id: int,
    db: Session = Depends(get_db)
):
    location = db.query(UserLocation).filter(
        UserLocation.id == location_id,
        UserLocation.user_id == user_id
    ).first()

    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    latest_history = (
        db.query(WeatherHistory)
        .filter(
            WeatherHistory.location_id == location_id,
            WeatherHistory.timestamp <= now,
        )
        .order_by(WeatherHistory.timestamp.desc())
        .first()
    )

    if not latest_history:
        return {"history": None, "metrics": None}

    latest_metrics = (
        db.query(WeatherMetrics)
        .filter(WeatherMetrics.reference_weather_id == latest_history.id)
        .order_by(WeatherMetrics.id.desc())
        .first()
    )

    created = evaluate_custom_alert_rules(
        db,
        user_id,
        build_metric_snapshot(latest_history, latest_metrics),
        location_id=location_id,
        source="weather_latest",
    )
    if created:
        db.commit()
        deliver_pending_urgent_alerts(db, event_ids=[event.id for event in created])

    return {
        "history": latest_history,
        "metrics": latest_metrics
    }


@router.get("/location/{location_id}/weather-charts", tags=["Weather"])
async def get_weather_chart_data(
    location_id: int,
    user_id: int,
    db: Session = Depends(get_db)
):
    location = db.query(UserLocation).filter(
        UserLocation.id == location_id,
        UserLocation.user_id == user_id
    ).first()

    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    latest_metrics_subq = (
        db.query(
            WeatherMetrics.reference_weather_id.label("reference_weather_id"),
            func.max(WeatherMetrics.id).label("latest_metrics_id"),
        )
        .group_by(WeatherMetrics.reference_weather_id)
        .subquery()
    )

    results = (
        db.query(WeatherHistory, WeatherMetrics)
        .outerjoin(
            latest_metrics_subq,
            WeatherHistory.id == latest_metrics_subq.c.reference_weather_id,
        )
        .outerjoin(
            WeatherMetrics,
            WeatherMetrics.id == latest_metrics_subq.c.latest_metrics_id,
        )
        .filter(WeatherHistory.location_id == location_id)
        .order_by(WeatherHistory.timestamp.asc())
        .all()
    )

    chart_data = []
    for history, metrics in results:
        chart_data.append({
            "timestamp": _utc_iso(history.timestamp),
            "weather_data": {
                "temp": history.temp,
                "humidity": history.humidity,
                "precipitation": history.precipitation,
                "soil_moisture": history.soil_moisture_0_to_1cm,
                "soil_temperature": history.soil_temperature_0cm,
                "wind_speed": history.wind_speed
            },
            "metrics_data": {
                "gdd": metrics.gdd_base_10 if metrics else None,
                "rain_cum_30d": metrics.rain_cum_30d if metrics else None,
                "et0": metrics.et0 if metrics else None,
                "water_deficit": metrics.water_deficit_7d if metrics else None,
                "spi_1m": metrics.spi_1m if metrics else None,
                "rs_mj_m2_day": metrics.rs_mj_m2_day if metrics else None
            }
        })

    return chart_data


def _agg(db: Session, model, location_filter, col_name: str) -> dict:
    """Return avg/min/max/stddev for one column of a SQLAlchemy model."""
    col = getattr(model, col_name, None)
    if col is None:
        return {"avg": None, "min": None, "max": None, "std": None}
    row = db.query(
        func.avg(col).label("avg"),
        func.min(col).label("min"),
        func.max(col).label("max"),
        func.stddev_pop(col).label("std"),
    ).filter(location_filter).one()

    def r(v):
        return round(float(v), 3) if v is not None else None

    return {"avg": r(row.avg), "min": r(row.min), "max": r(row.max), "std": r(row.std)}


@router.get("/location/{location_id}/weather-stats", tags=["Weather"])
async def get_weather_stats(
    location_id: int,
    user_id: int,
    db: Session = Depends(get_db)
):
    """
    Historical benchmark statistics for every metric of a location.
    Used by the frontend to show avg/min/max context alongside live values.
    """
    location = db.query(UserLocation).filter(
        UserLocation.id == location_id,
        UserLocation.user_id == user_id
    ).first()

    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    history_filter  = WeatherHistory.location_id == location_id
    metrics_filter  = WeatherMetrics.location_id == location_id

    record_count = db.query(func.count(WeatherHistory.id)).filter(history_filter).scalar() or 0

    history_cols = [
        "temp", "humidity", "dew_point", "vapour_pressure_deficit",
        "precipitation", "rain", "pressure", "cloud_coverage",
        "wind_speed", "wind_deg", "soil_temperature_0cm", "soil_moisture_0_to_1cm",
    ]

    metrics_cols = [
        "temp_min_day_7d", "temp_max_day_7d", "temp_min_night_7d", "temp_max_night_7d",
        "gdd_base_10",
        "rain_cum_7d", "rain_cum_30d",
        "humidity_mean_7d", "humidity_mean_30d",
        "heat_days_count_7d", "frost_days_count_7d",
        "heat_days_count_30d", "frost_days_count_30d",
        "et0", "water_deficit_7d", "water_deficit_30d",
        "spi_1m", "ra_mj_m2_day", "rs_mj_m2_day",
    ]

    history_stats = {
        col: _agg(db, WeatherHistory, history_filter, col)
        for col in history_cols
    }

    metrics_stats = {
        col: _agg(db, WeatherMetrics, metrics_filter, col)
        for col in metrics_cols
    }

    return {
        "history": history_stats,
        "metrics": metrics_stats,
        "record_count": record_count,
    }


@router.get("/{location_id}/spraying-windows", tags=["Spaying"])
def get_location_spraying_windows(
    location_id: int,
    db: Session = Depends(get_db)
) -> Any:
    location = db.query(UserLocation).filter(
        UserLocation.id == location_id
    ).first()

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found"
        )

    result = calculate_spraying_window(db, location)

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spraying windows calculation failed. Check weather data availability."
        )

    return result
