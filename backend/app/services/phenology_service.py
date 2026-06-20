"""
Per-field phenology — additive pipeline stage.

For each active field, take its accumulated NDVI history (FieldData rows with
metric_type='ndvi') over a lookback window and compute SOS / EOS / peak DOY plus
peak NDVI via sentinel_processor. Stores one FieldData row with
metric_type='phenology': peak_val in the numeric column, the DOYs in ``extra``
(they overflow Numeric(6,4)).

Adds rows to FieldData only — no schema change. Idempotent: a row is only written
once per field per latest-observation timestamp, so re-runs without new NDVI data
do not duplicate. Fully guarded; never raises into the orchestrator.
"""

from __future__ import annotations

import datetime
import logging

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.config import (
    SENTINEL_PHENOLOGY_LOOKBACK_DAYS,
    SENTINEL_PHENOLOGY_MIN_OBS,
)
from app.core.database import FieldUnit, FieldData
from app.services import sentinel_phenology_engine

logger = logging.getLogger(__name__)


def _ndvi_series(db: Session, field_id: int, since: datetime.datetime):
    rows = (
        db.query(FieldData)
        .filter(
            and_(
                FieldData.field_id == field_id,
                FieldData.metric_type == "ndvi",
                FieldData.timestamp >= since,
                FieldData.mean_metric.isnot(None),
            )
        )
        .order_by(FieldData.timestamp)
        .all()
    )
    return rows


def _already_done(db: Session, field_id: int, last_ts: datetime.datetime) -> bool:
    return (
        db.query(FieldData.id)
        .filter(
            and_(
                FieldData.field_id == field_id,
                FieldData.metric_type == "phenology",
                FieldData.timestamp == last_ts,
            )
        )
        .first()
        is not None
    )


def run_phenology(db: Session) -> None:
    if not sentinel_phenology_engine.is_enabled():
        logger.info("[phenology] engine disabled; skipping phenology stage.")
        return

    now = datetime.datetime.utcnow()
    since = now - datetime.timedelta(days=SENTINEL_PHENOLOGY_LOOKBACK_DAYS)
    min_obs = SENTINEL_PHENOLOGY_MIN_OBS

    fields = db.query(FieldUnit).filter(FieldUnit.status == "active").all()
    logger.info("[phenology] %d active fields to evaluate.", len(fields))

    written = 0
    for field in fields:
        try:
            rows = _ndvi_series(db, field.id, since)
            if len(rows) < min_obs:
                continue

            last_ts = rows[-1].timestamp
            if _already_done(db, field.id, last_ts):
                continue

            values = [float(r.mean_metric) for r in rows]
            dates = [r.timestamp for r in rows]

            metrics = sentinel_phenology_engine.compute_field_phenology(
                values, dates, min_obs=min_obs
            )
            if metrics is None:
                continue

            db.add(
                FieldData(
                    field_id=field.id,
                    timestamp=last_ts,
                    metric_type="phenology",
                    mean_metric=metrics["peak_val"],
                    extra={
                        "sos_doy": metrics["sos_doy"],
                        "eos_doy": metrics["eos_doy"],
                        "peak_doy": metrics["peak_doy"],
                        "peak_val": metrics["peak_val"],
                        "n_obs": metrics["n_obs"],
                        "window_days": SENTINEL_PHENOLOGY_LOOKBACK_DAYS,
                        "source": sentinel_phenology_engine.ENGINE_NAME,
                    },
                )
            )
            db.commit()
            written += 1
            logger.info(
                "[phenology] field=%s SOS=%s EOS=%s peak=%s(val=%.3f) n=%d",
                field.id, metrics["sos_doy"], metrics["eos_doy"],
                metrics["peak_doy"], metrics["peak_val"], metrics["n_obs"],
            )
        except Exception as exc:
            db.rollback()
            logger.error("[phenology] field=%s failed: %s", field.id, exc, exc_info=True)

    logger.info("[phenology] done: %d field phenology records written.", written)
