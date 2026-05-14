from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.auth import router as auth_router
from app.api.v1.brain import router as brain_router
from app.api.v1.capex import router as capex_router
from app.api.v1.corporate_progress import router as corporate_progress_router
from app.api.v1.cpm import router as cpm_router
from app.api.v1.dpr import router as dpr_router
from app.api.v1.god_api import router as god_router
from app.api.v1.material import router as material_router
from app.api.v1.physical_progress import router as physical_progress_router
from app.api.v1.plant_progress import router as plant_progress_router
from app.api.v1.progress import router as progress_router
from app.api.v1.reports import router as reports_router
from app.api.v1.schemes import router as schemes_router
from app.api.v1.upload import router as upload_router
from app.api.v1.s_curve import router as s_curve_router
from app.api.v1.view_schemes import router as view_schemes_router
from app.api.v1.plan_engine import router as plan_engine_router
from app.models import capex
from app.models import cpm
from app.models import dpr
from app.models import god_models
from app.models import material
from app.models import progress
from app.models import scheme
from app.models import user

app = FastAPI(title="Project Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Security"])
app.include_router(schemes_router, prefix="/api/v1/schemes")
app.include_router(capex_router)
app.include_router(capex_router, prefix="/api/v1")
app.include_router(progress_router, prefix="/api/v1")
app.include_router(cpm_router, prefix="/api/v1")
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
app.include_router(god_router, prefix="/api/v1", tags=["GOD MODE"])


@app.get("/")
def read_root():
    return {"message": "Project Brain API is running 🧠"}
