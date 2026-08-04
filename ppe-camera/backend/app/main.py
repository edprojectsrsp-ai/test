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

from app.core.config import get_settings
from app.core.db import init_db

# NOTE: routers are imported inside create_app(), not here. In the "cloud" role
# torch/ultralytics/opencv are not installed at all, and a module-level import
# of app.routers.stream would pull them in transitively and crash on boot.


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # The cloud role is a dashboard and a sync receiver. It has no cameras, no
    # detector, no recorder and no local disk worth keeping — every block below
    # is edge-only, and running any of it on a 512 MB instance is what put the
    # service out of memory in the first place.
    if get_settings().is_cloud:
        try:
            from app.routers.ingest import seed_agents

            await seed_agents()
        except Exception as exc:  # noqa: BLE001 - never block boot
            import logging
            logging.getLogger(__name__).warning("agent seeding skipped: %s", exc)
        yield
        return

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

    # Opt-in only (PPE_AUTO_SYNC). Off by default: pushing plant surveillance
    # data to a public cloud is a decision an operator makes, not a default.
    try:
        from app.services.push_service import start_auto_sync

        start_auto_sync()
    except Exception as exc:  # noqa: BLE001 - sync must never block boot
        import logging
        logging.getLogger(__name__).warning("auto-sync not started: %s", exc)

    try:
        yield
    finally:
        try:
            from app.services.push_service import stop_auto_sync

            stop_auto_sync()
        except Exception:
            pass
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
    settings = get_settings()
    role = settings.ROLE
    app = FastAPI(title=f"PPE Detection API ({role})", version="0.2.0",
                  lifespan=lifespan)

    origins = os.getenv(
        "PPE_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    # A wall TV reaches the console at http://192.168.x.x:3000, and that IP is
    # not knowable at install time on a DHCP network — so LAN deployments match
    # by pattern instead of by list. Access is still gated by PPE_LAN_TOKEN;
    # CORS decides which page may ask, not who is allowed in.
    origin_regex = os.getenv("PPE_CORS_ORIGIN_REGEX", "").strip() or None
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins if o.strip()],
        allow_origin_regex=origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if settings.is_edge:
        # Chrome's Private Network Access check. The control-room page is served
        # from Vercel over HTTPS but talks to this agent on http://127.0.0.1, so
        # Chrome sends a preflight carrying Access-Control-Request-Private-Network
        # and drops the request unless the reply grants it. CORSMiddleware knows
        # nothing about this header, so every camera and live-view call fails with
        # an opaque CORS error that looks like the agent is down.
        from starlette.middleware.base import BaseHTTPMiddleware

        class _PrivateNetworkMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request, call_next):
                response = await call_next(request)
                if request.headers.get("access-control-request-private-network"):
                    response.headers["Access-Control-Allow-Private-Network"] = "true"
                return response

        app.add_middleware(_PrivateNetworkMiddleware)

        if settings.LAN_TOKEN:
            # Gate everything except /health and CORS preflight. Loopback is
            # exempt: the operator sitting at this PC already has the machine,
            # and requiring a key there would break the desktop console for no
            # gain. This guards the LAN surface — the wall TVs and phones.
            import hmac as _hmac

            from starlette.middleware.base import BaseHTTPMiddleware
            from starlette.responses import JSONResponse

            _OPEN_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

            class _LanTokenMiddleware(BaseHTTPMiddleware):
                async def dispatch(self, request, call_next):
                    if request.method == "OPTIONS" or request.url.path in _OPEN_PATHS:
                        return await call_next(request)
                    client = (request.client.host if request.client else "") or ""
                    if client in ("127.0.0.1", "::1", "localhost"):
                        return await call_next(request)
                    # Header for fetch/XHR, query param for <img src> MJPEG —
                    # an image tag cannot send headers. Named ppe_key, not k:
                    # the stream URLs already use ?k= as a cache-buster.
                    supplied = (request.headers.get("x-ppe-key")
                                or request.query_params.get("ppe_key") or "")
                    if not _hmac.compare_digest(supplied, settings.LAN_TOKEN):
                        return JSONResponse(
                            {"detail": "missing or invalid PPE LAN key"},
                            status_code=401)
                    return await call_next(request)

            app.add_middleware(_LanTokenMiddleware)

    if settings.is_cloud:
        # Dashboard + receiver only. Deliberately NOT mounted: cameras, stream,
        # models, training, nvr, modelops, review, alerts -- all of them reach
        # for the detector, the recorder or the local filesystem, none of which
        # exist here.
        from app.routers import analytics, ingest, violations

        app.include_router(violations.router)
        app.include_router(analytics.router)
        app.include_router(ingest.router)
    else:
        from app.routers import (alerts, analytics, cameras, modelops, models,
                                 nvr, push, review, stream, training,
                                 violations)

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
        app.include_router(push.router)

    @app.get("/health")
    async def health() -> dict:
        """Industrial health: device, fleet, active model, recorder armed count."""
        from app.core.config import get_settings

        s = get_settings()
        out: dict = {
            "status": "ok",
            "role": s.ROLE,
            "device": s.DEVICE,
            "db": s.DATABASE_URL.split("://")[0],
            "version": app.version,
        }
        if s.is_cloud:
            # Nothing below applies: no fleet, no detector, no recorder. Probing
            # for them would import the ML stack this role exists to avoid.
            warnings: list[str] = []
            if s.DATABASE_URL.startswith("sqlite"):
                warnings.append(
                    "cloud role is using SQLite; free Render web services wipe "
                    "local files on restart/deploy, so PPE_DATABASE_URL should "
                    "point at Postgres"
                )
            if not s.SYNC_AGENTS:
                warnings.append(
                    "PPE_SYNC_AGENTS is empty; no plant PC can authenticate to "
                    "push violations"
                )
            out["sync_agents_configured"] = bool(s.SYNC_AGENTS)
            if warnings:
                out["warnings"] = warnings
            return out
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
