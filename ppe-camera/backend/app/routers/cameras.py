"""
Camera management HTTP API.

  POST   /api/cameras              -> register a camera (rtsp|webcam|screen|video|onvif|fake)
  POST   /api/cameras/upload-video -> upload a clip and run it as a DEMO camera
  POST   /api/cameras/{id}/start   -> start its worker
  POST   /api/cameras/{id}/stop    -> stop its worker
  DELETE /api/cameras/{id}         -> stop + remove
  GET    /api/cameras              -> status of all cameras
  GET    /api/cameras/{id}         -> status of one

The manager is created once at app startup with the real detector and the
real capture sink wired in. This is the seam where the injected test doubles
are replaced by production implementations.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services.camera_manager import CameraConfig

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraIn(BaseModel):
    camera_id: str = Field(..., pattern=r"^[A-Za-z0-9._-]+$")
    source_kind: str = Field(..., pattern=r"^(rtsp|webcam|screen|video|onvif|fake)$")
    source_kwargs: dict = Field(default_factory=dict)
    required_ppe: list[str] = Field(default_factory=lambda: ["helmet", "vest"])
    fps_limit: float = 6.0
    restricted_zones: list = Field(default_factory=list)
    hazards_enabled: bool = True


def _manager():
    # imported here so the app wires the singleton at startup (see main.py)
    from app.services.runtime import get_manager

    return get_manager()


@router.get("/meta/ppe-catalog")
async def ppe_catalog() -> dict:
    """Full PPE dataset catalog for the config UI (register before /{id})."""
    from app.ml.taxonomy import PPE_CATALOG, GEAR_PAIRS, DISPLAY_NAMES, CANONICAL_CLASSES
    return {
        "catalog": PPE_CATALOG,
        "gear_pairs": GEAR_PAIRS,
        "display_names": DISPLAY_NAMES,
        "canonical_classes": CANONICAL_CLASSES,
        "defaults": [c["id"] for c in PPE_CATALOG if c.get("default")],
        "stock_model_note": (
            "Snehil & VoxDroid pretrained weights detect Cap, Safety Jacket, Mask, "
            "Person, Safety Cone, Vehicle. Other gear needs a fine-tuned .pt."
        ),
    }


@router.get("/meta/brands")
async def camera_brands() -> dict:
    """CCTV brand list + RTSP defaults for the comprehensive connect UI."""
    from app.services.camera_connect import brand_catalog
    return {
        "brands": brand_catalog(),
        "source_kinds": ["rtsp", "onvif", "webcam", "screen", "video", "fake"],
        "streams": [
            {"id": "main", "label": "Main (high-res)"},
            {"id": "sub", "label": "Sub (low-res, lighter on CPU)"},
        ],
    }


class RtspUrlIn(BaseModel):
    brand: str = "generic"
    host: str
    username: str = ""
    password: str = ""
    port: int | None = None
    channel: int = 1
    stream: str = "main"          # main | sub
    path: str = ""                # only for brand=generic


@router.post("/rtsp-url")
async def rtsp_url(payload: RtspUrlIn) -> dict:
    """Compose the correct RTSP URL for a brand from host/credentials/channel."""
    from app.services.camera_connect import build_rtsp_url
    try:
        return build_rtsp_url(
            brand=payload.brand, host=payload.host,
            username=payload.username, password=payload.password,
            port=payload.port, channel=payload.channel,
            stream=payload.stream, path=payload.path,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


class ProbeIn(BaseModel):
    source_kind: str = Field(..., pattern=r"^(rtsp|webcam|screen|video|onvif|fake)$")
    source_kwargs: dict = Field(default_factory=dict)
    timeout: float = 8.0


@router.post("/test")
async def test_source(payload: ProbeIn) -> dict:
    """Open a source, grab one frame, report resolution + latency (test-before-add)."""
    import anyio

    from app.services.camera_connect import probe_source
    timeout = max(1.0, min(20.0, float(payload.timeout or 8.0)))
    # run the blocking probe off the event loop so the API stays responsive
    return await anyio.to_thread.run_sync(
        lambda: probe_source(payload.source_kind, payload.source_kwargs, timeout=timeout)
    )


@router.get("/discover")
async def discover(timeout: float = 4.0) -> dict:
    """WS-Discovery sweep for ONVIF cameras on the LAN."""
    import anyio

    from app.services.camera_connect import discover_onvif
    t = max(1.0, min(10.0, float(timeout or 4.0)))
    return await anyio.to_thread.run_sync(lambda: discover_onvif(timeout=t))


@router.post("")
async def add_camera(payload: CameraIn) -> dict:
    cfg = CameraConfig(
        camera_id=payload.camera_id,
        source_kind=payload.source_kind,
        source_kwargs=payload.source_kwargs,
        required_ppe=set(payload.required_ppe),
        fps_limit=payload.fps_limit,
        restricted_zones=payload.restricted_zones,
        hazards_enabled=payload.hazards_enabled,
    )
    try:
        _manager().add(cfg)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _manager().status(payload.camera_id)


# playback speed -> real-time multiplier (see VideoFileSource pacing)
_SPEED_MULT = {"slow": 0.5, "normal": 1.0, "fast": 2.0}


@router.post("/upload-video")
async def upload_video(
    file: UploadFile = File(...),
    camera_id: str = Form("demo"),
    loop: bool = Form(True),
    required_ppe: str = Form("helmet,vest"),
    speed: str = Form("normal"),   # slow | normal | fast
    autostart: bool = Form(True),
) -> dict:
    """Upload a video clip and run the FULL pipeline over it as a demo camera.

    Great for demos with no camera/RTSP: the uploaded file becomes a `video`
    source; detections, violations, hazards, alerts and active-learning
    captures all flow exactly as they would from a live feed.
    """
    if not re.match(r"^[A-Za-z0-9._-]+$", camera_id):
        raise HTTPException(422, "camera_id must be alphanumeric/._-")
    settings = get_settings()
    uploads = settings.DATA_DIR / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename or "clip.mp4")
    dest = uploads / f"{camera_id}__{safe_name}"
    with open(dest, "wb") as f:
        f.write(await file.read())

    ppe = [p.strip() for p in required_ppe.split(",") if p.strip()]
    mult = _SPEED_MULT.get(speed.lower(), 1.0)
    cfg = CameraConfig(
        camera_id=camera_id,
        source_kind="video",
        source_kwargs={"path": str(dest), "loop": bool(loop), "speed": mult},
        required_ppe=set(ppe),
    )
    try:
        _manager().add(cfg)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if autostart:
        _manager().start(camera_id)
    status = _manager().status(camera_id)
    status["uploaded_file"] = str(dest)
    return status


@router.post("/{camera_id}/start")
async def start_camera(camera_id: str) -> dict:
    try:
        _manager().start(camera_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _manager().status(camera_id)


@router.post("/{camera_id}/stop")
async def stop_camera(camera_id: str) -> dict:
    try:
        _manager().stop(camera_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _manager().status(camera_id)


@router.delete("/{camera_id}")
async def remove_camera(camera_id: str) -> dict:
    try:
        _manager().remove(camera_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"removed": camera_id}


@router.get("")
async def list_cameras() -> list[dict]:
    return _manager().list_status()


@router.get("/{camera_id}")
async def get_camera(camera_id: str) -> dict:
    try:
        return _manager().status(camera_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


class RequiredPpeIn(BaseModel):
    required_ppe: list[str] = Field(..., min_length=1)


@router.post("/{camera_id}/required-ppe")
async def set_required_ppe(camera_id: str, payload: RequiredPpeIn) -> dict:
    """Configure which PPE items are mandatory for this camera (live + alerts)."""
    try:
        items = _manager().set_required_ppe(camera_id, payload.required_ppe)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    st = _manager().status(camera_id)
    st["required_ppe"] = items
    return st

