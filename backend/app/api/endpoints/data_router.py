import os
import numpy as np
import xarray as xr

from fastapi import Depends, APIRouter, HTTPException

from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from app.core.database import UserLocation, FieldAnalysis, get_db, FieldUnit, UserDB
from app.core.security import get_current_user
import json
from app.core.config import STORAGE_PATH, NDVI_DIR, TOPO_DIR

router = APIRouter()


@router.get("/user/locations")
async def get_user_locations(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    from geoalchemy2.shape import to_shape
    locations = (
        db.query(UserLocation)
        .filter(UserLocation.user_id == user_id)
        .all()
    )

    result = []
    for loc in locations:
        lat, lon = None, None
        if loc.location is not None:
            try:
                pt = to_shape(loc.location)
                lon, lat = pt.x, pt.y
            except Exception:
                pass
        result.append({"id": loc.id, "label": loc.label, "lat": lat, "lon": lon})
    return result


@router.get("/location/{location_id}/latest-metrics/{metric}")
def get_latest_plotly_data(
    location_id: int,
    metric: str,
    step: int = 3,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id
    analysis = (
        db.query(FieldAnalysis)
        .join(UserLocation, FieldAnalysis.location_id == UserLocation.id)
        .filter(
            UserLocation.id == location_id,
            UserLocation.user_id == user_id,
            FieldAnalysis.metrics_status == True
        )
        .order_by(desc(FieldAnalysis.id))
        .first()
    )

    if not analysis or not analysis.metrics_filename:
        raise HTTPException(
            status_code=404,
            detail="No successful analysis found for this location"
        )

    file_path = os.path.join(NDVI_DIR, analysis.metrics_filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Metrics file not found on disk")

    try:
        with xr.open_dataset(file_path) as ds:
            if metric not in ds:
                raise HTTPException(status_code=400, detail=f"Metric {metric} not found in file")

            data = ds[metric].values
            y_coords = ds.coords['y'].values
            x_coords = ds.coords['x'].values

            step = max(1, min(step, 10))

            data     = data[::step, ::step]
            y_coords = y_coords[::step]
            x_coords = x_coords[::step]

            data_cleaned = np.where(np.isnan(data), None, data).tolist()
            y_list = y_coords.tolist()
            x_list = x_coords.tolist()

            return {
                "analysis_id": analysis.id,
                "z": data_cleaned,
                "x": x_list,
                "y": y_list,
                "metric_name": metric.upper(),
                "bounds": {
                    "min_lat": float(min(y_list)),
                    "max_lat": float(max(y_list)),
                    "min_lon": float(min(x_list)),
                    "max_lon": float(max(x_list))
                }
            }
    except Exception as e:
        print(f"[ERROR] Plotly extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Error processing NetCDF data")


@router.get("/location/{location_id}/dem-contours")
def get_dem_contours(
    location_id: int,
    interval: int = 10,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate contour lines from the cached Copernicus DEM tile for a location.

    Returns a GeoJSON FeatureCollection of LineStrings — one per contour level.
    Each feature has properties: { elevation: <metres> }

    Query params:
        interval  — contour interval in metres (default 10, min 5, max 100)
    """
    user_id = current_user.id
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import rioxarray

    loc = (
        db.query(UserLocation)
        .filter(UserLocation.id == location_id, UserLocation.user_id == user_id)
        .first()
    )
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found or access denied")

    tif_path = os.path.join(TOPO_DIR, f"dem_user_{loc.user_id}_loc_{loc.id}.tif")
    if not os.path.exists(tif_path):
        raise HTTPException(
            status_code=404,
            detail="DEM tile not found for this location. Run a full sync first."
        )

    interval = max(5, min(interval, 100))

    try:
        da = rioxarray.open_rasterio(tif_path, masked=True)
        elev = da.squeeze().values.astype(float)

        lons = da.coords["x"].values
        lats = da.coords["y"].values

        nodata = da.rio.nodata
        if nodata is not None:
            elev[elev == nodata] = np.nan

        valid = elev[~np.isnan(elev)]
        if valid.size == 0:
            raise HTTPException(status_code=422, detail="DEM contains no valid elevation data")

        elev_min = float(np.floor(valid.min() / interval) * interval)
        elev_max = float(np.ceil(valid.max()  / interval) * interval)
        levels   = np.arange(elev_min, elev_max + interval, interval).tolist()

        if len(levels) < 2:
            raise HTTPException(status_code=422, detail="Elevation range too small for chosen interval")

        fig, ax = plt.subplots()
        cs = ax.contour(lons, lats, elev, levels=levels)
        plt.close(fig)

        features = []
        for level_idx, level_val in enumerate(cs.levels):
            for seg in cs.allsegs[level_idx]:
                if len(seg) < 2:
                    continue
                coords = [[round(float(x), 6), round(float(y), 6)] for x, y in seg]
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords,
                    },
                    "properties": {
                        "elevation": round(float(level_val), 1),
                        "index_line": (round(level_val) % 50 == 0),
                    },
                })

        return {
            "type": "FeatureCollection",
            "features": features,
            "meta": {
                "interval_m": interval,
                "levels": len(levels),
                "elev_min": round(elev_min, 1),
                "elev_max": round(elev_max, 1),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] DEM contour generation failed for loc={location_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate contours from DEM")


@router.get("/user/fields")
def get_user_fields(
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    fields = (
        db.query(
            FieldUnit.id,
            FieldUnit.label,
            FieldUnit.field_type,
            FieldUnit.crop_type,
            func.ST_AsGeoJSON(FieldUnit.geometry).label("geom_json")
        )
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(UserLocation.user_id == user_id)
        .all()
    )

    if not fields:
        return {"type": "FeatureCollection", "features": []}

    features = []
    for f in fields:
        features.append({
            "type": "Feature",
            "id": f.id,
            "geometry": json.loads(f.geom_json),
            "properties": {
                "id": f.id,
                "label": f.label,
                "field_type": f.field_type.value if hasattr(f.field_type, "value") else f.field_type,
                "crop_type": f.crop_type,
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }


@router.get("/user/fields-list")
def get_user_fields_list(
    location_id: int = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id
    query = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(UserLocation.user_id == user_id)
    )
    if location_id:
        query = query.filter(FieldUnit.location_id == location_id)

    try:
        query = query.filter(FieldUnit.deleted_at.is_(None))
    except Exception:
        pass

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


from pydantic import BaseModel as _BaseModel

class _FieldUpdate(_BaseModel):
    label: str = None
    field_type: str = None
    crop_type: str = None
    season_year: int = None
    status: str = None


@router.get("/fields/user_fields")
def get_fields_user_fields(
    location_id: int = None,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    query = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(UserLocation.user_id == user_id)
    )
    if location_id:
        query = query.filter(FieldUnit.location_id == location_id)
    try:
        query = query.filter(FieldUnit.deleted_at.is_(None))
    except Exception:
        pass
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


@router.patch("/fields/{field_id}")
def patch_field(
    field_id: int,
    payload: _FieldUpdate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    from sqlalchemy import and_
    field = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(FieldUnit.id == field_id, UserLocation.user_id == user_id)
        .first()
    )
    if not field:
        raise HTTPException(status_code=404, detail="Field not found or access denied")

    import datetime
    if payload.label       is not None: field.label       = payload.label.strip()
    if payload.crop_type   is not None: field.crop_type   = payload.crop_type or None
    if payload.season_year is not None: field.season_year = payload.season_year
    if payload.status      is not None: field.status      = payload.status
    if payload.field_type  is not None: field.field_type  = payload.field_type
    field.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(field)
    return {
        "message":     "Field updated",
        "id":          field.id,
        "label":       field.label,
        "field_type":  field.field_type.value if hasattr(field.field_type, "value") else field.field_type,
        "crop_type":   field.crop_type,
        "season_year": field.season_year,
        "status":      field.status,
    }

# ── Anomaly pixels for a field ────────────────────────────────────────────────
@router.get("/fields/{field_id}/anomalies")
def get_field_anomalies(
    field_id: int,
    limit: int = 10,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    GET /api/v1/fields/{field_id}/anomalies?user_id=1&limit=10

    Returns the most recent anomaly records for a field, including
    anomaly_pixels (lat/lon/delta) so the frontend can plot them on the map.

    Response shape:
    [
      {
        "id": 42,
        "field_id": 13,
        "analysis_date": "2026-05-22T10:00:00",
        "anomaly_type": "SUDDEN_CHANGE",
        "confidence_score": 0.845,
        "status": "ACTIVE",
        "metric_type": "ndvi",
        "direction": "drop",
        "prev_mean": 0.72,
        "last_mean": 0.48,
        "abs_delta": -0.24,
        "rel_change": -0.333,
        "anomaly_ratio": 0.574,
        "anomaly_pixel_count": 31,
        "total_pixel_count": 54,
        "area_ha": 1.48,
        "anomaly_pixels": [
          {"row":2,"col":3,"lat":46.702,"lon":13.701,"delta":-0.28},
          ...
        ]
      },
      ...
    ]
    """
    user_id = current_user.id
    from app.core.database import FieldStatAnomalyAnalysis, FieldUnit
    from sqlalchemy import and_

    # Verify the field belongs to this user
    field = (
        db.query(FieldUnit)
        .join(UserLocation, FieldUnit.location_id == UserLocation.id)
        .filter(FieldUnit.id == field_id, UserLocation.user_id == user_id)
        .first()
    )
    if not field:
        raise HTTPException(status_code=404, detail="Field not found or access denied")

    limit = max(1, min(limit, 50))

    rows = (
        db.query(FieldStatAnomalyAnalysis)
        .filter(FieldStatAnomalyAnalysis.field_id == field_id)
        .order_by(FieldStatAnomalyAnalysis.analysis_date.desc())
        .limit(limit)
        .all()
    )

    result = []
    for r in rows:
        s = r.metrics_summary or {}
        result.append({
            "id":                  r.id,
            "field_id":            r.field_id,
            "analysis_date":       r.analysis_date.isoformat() if r.analysis_date else None,
            "anomaly_type":        r.anomaly_type.value if hasattr(r.anomaly_type, "value") else r.anomaly_type,
            "confidence_score":    float(r.confidence_score) if r.confidence_score is not None else None,
            "status":              r.status.value if hasattr(r.status, "value") else r.status,
            "metric_type":         s.get("metric_type"),
            "direction":           s.get("direction"),
            "prev_mean":           s.get("prev_mean"),
            "last_mean":           s.get("last_mean"),
            "abs_delta":           s.get("abs_delta"),
            "rel_change":          s.get("rel_change"),
            "anomaly_ratio":       s.get("anomaly_ratio"),
            "anomaly_pixel_count": s.get("anomaly_pixel_count"),
            "total_pixel_count":   s.get("total_pixel_count"),
            "area_ha":             s.get("area_ha"),
            "prev_timestamp":      s.get("prev_timestamp"),
            "last_timestamp":      s.get("last_timestamp"),
            "anomaly_pixels":      s.get("anomaly_pixels", []),
        })

    return result

# ── False-positive feedback ───────────────────────────────────────────────────

from pydantic import BaseModel as _FPBase
from typing import Optional as _Opt


class _FPCreate(_FPBase):
    user_id:          _Opt[int]  = None   # ignored — identity comes from the token
    event_id:         _Opt[int]  = None
    anomaly_id:       _Opt[int]  = None
    event_type:       _Opt[str]  = None
    comment:          _Opt[str]  = None
    context_snapshot: _Opt[dict] = None


@router.post("/false-positives", tags=["FalsePositives"], status_code=201)
def create_false_positive(
    payload: _FPCreate,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    POST /api/v1/false-positives

    Body (JSON):
        user_id          int        – обязательно
        event_id         int|null   – id из таблицы events
        anomaly_id       int|null   – id из field_stat_anomaly_analysis
        event_type       str|null   – тип события / аномалии (для аналитики)
        comment          str|null   – свободный комментарий оператора
        context_snapshot dict|null  – произвольный снапшот параметров
    """
    from app.core.database import FalsePositiveFeedback, Events, FieldStatAnomalyAnalysis

    if not payload.event_id and not payload.anomaly_id:
        raise HTTPException(
            status_code=400,
            detail="Необходимо передать event_id или anomaly_id (или оба)"
        )

    record = FalsePositiveFeedback(
        user_id          = current_user.id,
        event_id         = payload.event_id,
        anomaly_id       = payload.anomaly_id,
        event_type       = payload.event_type,
        comment          = payload.comment,
        context_snapshot = payload.context_snapshot,
    )
    db.add(record)

    if payload.event_id:
        evt = db.query(Events).filter(Events.id == payload.event_id).first()
        if evt:
            evt.status = "IGNORED"

    if payload.anomaly_id:
        from app.core.database import FieldStatAnomalyAnalysis
        anom = db.query(FieldStatAnomalyAnalysis).filter(
            FieldStatAnomalyAnalysis.id == payload.anomaly_id
        ).first()
        if anom:
            anom.status = "IGNORED"

    db.commit()
    db.refresh(record)

    return {
        "id":         record.id,
        "event_id":   record.event_id,
        "anomaly_id": record.anomaly_id,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "message":    "Записано как ложноположительное",
    }


@router.get("/false-positives", tags=["FalsePositives"])
def list_false_positives(
    event_type: _Opt[str] = None,
    limit:      int = 50,
    offset:     int = 0,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    """
    GET /api/v1/false-positives?user_id=1&event_type=METRIC_ANOMALY&limit=50

    Response shape:
    {
      "total": 42,
      "items": [
        {
          "id": 1,
          "event_id": 17,
          "anomaly_id": null,
          "event_type": "NDVI_DROP",
          "comment": "скашивание, не аномалия",
          "context_snapshot": { "abs_delta": -0.31, "metric_type": "ndvi" },
          "created_at": "2026-05-22T10:00:00"
        },
        ...
      ]
    }
    """
    from app.core.database import FalsePositiveFeedback

    query = db.query(FalsePositiveFeedback).filter(
        FalsePositiveFeedback.user_id == user_id
    )
    if event_type:
        query = query.filter(FalsePositiveFeedback.event_type == event_type)

    total = query.count()
    rows  = (
        query
        .order_by(FalsePositiveFeedback.created_at.desc())
        .offset(offset)
        .limit(max(1, min(limit, 200)))
        .all()
    )

    return {
        "total": total,
        "items": [
            {
                "id":               r.id,
                "event_id":         r.event_id,
                "anomaly_id":       r.anomaly_id,
                "event_type":       r.event_type,
                "comment":          r.comment,
                "context_snapshot": r.context_snapshot,
                "created_at":       r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.delete("/false-positives/{fp_id}", tags=["FalsePositives"], status_code=204)
def delete_false_positive(
    fp_id:   int,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    """
    DELETE /api/v1/false-positives/{fp_id}?user_id=1
    """
    from app.core.database import FalsePositiveFeedback

    record = db.query(FalsePositiveFeedback).filter(
        FalsePositiveFeedback.id      == fp_id,
        FalsePositiveFeedback.user_id == user_id,
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail="Запись не найдена или нет доступа")

    db.delete(record)
    db.commit()