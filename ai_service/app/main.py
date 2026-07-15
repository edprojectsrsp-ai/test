"""
PROJECT BRAIN AI SERVICE
Standalone FastAPI on port 8002.

Run:
    uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
"""
import logging
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers.chat_router import list_providers, router as chat_router
from app.routers.diagnostics_router import router as diagnostics_router
from app.api.v1 import ai_settings

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Project Brain AI Service",
    description="Multi-provider LLM router + RAG for Rourkela Steel Plant project monitoring",
    version="1.0.0",
)

def _cors_origins() -> list[str]:
    raw = (
        os.environ.get("CORS_ORIGINS")
        or os.environ.get("PB_CORS_ORIGINS")
        or "http://localhost:3000,http://127.0.0.1:3000"
    )
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    for extra in ("http://localhost:3000", "http://127.0.0.1:3000",
                  "http://localhost:3001", "http://127.0.0.1:3001"):
        if extra not in origins:
            origins.append(extra)
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

from fastapi import Depends  # noqa: E402
from app.security_auth import require_user  # noqa: E402

# Sprint 0 — gate AI chat / graph / ingest behind JWT (same secret as main API).
_ai_deps = [Depends(require_user)]

app.include_router(chat_router, dependencies=_ai_deps)
app.include_router(diagnostics_router)  # health/diagnostics stay open for ops

from app.routers.graph_router import router as graph_router
app.include_router(graph_router, dependencies=_ai_deps)

# Document Vault: upload/list/label/download ingestion API (ingest_v2).
try:
    from app.routers.ingest_router import router as ingest_router
    app.include_router(ingest_router, dependencies=_ai_deps)
except Exception as exc:  # pragma: no cover - optional until migration 031 is applied
    logger.warning("ingest_router not mounted: %s", exc)

app.include_router(
    ai_settings.router,
    prefix="/api/v1/ai-settings",
    tags=["AI Settings"],
    dependencies=_ai_deps,
)

# WhatsApp webhook — called by Meta without a JWT, so it is NOT gated by
# require_user (it is protected by the verify token + Meta's signed requests).
try:
    from app.routers.whatsapp_router import router as whatsapp_router
    app.include_router(whatsapp_router)
except Exception as exc:  # pragma: no cover
    logger.warning("whatsapp_router not mounted: %s", exc)


@app.get("/api/v1/brain/providers")
def brain_provider_alias(user: dict = Depends(require_user)):
    """Compatibility alias for older frontend shells."""
    return list_providers()


@app.get("/")
def root():
    return {
        "service": "project-brain-ai",
        "version": "1.0.0",
        "docs": "/docs",
        "auth_enforce": os.environ.get("PB_AUTH_ENFORCE", "1"),
        "endpoints": [
            "POST /ai/conversations/start",
            "POST /ai/chat",
            "POST /ai/chat/stream",
            "GET  /ai/conversations",
            "GET  /ai/conversations/{id}/messages",
            "POST /ai/documents/upload",
            "GET  /ai/documents/{id}/status",
            "GET  /ai/health",
        ],
    }


@app.get("/ai/health")
def ai_health():
    return {
        "status": "ok",
        "service": "project-brain-ai",
        "auth_enforce": (os.environ.get("PB_AUTH_ENFORCE", "1").strip().lower()
                         not in ("0", "false", "no", "off")),
    }


@app.on_event("startup")
async def startup():
    from app.providers.router import get_router
    r = get_router()
    logger.info(f"AI service starting. Providers available: {r.get_available()}")
    db_url = os.environ.get("PROJECT_BRAIN_DB_URL", "<not set>")
    logger.info(f"DB URL: {db_url.split('@')[-1] if '@' in db_url else db_url}")

    # Auto-start the Telegram assistant poller if a bot token is configured.
    if os.environ.get("TELEGRAM_BOT_TOKEN"):
        import asyncio
        from app.routers.telegram_bot import poll
        app.state.telegram_stop = asyncio.Event()
        app.state.telegram_task = asyncio.create_task(poll(app.state.telegram_stop))
        logger.info("Telegram assistant poller launched.")
    else:
        logger.info("TELEGRAM_BOT_TOKEN not set — Telegram assistant idle.")


@app.on_event("shutdown")
async def shutdown():
    stop = getattr(app.state, "telegram_stop", None)
    if stop:
        stop.set()
