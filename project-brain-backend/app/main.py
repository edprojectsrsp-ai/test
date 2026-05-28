import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.v1.auth import router as auth_router
from app.api.v1.brain import router as brain_router
from app.api.v1.capex import router as capex_router
from app.api.v1.corporate_progress import router as corporate_progress_router
from app.api.v1.cpm import router as cpm_router
from app.api.v1.dpr import router as dpr_router
from app.api.v1.material import router as material_router
from app.api.v1.physical_progress import router as physical_progress_router
from app.api.v1.plant_progress import router as plant_progress_router
from app.api.v1.progress import router as progress_router
from app.api.v1.mobile import router as mobile_router
from app.api.v1.risk import router as risk_router
from app.api.v1.reports import router as reports_router
from app.api.v1.schemes import router as schemes_router
from app.api.v1.upload import router as upload_router
from app.api.v1.s_curve import router as s_curve_router
from app.api.v1.view_schemes import router as view_schemes_router
from app.api.v1.plan_engine import router as plan_engine_router
from app.api.v1.notesheet import router as notesheet_router
from app.api.v1.plan_seed import router as plan_seed_router
from app.api.v1.plant_amr import router as plant_amr_router
from app.api.v1.appendix2 import router as appendix2_router

load_dotenv()

app = FastAPI(title="Project Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.136.169:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sprint 9 auth router already uses prefix="/api/v1/auth"
app.include_router(auth_router)
app.include_router(schemes_router, prefix="/api/v1/schemes")
app.include_router(capex_router, prefix="/api/v1")

# Deprecation alias — old buggy endpoint that duplicated plans on save.
# Returns HTTP 410 so any client still calling it fails loudly.
from fastapi import APIRouter as _APIRouter, HTTPException as _HTTPException
_capex_deprecation_router = _APIRouter()


@_capex_deprecation_router.post("/api/v1/plan/save_hierarchy", deprecated=True)
@_capex_deprecation_router.post("/plan/save_hierarchy", deprecated=True)
def _deprecated_old_capex_save_hierarchy():
    raise _HTTPException(
        status_code=410,
        detail=(
            "/plan/save_hierarchy was removed in Sprint 15 because it created a "
            "duplicate plan on every save. Use POST /api/v1/capex/plans (create) "
            "or PUT /api/v1/capex/plans/{plan_id} (update) instead."
        ),
    )


app.include_router(_capex_deprecation_router)
app.include_router(progress_router, prefix="/api/v1")
app.include_router(dpr_router, prefix="/api/v1")
app.include_router(material_router, prefix="/api/v1")
app.include_router(plant_progress_router, prefix="/api/v1/plant", tags=["Plant Progress"])
app.include_router(physical_progress_router, prefix="/api/v1/progress")
app.include_router(corporate_progress_router, prefix="/api/v1/progress")
app.include_router(brain_router, prefix="/api/v1")
app.include_router(upload_router, prefix="/api/v1")
app.include_router(view_schemes_router, prefix="/api/v1/view", tags=["View Schemes"])
app.include_router(reports_router, prefix="/api/v1/reports", tags=["Reports"])
app.include_router(s_curve_router, prefix="/api/v1/s-curve", tags=["S-Curve"])
app.include_router(plan_engine_router, prefix="/api/v1/plan-engine", tags=["Plan Engine"])
# Appendix-2 (Chunk 4 backend half)
app.include_router(appendix2_router, prefix="/api/v1/appendix2", tags=["Appendix-2"])
# Sprint 16: Seed activities + FY cumulative (additive)
app.include_router(plan_seed_router, prefix="/api/v1")
# Notesheet (Sprint 9A)
app.include_router(notesheet_router, prefix="/api/v1")
# Legacy GOD MODE API removed to avoid duplicate model/schema definitions.
app.include_router(mobile_router, prefix="/api/v1")
app.include_router(risk_router, prefix="/api/v1")
# Sprint 17: Plant AMR dashboard (additive)
app.include_router(plant_amr_router, prefix="/api/v1")

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/project_brain/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
def read_root():
    return {"message": "Project Brain API is running 🧠"}
