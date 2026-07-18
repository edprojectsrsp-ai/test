import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


def _cors_origins() -> list[str]:
    """Sprint 0 — CORS lockdown via env (comma-separated)."""
    raw = (
        os.environ.get("CORS_ORIGINS")
        or os.environ.get("PB_CORS_ORIGINS")
        or "http://localhost:3000,http://127.0.0.1:3000"
    )
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    # always allow local frontend ports used in this monorepo
    for extra in ("http://localhost:3000", "http://127.0.0.1:3000",
                  "http://localhost:3001", "http://127.0.0.1:3001"):
        if extra not in origins:
            origins.append(extra)
    return origins


def _upload_dir() -> str:
    """Durable upload path (not only /tmp). Overridable via UPLOAD_DIR."""
    if os.environ.get("UPLOAD_DIR"):
        return os.environ["UPLOAD_DIR"]
    # Prefer project-local uploads next to backend for portability on Windows/Linux
    local = Path(__file__).resolve().parents[1] / "uploads"
    return str(local)
from app.api.v1.auth import router as auth_router
from app.api.v1.brain import router as brain_router
from app.api.v1.capex import router as capex_router
from app.api.v1.flow_endpoints import router as flow_router
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
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.dashboard_command import router as dashboard_command_router
from app.api.v1.admin_rbac import router as admin_rbac_router
from app.api.v1.billing_schedule import router as billing_router
from app.api.v1.mos_reports import router as mos_reports_router
from app.api.v1.progress_board import router as progress_board_router
from app.api.v1.delay import router as delay_router
from app.api.v1.dpr_ingest import router as dpr_ingest_router
from app.api.v1.bim import router as bim_router
from app.api.v1.report_studio import router as report_studio_router
from app.api.v1.evm import router as evm_router
from app.api.v1.cpm_delay import router as cpm_delay_router
from app.api.v1.report_templates import router as report_templates_router
from app.api.v1 import report_docs
from app.api.v1.exports import router as exports_router
from report_brain.api import router as report_brain_router

SCHEDULING_ROOT = Path(__file__).resolve().parents[2] / "_scheduling_module"
if SCHEDULING_ROOT.exists() and str(SCHEDULING_ROOT) not in sys.path:
    sys.path.insert(0, str(SCHEDULING_ROOT))

try:
    from scheduling_module.app.api.routes import router as scheduling_router
except Exception:
    scheduling_router = None

app = FastAPI(title="Project Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

app.include_router(auth_router)
app.include_router(schemes_router, prefix="/api/v1/schemes")
app.include_router(capex_router, prefix="/api/v1")

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
app.include_router(cpm_router, prefix="/api/v1", tags=["CPM"])
app.include_router(appendix2_router, prefix="/api/v1/appendix2", tags=["Appendix-2"])
app.include_router(plan_seed_router, prefix="/api/v1")
app.include_router(notesheet_router, prefix="/api/v1")
app.include_router(mobile_router, prefix="/api/v1")
app.include_router(risk_router, prefix="/api/v1")
app.include_router(plant_amr_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1/dashboard", tags=["Dashboard"])
app.include_router(dashboard_command_router, prefix="/api/v1", tags=["Dashboard Command"])
app.include_router(admin_rbac_router, prefix="/api/v1", tags=["Admin RBAC"])
app.include_router(billing_router, prefix="/api/v1", tags=["Billing Schedule"])
app.include_router(mos_reports_router, prefix="/api/v1", tags=["MoS Reports"])
app.include_router(progress_board_router, prefix="/api/v1", tags=["Progress Board"])
app.include_router(delay_router, prefix="/api/v1", tags=["Delay Analysis"])
app.include_router(dpr_ingest_router, prefix="/api/v1", tags=["DPR Ingest"])
app.include_router(bim_router, prefix="/api/v1", tags=["4D BIM"])
app.include_router(report_studio_router, prefix="/api/v1", tags=["Report Studio"])
app.include_router(evm_router, prefix="/api/v1", tags=["EVM"])
app.include_router(cpm_delay_router, prefix="/api/v1", tags=["CPM Delay Analysis"])
app.include_router(report_templates_router, prefix="/api/v1", tags=["Report Templates"])
app.include_router(report_docs.router, prefix="/api/v1/report-docs", tags=["Report Documents"])
app.include_router(exports_router, prefix="/api/v1", tags=["Exports"])
app.include_router(report_brain_router, prefix="/api/v1", tags=["Report Brain"])
app.include_router(flow_router, prefix="/api/v1", tags=["DPR Flow"])
if scheduling_router is not None:
    app.include_router(scheduling_router)

UPLOAD_DIR = _upload_dir()
os.makedirs(UPLOAD_DIR, exist_ok=True)
# Backup sibling folder for periodic copies (Sprint 0 hardening).
UPLOAD_BACKUP_DIR = os.environ.get(
    "UPLOAD_BACKUP_DIR",
    str(Path(UPLOAD_DIR).resolve().parent / "uploads_backup"),
)
os.makedirs(UPLOAD_BACKUP_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
def read_root():
    return {
        "message": "Project Brain API is running 🧠",
        "auth_enforce": os.environ.get("PB_AUTH_ENFORCE", "1"),
        "upload_dir": UPLOAD_DIR,
    }


@app.get("/api/health")
def api_health():
    return {
        "status": "ok",
        "service": "project-brain-backend",
        "auth_enforce": (os.environ.get("PB_AUTH_ENFORCE", "1").strip().lower()
                         not in ("0", "false", "no", "off")),
        "cors_origins": _cors_origins(),
        "upload_dir": UPLOAD_DIR,
        "upload_backup_dir": UPLOAD_BACKUP_DIR,
    }


from fastapi import Depends as _Depends  # noqa: E402
from app.security.auth import require_user as _require_user  # noqa: E402


@app.post("/api/v1/ops/backup-uploads")
def backup_uploads_secured(user: dict = _Depends(_require_user)):
    """Copy UPLOAD_DIR → UPLOAD_BACKUP_DIR (timestamped). Auth required."""
    import shutil
    from datetime import datetime

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = Path(UPLOAD_BACKUP_DIR) / f"uploads-{stamp}"
    if not Path(UPLOAD_DIR).exists():
        return {"ok": False, "detail": f"UPLOAD_DIR missing: {UPLOAD_DIR}"}
    shutil.copytree(UPLOAD_DIR, dest, dirs_exist_ok=True)
    return {
        "ok": True,
        "src": UPLOAD_DIR,
        "dest": str(dest),
        "by": user.get("username") or user.get("user_id"),
    }


@app.get("/api/scheduling/health")
def scheduling_health():
    if scheduling_router is None:
        return {"status": "unavailable", "module": "scheduling"}
    return {"status": "ok", "module": "scheduling"}
