import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from time import sleep
import datetime
from datetime import datetime, timedelta
from sqlalchemy import case, or_
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from app.core.database import WeatherHistory, UserLocation, WeatherMetrics
from app.utils.general import safe_float, safe_int, r
from geoalchemy2.shape import to_shape
from app.monitoring.alerting import AlertService, format_alert
from app.core.config import MIN_RECORDS_7D, HASKELL_SERVICE_URL, WEBHOOK_URL, WEATHER_API_KEY
from app.services.dem_service import get_elevation_for_location
from app.services.wrf_service import wrf_covered_timestamps

alert_service = AlertService(webhook_url=WEBHOOK_URL)

OPEN_METEO_SOURCE = "open-meteo"

WEATHER_RECALCULATION_COLUMNS = (
    "temp",
    "humidity",
    "dew_point",
    "vapour_pressure_deficit",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "soil_temperature_0cm",
    "soil_moisture_0_to_1cm",
    "pressure",
    "cloud_coverage",
    "wind_speed",
    "wind_deg",
    "sunrise",
    "sunset",
    "is_night",
)

WEATHER_METRIC_COLUMNS = (
    "temp_min_day_7d",
    "temp_max_day_7d",
    "temp_min_night_7d",
    "temp_max_night_7d",
    "gdd_base_10",
    "rain_cum_7d",
    "rain_cum_30d",
    "water_deficit_7d",
    "water_deficit_30d",
    "et0",
    "humidity_mean_7d",
    "humidity_mean_30d",
    "heat_days_count_7d",
    "heat_days_count_30d",
    "frost_days_count_7d",
    "frost_days_count_30d",
    "spi_1m",
    "ra_mj_m2_day",
    "rs_mj_m2_day",
)


def _liquid_precipitation_mm(weather_record: WeatherHistory) -> float:
    liquid_parts = [
        weather_record.rain,
        weather_record.showers,
    ]
    if any(v is not None for v in liquid_parts):
        return sum(max(0.0, float(v)) for v in liquid_parts if v is not None)

    if weather_record.precipitation is None:
        return 0.0

    snowfall = weather_record.snowfall or 0.0
    return max(0.0, float(weather_record.precipitation) - float(snowfall))


def _total_precipitation_mm(weather_record: WeatherHistory) -> float:
    if weather_record.precipitation is not None:
        return max(0.0, float(weather_record.precipitation))
    return _liquid_precipitation_mm(weather_record) + max(0.0, float(weather_record.snowfall or 0.0))


def _weather_changed_expr(stmt):
    return or_(*(
        getattr(WeatherHistory, column).is_distinct_from(getattr(stmt.excluded, column))
        for column in WEATHER_RECALCULATION_COLUMNS
    ))


def _upsert_weather_metrics(db: Session, values: dict) -> None:
    """Insert-or-update one metrics row keyed by (location_id, reference_weather_id).

    Uses a single ``INSERT ... ON CONFLICT DO UPDATE`` instead of the previous
    SELECT-then-insert. The old pattern had no DB-level guard, so concurrent /
    overlapping sync jobs (daily 23:45 + short cycles, 2-thread executor) both
    saw "no existing row" and each issued an INSERT — producing up to ~177
    duplicate metric rows per weather record and the "barcode" charts.

    Requires the unique constraint ``uq_weather_metrics_location_weather`` to
    exist in the database — created by
    ``backend/migrations/2026_06_weather_metrics_dedup_unique.sql`` (it is
    declared on the model but Base.metadata.create_all does not add constraints
    to a pre-existing table, so the migration must be applied once).
    """
    stmt = insert(WeatherMetrics).values(**values)
    update_set = {col: getattr(stmt.excluded, col) for col in WEATHER_METRIC_COLUMNS}
    update_set["window_end_date"] = stmt.excluded.window_end_date
    stmt = stmt.on_conflict_do_update(
        constraint="uq_weather_metrics_location_weather",
        set_=update_set,
    )
    db.execute(stmt)


def _http_session() -> requests.Session:
    """HTTP session with automatic retry on 5xx and connection errors."""
    session = requests.Session()
    retry = Retry(
        total=4,
        backoff_factor=2,          # 2s, 4s, 8s, 16s
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def fetch_and_save_weather(db: Session, location: UserLocation):
    point = to_shape(location.location)
    lon, lat = point.x, point.y

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,"
        "vapour_pressure_deficit,precipitation,rain,showers,snowfall,"
        "soil_temperature_0cm,soil_moisture_0_to_1cm,surface_pressure,"
        "cloud_cover,wind_speed_10m,wind_direction_10m"
        "&daily=sunrise,sunset&timezone=UTC"
    )

    try:
        session  = _http_session()
        response = session.get(url, timeout=30)
        response.raise_for_status()
        data   = response.json()
        hourly = data["hourly"]
        times  = hourly["time"]
        daily  = data.get("daily", {})

        sun_map = {
            daily["time"][i]: (daily["sunrise"][i], daily["sunset"][i])
            for i in range(len(daily.get("time", [])))
        }

        skipped = inserted = 0

        for i, ts in enumerate(times):
            timestamp = datetime.fromisoformat(ts)


            date_key = ts.split("T")[0]
            sunrise_str, sunset_str = sun_map.get(date_key, (None, None))
            sunrise_dt = datetime.fromisoformat(sunrise_str) if sunrise_str else None
            sunset_dt  = datetime.fromisoformat(sunset_str)  if sunset_str  else None

            is_night = True
            if sunrise_dt and sunset_dt:
                is_night = not (sunrise_dt <= timestamp <= sunset_dt)

            insert_data = {
                "location_id":             location.id,
                "timestamp":               timestamp,
                "temp":                    hourly["temperature_2m"][i],
                "humidity":                hourly["relative_humidity_2m"][i],
                "dew_point":               hourly["dew_point_2m"][i],
                "vapour_pressure_deficit": hourly["vapour_pressure_deficit"][i],
                "precipitation":           hourly["precipitation"][i],
                "rain":                    hourly["rain"][i],
                "showers":                 hourly["showers"][i],
                "snowfall":                hourly["snowfall"][i],
                "soil_temperature_0cm":    hourly["soil_temperature_0cm"][i],
                "soil_moisture_0_to_1cm":  hourly["soil_moisture_0_to_1cm"][i],
                "pressure":                hourly["surface_pressure"][i],
                "cloud_coverage":          hourly["cloud_cover"][i],
                "wind_speed":              hourly["wind_speed_10m"][i],
                "wind_deg":                hourly["wind_direction_10m"][i],
                "sunrise":                 sunrise_dt,
                "sunset":                  sunset_dt,
                "is_night":                is_night,
                "data_source":             OPEN_METEO_SOURCE,
                "metrics_status":          False,
            }

            stmt = insert(WeatherHistory).values(insert_data)
            changed = _weather_changed_expr(stmt)
            update_values = {
                k: getattr(stmt.excluded, k)
                for k in insert_data
                if k not in ("location_id", "timestamp", "metrics_status")
            }
            update_values["metrics_status"] = case(
                (changed, False),
                else_=WeatherHistory.metrics_status,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_weather_location_timestamp",
                set_=update_values,
            )
            db.execute(stmt)
            inserted += 1

        db.commit()
        print(f"[INFO] Open-Meteo: {inserted} saved, {skipped} skipped (WRF) for {location.label}")

    except Exception as e:
        db.rollback()
        alert_service.send(
            key=f"weather_fetch_error_{location.id}",
            message=format_alert(
                "WEATHER_SYNC_FAILURE",
                f"Could not fetch weather for {location.label}: {str(e)}",
                {"location_id": location.id, "url": url}
            )
        )
        print(f"[ERROR] Weather fetch failed for loc {location.id}: {e}")


def request_elevation(lat, lon, retries=3):
    url = "https://api.open-elevation.com/api/v1/lookup"
    params = {"locations": f"{lat},{lon}"}
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            return float(resp.json()["results"][0]["elevation"])
        except Exception:
            sleep(1.5 * (attempt + 1))
    return None


def _serialize_weather_point(weather_record):
    return {
        "t":        weather_record.temp,
        "h":        weather_record.humidity,
        "p":        weather_record.pressure,
        "ws":       weather_record.wind_speed,
        "wd":       weather_record.wind_deg,
        "cc":       weather_record.cloud_coverage,
        "r":        _liquid_precipitation_mm(weather_record),
        "s":        weather_record.snowfall or 0.0,
        "dt":       weather_record.timestamp.isoformat(),
        "is_night": weather_record.is_night,
        "source":   weather_record.data_source,
    }


def weather_metrics(db: Session, location: UserLocation):
    pending_list = (
        db.query(WeatherHistory)
        .filter(
            WeatherHistory.location_id == location.id,
            WeatherHistory.metrics_status == False,
            WeatherHistory.data_source == "open-meteo",
        )
        .order_by(WeatherHistory.timestamp.asc())
        .all()
    )

    if not pending_list:
        return

    point = to_shape(location.location)
    lon, lat = point.x, point.y

    elevation = get_elevation_for_location(location)
    if elevation is None:
        print(f"[WARN] DEM unavailable for loc {location.id}, falling back to open-elevation API.")
        elevation = request_elevation(lat, lon) or 0.0

    for weather_record in pending_list:

        end_date  = weather_record.timestamp
        start_7d  = end_date - timedelta(days=7)
        start_30d = end_date - timedelta(days=30)

        day_of_year = weather_record.timestamp.timetuple().tm_yday

        history_7d = (
            db.query(WeatherHistory)
            .filter(
                WeatherHistory.location_id == location.id,
                WeatherHistory.timestamp.between(start_7d, end_date),
                WeatherHistory.data_source == "open-meteo",
            )
            .order_by(WeatherHistory.timestamp.asc())
            .all()
        )

        history_30d = (
            db.query(WeatherHistory)
            .filter(
                WeatherHistory.location_id == location.id,
                WeatherHistory.timestamp.between(start_30d, end_date),
                WeatherHistory.data_source == "open-meteo",
            )
            .order_by(WeatherHistory.timestamp.asc())
            .all()
        )

        temps       = [h.temp     for h in history_7d if h.temp     is not None]
        humidity_7d = [h.humidity for h in history_7d if h.humidity is not None]

        rain_7d  = sum(_total_precipitation_mm(h) for h in history_7d)
        rain_30d = sum(_total_precipitation_mm(h) for h in history_30d)

        gdd_base_10    = sum(max(0, h.temp - 10) for h in history_7d if h.temp is not None) / 24
        heat_days_7d   = sum(1 for h in history_7d  if h.temp and h.temp > 30)
        frost_days_7d  = sum(1 for h in history_7d  if h.temp is not None and h.temp < 0)
        heat_days_30d  = sum(1 for h in history_30d if h.temp and h.temp > 30)
        frost_days_30d = sum(1 for h in history_30d if h.temp is not None and h.temp < 0)

        location_data = {
            "metadata": {
                "lat":         safe_float(lat),
                "lon":         safe_float(lon),
                "elevation":   safe_float(elevation),
                "day_of_year": day_of_year,
            },
            "current":    _serialize_weather_point(weather_record),
            "history_7d":  [_serialize_weather_point(h) for h in history_7d],
            "history_30d": [_serialize_weather_point(h) for h in history_30d],
        }

        result = perform_haskell_weather_metrics(location_data)

        base_kwargs = dict(
            location_id=location.id,
            reference_weather_id=weather_record.id,
            window_end_date=end_date,
            rain_cum_7d=r(rain_7d),
            rain_cum_30d=r(rain_30d),
            heat_days_count_7d=heat_days_7d,
            frost_days_count_7d=frost_days_7d,
            heat_days_count_30d=heat_days_30d,
            frost_days_count_30d=frost_days_30d,
        )

        if (not result) or len(history_7d) < MIN_RECORDS_7D:
            metrics_values = {
                **base_kwargs,
                "gdd_base_10": r(gdd_base_10),
                "temp_min_day_7d": min(temps) if temps else None,
                "temp_max_day_7d": max(temps) if temps else None,
                "temp_min_night_7d": None,
                "temp_max_night_7d": None,
                "humidity_mean_7d": r(sum(humidity_7d) / len(humidity_7d)) if humidity_7d else None,
                "humidity_mean_30d": None,
                "et0": None,
                "water_deficit_7d": None,
                "water_deficit_30d": None,
                "spi_1m": None,
                "ra_mj_m2_day": None,
                "rs_mj_m2_day": None,
            }
        else:
            metrics_values = {
                **base_kwargs,
                "gdd_base_10": r(result.get("gdd")),
                "temp_min_day_7d": result.get("temp_min_7d"),
                "temp_max_day_7d": result.get("temp_max_7d"),
                "temp_min_night_7d": result.get("temp_min_night_7d"),
                "temp_max_night_7d": result.get("temp_max_night_7d"),
                "humidity_mean_7d": r(result.get("hum_mean_7d")),
                "humidity_mean_30d": r(result.get("hum_mean_30d")),
                "et0": r(result.get("et0")),
                "water_deficit_7d": r(result.get("water_deficit_7d")),
                "water_deficit_30d": r(result.get("water_deficit_30d")),
                "spi_1m": r(result.get("spi1m")),
                "ra_mj_m2_day": r(result.get("ra")),
                "rs_mj_m2_day": r(result.get("rs")),
            }

        _upsert_weather_metrics(db, metrics_values)
        weather_record.metrics_status = True

        try:
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[ERROR] Failed to save metrics: {e}")


def perform_haskell_weather_metrics(location_data):
    try:
        session  = _http_session()
        response = session.post(
            HASKELL_SERVICE_URL,
            json={"raw_data": location_data, "config": 3},
            timeout=10,
        )
        if response.status_code == 200:
            return response.json()
        print(f"[ERROR] Haskell service returned {response.status_code}: {response.text}")
        return None
    except Exception as e:
        print(f"[ERROR] Haskell service communication error: {e}")
        return None


def current_weather_request(location: UserLocation):
    point = to_shape(location.location)
    lon, lat = point.x, point.y

    url = (
        f"https://api.openweathermap.org/data/2.5/weather"
        f"?lat={lat}&lon={lon}&appid={WEATHER_API_KEY}&units=metric"
    )

    try:
        session  = _http_session()
        response = session.get(url, timeout=15)
        response.raise_for_status()
        data = response.json()
        return {
            "timestamp":           datetime.fromtimestamp(data.get("dt")).isoformat(),
            "temp":                data["main"]["temp"],
            "pressure":            data["main"]["pressure"],
            "humidity":            data["main"]["humidity"],
            "wind_speed":          data.get("wind", {}).get("speed"),
            "wind_deg":            data.get("wind", {}).get("deg"),
            "cloud_coverage":      data.get("clouds", {}).get("all"),
            "weather_main":        data["weather"][0]["main"],
            "weather_description": data["weather"][0]["description"],
        }
    except Exception as e:
        alert_service.send(
            key=f"weather_err_{location.id}",
            message=f"Error for {location.label}: {str(e)}"
        )
        return None
