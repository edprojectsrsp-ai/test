"""
PROJECT BRAIN AI SERVICE
Standalone FastAPI on port 8001.

Run:
    uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
"""
import logging
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers.chat_router import router as chat_router
from app.routers.diagnostics_router import router as diagnostics_router

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Project Brain AI Service",
    description="Multi-provider LLM router + RAG for Rourkela Steel Plant project monitoring",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(diagnostics_router)   # /ai/diagnostics


@app.get("/")
def root():
    return {
        "service": "project-brain-ai",
        "version": "1.1.0",
        "docs": "/docs",
        "endpoints": [
            "POST /ai/conversations/start",
            "POST /ai/chat",
            "POST /ai/chat/stream",
            "GET  /ai/conversations",
            "GET  /ai/conversations/{id}/messages",
            "POST /ai/documents/upload",
            "GET  /ai/documents/{id}/status",
            "GET  /ai/health",
            "GET  /ai/providers",
            "GET  /ai/diagnostics",
        ],
    }


@app.on_event("startup")
async def startup():
    from app.providers.router import get_router
    r = get_router()
    logger.info(f"AI service starting. Providers available: {r.get_available()}")
    db_url = os.environ.get("PROJECT_BRAIN_DB_URL", "<not set>")
    logger.info(f"DB URL: {db_url.split('@')[-1] if '@' in db_url else db_url}")
