"""
Camera config persistence.

`CameraRecord` carried the docstring "The CameraManager rehydrates these at
startup so cameras no longer vanish on restart", and `upsert_camera` and
`all_cameras` were both written — but neither was ever called from anywhere in
the codebase. So the claim was untrue: adding twenty cameras and restarting the
service lost all twenty, along with every zone mask and every tuned threshold.

This module is the missing half. It saves a camera whenever its configuration
changes and restores the fleet on startup.

Two deliberate properties:

  * **Saving never breaks a camera.** A database error while persisting a zone
    edit must not take a running camera off the air — the edit is already
    applied in memory and the stream is more important than the record of it.
    Failures are logged and swallowed.

  * **Restoring is per camera, not all-or-nothing.** One corrupt row must not
    prevent the other nineteen cameras from coming back. A camera that cannot
    be rebuilt is skipped and reported, not allowed to abort the boot.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


def config_to_row(config) -> dict[str, Any]:
    """Fields of a CameraConfig that belong in the database."""
    return {
        "source_kind": config.source_kind,
        "source_kwargs": dict(config.source_kwargs or {}),
        "required_ppe": sorted(config.required_ppe or []),
        "zones": list(config.restricted_zones or []),
        "monitoring_zones": list(config.monitoring_zones or []),
        "fps_limit": float(config.fps_limit or 0.0),
        "priority": getattr(config, "priority", "normal"),
        "pose_enabled": bool(getattr(config, "pose_enabled", False)),
        "calibration": dict(getattr(config, "calibration", None) or {}),
    }


def row_to_config(row) -> "CameraConfig":
    """Rebuild a CameraConfig from a stored row."""
    from app.services.camera_manager import CameraConfig

    return CameraConfig(
        camera_id=row.id,
        source_kind=row.source_kind or "rtsp",
        source_kwargs=dict(row.source_kwargs or {}),
        required_ppe=set(row.required_ppe or []) or {"helmet", "vest"},
        restricted_zones=list(row.zones or []),
        monitoring_zones=list(getattr(row, "monitoring_zones", None) or []),
        fps_limit=float(row.fps_limit or 6.0),
        priority=getattr(row, "priority", None) or "normal",
        pose_enabled=bool(getattr(row, "pose_enabled", False)),
        calibration=dict(getattr(row, "calibration", None) or {}),
    )


async def save_camera(camera_id: str, config, detection_rule: dict | None = None,
                      mode: str | None = None) -> bool:
    """Persist one camera's configuration. Returns True if it was written.

    Never raises: an operator who has just masked a public road cares that the
    mask is live, and losing the durable copy is a lesser failure than dropping
    the camera because the write failed.
    """
    try:
        from app.core.db import SessionLocal
        from app.services.persistence import get_persistence_service

        fields = config_to_row(config)
        if detection_rule is not None:
            fields["detection_rule"] = dict(detection_rule)
        if mode is not None:
            fields["mode"] = mode
        async with SessionLocal() as session:
            await get_persistence_service().upsert_camera(session, camera_id, **fields)
        return True
    except Exception as exc:  # noqa: BLE001 - persistence must not break capture
        log.warning("could not persist camera %s: %s", camera_id, exc)
        return False


def save_camera_sync(camera_id: str, config, detection_rule: dict | None = None,
                     mode: str | None = None) -> None:
    """Schedule a save from a synchronous caller (the HTTP handlers and the
    camera worker threads are not all async)."""
    try:
        from app.services import runtime

        loop = getattr(runtime, "_loop", None)
        if loop is None or loop.is_closed():
            return  # no running loop yet (startup, or a unit test)
        import asyncio

        asyncio.run_coroutine_threadsafe(
            save_camera(camera_id, config, detection_rule, mode), loop)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not schedule save for camera %s: %s", camera_id, exc)


async def delete_camera(camera_id: str) -> bool:
    """Hard-delete a camera from durable storage. Never raises."""
    try:
        from app.core.db import SessionLocal
        from app.services.persistence import get_persistence_service

        async with SessionLocal() as session:
            return await get_persistence_service().delete_camera(session, camera_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not delete stored camera %s: %s", camera_id, exc)
        return False


async def disable_camera(camera_id: str) -> bool:
    """Soft-remove: leave the row, mark disabled. Never raises."""
    try:
        from app.core.db import SessionLocal
        from app.services.persistence import get_persistence_service

        async with SessionLocal() as session:
            return await get_persistence_service().disable_camera(session, camera_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not disable stored camera %s: %s", camera_id, exc)
        return False


async def restore_fleet(manager) -> dict:
    """Rebuild every enabled camera from the database at startup.

    Restores per camera rather than in one transaction: one unparseable row
    must not stop the other nineteen cameras coming back after a power cut.
    """
    restored, failed = [], []
    try:
        from app.core.db import SessionLocal
        from app.services.persistence import get_persistence_service

        async with SessionLocal() as session:
            rows = await get_persistence_service().all_cameras(session)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not read stored cameras: %s", exc)
        return {"restored": [], "failed": [], "error": str(exc)}

    for row in rows:
        try:
            config = row_to_config(row)
            worker = manager.add(config)
            rule = dict(getattr(row, "detection_rule", None) or {})
            if rule:
                worker.set_detection_rule(rule)
            if getattr(row, "mode", None):
                try:
                    worker.set_mode(row.mode)
                except Exception:
                    pass  # an unknown stored mode should not block the camera
            worker.start()
            restored.append(row.id)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not restore camera %s: %s", row.id, exc)
            failed.append({"camera_id": row.id, "error": str(exc)})

    if restored:
        log.info("restored %d camera(s) from storage: %s",
                 len(restored), ", ".join(restored))
    return {"restored": restored, "failed": failed}
