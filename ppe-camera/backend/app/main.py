"""
FastAPI application entrypoint.

Boots the DB on startup, mounts the review API, exposes a health check.
CORS is open to the Next.js dev origin by default; lock it down in prod via
PPE_CORS_ORIGINS (comma-separated).
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.core.db import init_db
from app.routers import alerts, analytics, cameras, models, review, stream, violations


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # hand the running loop to the runtime so camera worker threads can
    # schedule async DB writes for captures
    import asyncio

    from app.services.runtime import set_event_loop

    set_event_loop(asyncio.get_running_loop())

    # Rebuild the fleet from storage. CameraRecord has always carried the
    # docstring "the CameraManager rehydrates these at startup", and
    # upsert_camera/all_cameras were both written, but neither was ever called
    # — so every camera, zone mask and tuned threshold was lost on restart.
    try:
        from app.services.camera_store import restore_fleet
        from app.services.runtime import get_manager

        result = await restore_fleet(get_manager())
        if result.get("failed"):
            import logging
            logging.getLogger(__name__).warning(
                "%d camera(s) could not be restored: %s",
                len(result["failed"]), result["failed"])
    except Exception as exc:  # noqa: BLE001 - never block startup
        import logging
        logging.getLogger(__name__).warning("fleet restore skipped: %s", exc)

    try:
        yield
    finally:
        from app.services.runtime import get_manager

        get_manager().stop_all()


def create_app() -> FastAPI:
    app = FastAPI(title="PPE Detection API", version="0.1.0", lifespan=lifespan)

    origins = os.getenv(
        "PPE_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(review.router)
    app.include_router(cameras.router)
    app.include_router(stream.router)
    app.include_router(models.router)
    app.include_router(analytics.router)
    app.include_router(violations.router)
    app.include_router(alerts.router)

    @app.get("/health")
    async def health() -> dict:
        from app.core.config import get_settings

        s = get_settings()
        return {"status": "ok", "device": s.DEVICE, "db": s.DATABASE_URL.split("://")[0]}

    return app


app = create_app()
