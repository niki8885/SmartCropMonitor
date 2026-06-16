# =========================
# Imports
# =========================
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config
from app.core.database import engine, Base
from app.api.endpoints.field_router import router as field_router
from app.api.endpoints.auth_router import router as auth_router
from app.api.endpoints.data_router import router as data_router
from app.api.endpoints.weather_router import router as weather_router
from app.api.endpoints.sensor_router import router as sensor_router
from app.api.endpoints.utils_router import router as utils_router
from app.api.endpoints.events_router import router as events_router
from app.api.endpoints.fieldwork_router import router as fieldwork_router
from app.api.endpoints.rotation_router import router as rotation_router
from app.api.endpoints.egn_report_router import router as egn_router
from app.api.endpoints.calculator_router import router as calc_router
from app.api.endpoints.alert_suppression import router as alert_suppression_router
from app.api.endpoints.equipment_router import router as equipment_router
from app.api.endpoints.personnel_router import router as personnel_router


from app.tasks.scheduler import scheduler

# =========================
# Database Initialization
# =========================
Base.metadata.create_all(bind=engine)

# =========================
# App Initialization
# =========================
# Hide interactive API docs / OpenAPI schema in production so the API surface
# and database models are not publicly browsable (toggle via ENABLE_DOCS env var).
app = FastAPI(
    title=config.API_TITLE,
    version=config.API_VERSION,
    docs_url="/docs" if config.ENABLE_DOCS else None,
    redoc_url="/redoc" if config.ENABLE_DOCS else None,
    openapi_url="/openapi.json" if config.ENABLE_DOCS else None,
)

# =========================
# Middleware
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Lifecycle Events
# =========================
@app.on_event("startup")
def start_tasks():
    if not scheduler.running:
        scheduler.start()
        print(f"[INFO] Scheduler started — sync jobs + morning briefing at 07:00 UTC (Seed: {config.RANDOM_SEED})")

@app.on_event("shutdown")
def stop_tasks():
    if scheduler.running:
        scheduler.shutdown()
        print("[INFO] Background scheduler shut down.")

# =========================
# Routers
# =========================

app.include_router(field_router,    prefix="/api/v1",         tags=["Field Analysis"])
app.include_router(data_router,     prefix="/api/v1",         tags=["Data & Visualization"])
app.include_router(auth_router,     prefix="/api/v1/auth",    tags=["Authentication"])
app.include_router(weather_router,  prefix="/api/v1/weather", tags=["Weather"])
app.include_router(sensor_router,   prefix="/api/v1/sensors", tags=["Sensors"])
app.include_router(utils_router,    prefix="/api/v1/utils",   tags=["Utils"])
app.include_router(events_router,   prefix="/api/v1",         tags=["Alerts & Tasks"])
app.include_router(fieldwork_router,prefix="/api/v1",         tags=["Field Work"])
app.include_router(rotation_router, prefix="/api/v1/rotation",tags=["Pasture Rotation"])
app.include_router(egn_router, prefix="/api/v1")
app.include_router(calc_router, prefix="/api/v1")
app.include_router(alert_suppression_router, prefix="/api/v1")
app.include_router(equipment_router, prefix="/api/v1/equipment", tags=["Equipment"])
app.include_router(personnel_router, prefix="/api/v1/personnel", tags=["Personnel"])
# =========================
# Health Check
# =========================
@app.get("/", tags=["Health"])
async def health_check():
    return {
        "status": "online",
        "app": config.API_TITLE,
        "version": config.API_VERSION,
    }