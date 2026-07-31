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
from app.routers import (alerts, analytics, cameras, modelops, models, nvr,
                         review, stream, training, violations)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # hand the running loop to the runtime so camera worker threads can
    # schedule async DB writes for captures
    import asyncio

    from app.services.runtime import set_event_loop

    set_event_loop(asyncio.get_running_loop())
    boot_task = None

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

    # NVR: re-apply stored recording settings, re-arm the cameras that were
    # recording before the restart, and start the retention sweeper. Without
    # the re-arm a power cut disarms the whole site silently — streams come
    # back, the dashboard looks healthy, and nothing is being recorded.
    try:
        from app.routers.nvr import load_config, restore_camera_modes
        from app.services.recorder import get_recorder

        await load_config()
        armed = await restore_camera_modes()
        get_recorder().start_retention()
        if armed:
            print(f"[ppe] recording re-armed on {len(armed)} camera(s)")
    except Exception as exc:  # noqa: BLE001 - recording must not block boot
        import logging
        logging.getLogger(__name__).warning("nvr startup skipped: %s", exc)

    boot_model_key = os.getenv("PPE_BOOT_MODEL_KEY", "").strip()
    if boot_model_key:
        async def _boot_model() -> None:
            from app.ml import model_zoo

            try:
                await asyncio.to_thread(model_zoo.select, boot_model_key)
                print(f"[ppe] boot model active: {boot_model_key}")
            except Exception as e:
                print(f"[ppe] boot model failed ({boot_model_key}): {e}")

        boot_task = asyncio.create_task(_boot_model())
    try:
        yield
    finally:
        if boot_task is not None and not boot_task.done():
            boot_task.cancel()
        from app.services.runtime import get_manager

        get_manager().stop_all()
        # Flush open clips last: a segment killed mid-write is an unplayable
        # file, and the recorder threads outlive the camera workers feeding them.
        try:
            from app.services.recorder import get_recorder

            get_recorder().stop_all()
        except Exception:
            pass


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
    app.include_router(training.router)
    app.include_router(nvr.router)
    app.include_router(modelops.router)

    @app.get("/health")
    async def health() -> dict:
        """Industrial health: device, fleet, active model, recorder armed count."""
        from app.core.config import get_settings

        s = get_settings()
        out: dict = {
            "status": "ok",
            "device": s.DEVICE,
            "db": s.DATABASE_URL.split("://")[0],
            "version": app.version,
        }
        try:
            from app.services.runtime import get_manager

            snapshots = get_manager().list_status() or []
            running = sum(
                1 for c in snapshots
                if (c.get("state") if isinstance(c, dict) else None) == "running"
            )
            out["fleet"] = {"total": len(snapshots), "running": running}
        except Exception as exc:  # noqa: BLE001
            out["fleet"] = {"error": str(exc)}

        try:
            from app.routers.models import _load
            from app.ml.detector import get_detector

            reg = _load()
            active_ver = reg.get("active")
            zoo_key = None
            for v in reg.get("versions") or []:
                if v.get("version") == active_ver:
                    zoo_key = v.get("zoo_key") or v.get("note")
                    break
            out["active_model"] = zoo_key
            out["active_version"] = active_ver
            try:
                out["live_weights"] = get_detector().active_weights
            except Exception:
                out["live_weights"] = None
        except Exception:
            out["active_model"] = None

        try:
            from app.services.recorder import get_recorder

            st = get_recorder().status() or []
            armed = sum(
                1
                for c in st
                if isinstance(c, dict)
                and c.get("mode") not in (None, "off")
            )
            recording = sum(1 for c in st if isinstance(c, dict) and c.get("recording"))
            out["recording_armed"] = armed
            out["recording_active"] = recording
        except Exception:
            out["recording_armed"] = None

        return out

    return app


app = create_app()
