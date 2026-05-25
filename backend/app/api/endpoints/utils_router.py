from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import UserLocation, FieldAnalysis, UserDB, get_db
from app.events.morning_briefing_email import send_morning_briefing_for_user
from app.services.orchestrator import full_sync_process, short_sync_process
from app.services.biomass_service import run_biomass_estimation
from app.services.irrigation_service import run_irrigation_recommendations
from app.services.dem_service import ensure_dem_for_all_locations
from app.services.storage_cleanup import cleanup_failed_datasets
from app.core.config import CLEANUP_RETAIN_LATEST_DATASETS

router = APIRouter()


@router.get("/users/{user_id}/locations/{location_id}/stats")
def get_location_analysis_stats(
        user_id: int,
        location_id: int,
        db: Session = Depends(get_db)
):
    location = db.query(UserLocation).filter(
        UserLocation.id == location_id,
        UserLocation.user_id == user_id
    ).first()

    if not location:
        raise HTTPException(status_code=404, detail="Location not found for this user")

    analyses = db.query(FieldAnalysis).filter(
        FieldAnalysis.location_id == location_id
    ).all()

    segmentation_only = 0
    ndvi_and_segmentation = 0
    total_valid = 0

    for analysis in analyses:
        if analysis.is_valid is not None:
            if analysis.is_valid >= 0.75:
                ndvi_and_segmentation += 1
                total_valid += 1
            elif analysis.is_valid >= 0.5:
                segmentation_only += 1
                total_valid += 1

    return {
        "location_label": location.label,
        "stats": {
            "suitable_for_segmentation_only": segmentation_only,
            "suitable_for_ndvi_and_segmentation": ndvi_and_segmentation,
            "total_suitable_images": total_valid,
            "total_records_checked": len(analyses)
        }
    }


@router.get("/test_func")
def test_function(db: Session = Depends(get_db)):
    run_irrigation_recommendations(db)
    run_biomass_estimation(db)
    ensure_dem_for_all_locations(db)
    return 0


@router.post("/sync/full", tags=["Synchronisation"])
async def manual_full_sync(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    def run_sync():
        full_sync_process(db)

    background_tasks.add_task(run_sync)
    return {"status": "Full synchronization started in background"}


@router.post("/sync/short", tags=["Synchronisation"])
async def manual_short_sync(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    def run_sync():
        short_sync_process(db)

    background_tasks.add_task(run_sync)
    return {"status": "Short sync (weather) started in background"}


@router.post("/cleanup/storage", tags=["Utils"])
def manual_storage_cleanup(
    dry_run: bool = True,
    retention_limit: int = CLEANUP_RETAIN_LATEST_DATASETS,
    db: Session = Depends(get_db),
):
    report = cleanup_failed_datasets(
        db,
        dry_run=dry_run,
        retention_limit=retention_limit,
    )
    return report.to_dict()


@router.post("/briefing/test", tags=["Utils"])
def test_morning_briefing(user_id: int, db: Session = Depends(get_db)):
    user = db.get(UserDB, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email:
        raise HTTPException(status_code=400, detail="User has no email set")
    if not user.email_enabled:
        raise HTTPException(status_code=400, detail="Email notifications are disabled for this user")

    success = send_morning_briefing_for_user(db, user)
    if success:
        return {"status": "sent", "to": user.email}
    raise HTTPException(status_code=500, detail="Failed to send email — check server logs")
