"""
Project Brain — Main FastAPI Application
GOD MODE v2 — uses new schema (scheme_master with scheme_id PK, etc.)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from app.api.v1 import schemes, view_schemes
from app.api.v1 import mobile
from app.api.v1 import risk, notesheet
from app.api.v1 import cpm_v4

# IMPORTANT: We are NOT calling Base.metadata.create_all() anymore.
# The database schema is managed by godmode_v2_schema.sql, not SQLAlchemy.
# This avoids conflicts between old models and the new schema.

app = FastAPI(
    title="Project Brain API",
    description="Intelligent Project Monitoring System (Mini MOS) for Rourkela Steel Plant",
    version="2.0.0 GOD MODE 🧠🚀"
)

# Enable CORS for the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the schemes router
app.include_router(schemes.router, prefix="/api/v1/schemes", tags=["Schemes"])
app.include_router(view_schemes.router, prefix="/api/v1/view-schemes", tags=["View Schemes"])
app.include_router(mobile.router)
app.include_router(risk.router)
app.include_router(notesheet.router)
app.include_router(cpm_v4.router)

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
def root():
    return {
        "message": "Project Brain Backend is Running",
        "version": "2.0.0 GOD MODE",
        "docs": "http://localhost:8000/docs"
    }


@app.get("/health")
def health():
    """Health check endpoint."""
    from app.core.database import engine
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT COUNT(*) FROM scheme_master")).scalar()
        return {"status": "healthy", "scheme_count": result}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
