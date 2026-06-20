import os
import time
import numpy as np
import xarray as xr
import requests
from sqlalchemy.orm import Session
from app.core.database import FieldAnalysis
from app.core.config import HASKELL_SERVICE_URL, MASK_DIR, WEBHOOK_URL, DATA_DIR,REQUIRED_BANDS, MIN_DIM
from app.monitoring.alerting import AlertService, format_alert
from app.services import sentinel_validation_engine


alert_service = AlertService(webhook_url=WEBHOOK_URL)

def perform_haskell_validation(mask_path, threshold=0.3):
    try:
        with xr.open_dataset(mask_path) as mds:
            scl_values = (
                mds.to_array()
                .values
                .flatten()
                .astype(float)
            )

            scl_values = [
                int(v) for v in scl_values
                if v is not None and not np.isnan(v)
            ]

        payload = {
            "config": 2,
            "scl_values": scl_values,
            "threshold": threshold
        }

        for _ in range(3):
            try:
                response = requests.post(
                    HASKELL_SERVICE_URL,
                    json=payload,
                    timeout=10
                )
                if response.status_code == 200:
                    return response.json()
            except requests.RequestException:
                time.sleep(1)

        alert_service.send(
            key="haskell_validation_timeout",
            message=format_alert("HASKELL_UNREACHABLE", f"Validation service failed for mask: {mask_path}")
        )
        return None

    except Exception as e:
        print(f"[ERROR] Haskell communication failed: {e}")
        return None


def perform_nc_validation(nc_path):
    report = []
    status_flag = 1

    SKIP_VARS = {"spatial_ref", "crs", "grid_mapping"}

    if not nc_path or not os.path.exists(nc_path):
        report.append(f"NetCDF file not found: {nc_path}")
        return 0, "; ".join(report)

    try:
        with xr.open_dataset(nc_path) as nc:
            has_band_coord = 'band' in nc.coords

            data_vars_clean = [v for v in nc.data_vars if v not in SKIP_VARS]

            if has_band_coord:
                actual_bands = nc.coords['band'].values.tolist()
                missing_bands = [b for b in REQUIRED_BANDS if b not in actual_bands]
                data_var_name = data_vars_clean[0] if data_vars_clean else None
            else:
                missing_bands = [b for b in REQUIRED_BANDS if b not in data_vars_clean]
                data_var_name = None

            if missing_bands:
                report.append(f"Missing required bands: {missing_bands}")
                status_flag = 0

            width = nc.sizes.get('x', 0)
            height = nc.sizes.get('y', 0)

            if width < MIN_DIM or height < MIN_DIM:
                report.append(f"Resolution too low: {width}x{height}")
                status_flag = 0

            if has_band_coord and data_var_name:
                data_array = nc[data_var_name].sel(band=actual_bands[0]).values
            elif not missing_bands and REQUIRED_BANDS[0] in data_vars_clean:
                data_array = nc[REQUIRED_BANDS[0]].values
            elif data_vars_clean:
                data_array = nc[data_vars_clean[0]].values
            else:
                report.append("No data variables or band coordinates found in file")
                return 0, "; ".join(report)

            if data_array.size == 0:
                report.append("Data array is empty")
                return 0, "; ".join(report)

            valid_pixels = np.count_nonzero(~np.isnan(data_array) & (data_array > 0))
            total_pixels = data_array.size
            fill_rate = valid_pixels / total_pixels

            if fill_rate < 0.05:
                report.append(f"File is mostly empty. Fill rate: {fill_rate:.2%}")
                status_flag = 0
            elif status_flag == 1:
                report.append(f"Validation passed. Fill rate: {fill_rate:.2%}")

    except Exception as e:
        report.append(f"Corrupted file or read error: {str(e)}")
        status_flag = 0

    return status_flag, "; ".join(report)


def validate_pending_analyses(db: Session):
    pending_list = db.query(FieldAnalysis).filter(FieldAnalysis.is_valid == None).all()

    if not pending_list:
        print("[INFO] No pending analyses to validate.")
        return

    print(f"[INFO] Found {len(pending_list)} records for validation.")

    for analysis in pending_list:
        mask_path = os.path.join(MASK_DIR, analysis.mask_filename) if analysis.mask_filename else None
        nc_path = os.path.join(DATA_DIR, analysis.nc_filename) if analysis.nc_filename else None

        status_flag, report = perform_nc_validation(nc_path)
        if status_flag == 0:
            print(f"[INFO] NC file corrupted for analysis_id={analysis.id}.")
            analysis.is_valid = 0.0
            analysis.quality_report = report
            continue

        if not mask_path or not os.path.exists(mask_path):
            print(f"[WARN] Mask file missing for analysis_id={analysis.id}. Skipping.")
            continue

        # Primary: in-process Fortran SCL validation (sentinel_processor).
        # Fallback: legacy Haskell field-stats config=2. Both return the same
        # dict, so everything below is unchanged.
        result = None
        if sentinel_validation_engine.is_enabled():
            try:
                result = sentinel_validation_engine.validate_scl_mask(mask_path, threshold=0.3)
            except Exception as engine_err:
                print(
                    f"[WARNING] {sentinel_validation_engine.ENGINE_NAME} validation failed "
                    f"for analysis_id={analysis.id} ({engine_err}); falling back to Haskell."
                )
                result = None

        if result is None:
            result = perform_haskell_validation(mask_path, threshold=0.3)

        if result:
            confidence_score = result.get('confidence_score', 0.0)

            analysis.is_valid = max(0.0, confidence_score)
            analysis.quality_report = result.get('quality_report')

            if analysis.results_json is None:
                analysis.results_json = {}

            analysis.results_json['confidence_score'] = confidence_score
            analysis.results_json['cloud_ratio'] = result.get('cloud_ratio')
            analysis.results_json['snow_ratio'] = result.get('snow_ratio')
            analysis.results_json['issues'] = result.get('issues', [])

            db.commit()
            print(f"[INFO] Analysis {analysis.id} validated. Confidence: {confidence_score}")
        else:
            print(f"[ERROR] Haskell service failed for analysis_id={analysis.id}")

