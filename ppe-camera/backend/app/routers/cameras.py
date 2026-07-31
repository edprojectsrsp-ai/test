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


_SOURCE_KIND_RE = (
    r"^(rtsp|webcam|screen|video|onvif|fake|mjpeg|snapshot|hls|folder|browser)$"
)


class CameraIn(BaseModel):
    camera_id: str = Field(..., pattern=r"^[A-Za-z0-9._-]+$")
    source_kind: str = Field(
        ...,
        pattern=_SOURCE_KIND_RE,
    )
    source_kwargs: dict = Field(default_factory=dict)
    required_ppe: list[str] = Field(default_factory=lambda: ["helmet", "vest"])
    fps_limit: float = 6.0
    restricted_zones: list = Field(default_factory=list)
    hazards_enabled: bool = True
    pose_enabled: bool = False


def _manager():
    # imported here so the app wires the singleton at startup (see main.py)
    from app.services.runtime import get_manager

    return get_manager()


class DetectionRuleIn(BaseModel):
    """Per-camera detection tuning. Every field optional — a partial update
    leaves the rest untouched."""
    min_person_px: int | None = None
    min_person_frac: float | None = None
    always_assess_frac: float | None = None
    min_frames: int | None = None
    window_frames: int | None = None
    occlusion_grace_frames: int | None = None
    min_evidence_conf: float | None = None
    require_band: bool | None = None
    cooldown_s: float | None = None
    # When True (default), assessable person + no positive gear = missing PPE.
    # Matches live "Cap / Safety Jacket Not found" overlay for models without
    # explicit no_* classes (e.g. SH17).
    infer_missing_from_absence: bool | None = None
    priority: str | None = None


@router.get("/{camera_id}/detection-rule")
async def get_detection_rule(camera_id: str) -> dict:
    try:
        return _manager().get_detection_rule(camera_id)
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")


@router.put("/{camera_id}/detection-rule")
async def put_detection_rule(camera_id: str, body: DetectionRuleIn) -> dict:
    """Update detection tuning for one camera. Applied live.

    min_person_px is the setting that most affects missed violations: 64 suits
    1080p, but a gantry camera looking down a 200 m yard will gate out most
    workers at that value. It has to be per camera.
    """
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "Empty update")
    if "priority" in patch and patch["priority"] not in (
            "critical", "high", "normal", "low"):
        raise HTTPException(400, "priority must be critical, high, normal or low")
    try:
        return _manager().set_detection_rule(camera_id, patch)
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")


class ZonesIn(BaseModel):
    zones: list = []


@router.get("/{camera_id}/zones")
async def get_zones(camera_id: str) -> dict:
    """Current monitoring zones for a camera."""
    try:
        return _manager().get_zones(camera_id)
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")


@router.put("/{camera_id}/zones")
async def put_zones(camera_id: str, body: ZonesIn) -> dict:
    """Replace a camera's monitoring zones. Applied live, no restart.

    Every zone is validated first and the whole update is rejected on any
    error, rather than silently dropping the bad one — an operator who has just
    drawn a mask over a public road needs to know it did not take effect.
    """
    from app.ml.zones import validate_zone
    problems: list[str] = []
    for i, z in enumerate(body.zones or []):
        if not isinstance(z, dict):
            problems.append(f"zone {i}: not an object")
            continue
        problems += [f"zone {i} ({z.get('name') or 'unnamed'}): {p}"
                     for p in validate_zone(z)]
    if problems:
        raise HTTPException(400, {"errors": problems})
    try:
        return _manager().set_zones(camera_id, body.zones or [])
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")


@router.get("/health")
async def fleet_health() -> dict:
    """Stream health for every camera.

    Reconnects, freezes and availability, not just running/stopped. A camera
    delivering a frozen picture used to report healthy while its counters
    climbed, which is the failure most likely to go unnoticed.
    """
    from app.services.inference_budget import get_budget

    out = _manager().list_health()
    degraded = sum(1 for c in out
                   if c["health"] not in ("healthy", "starting", "stopped"))
    budget = get_budget()
    for cam in out:
        cam["inference"] = budget.camera_stats(cam["camera_id"])
    return {
        "cameras": out,
        "total": len(out),
        "degraded": degraded,
        "fleet_availability": (
            round(sum(c["availability"] or 0 for c in out) / len(out), 4)
            if out else None),
        # Whether the detector can actually keep up with the fleet. Without
        # this, an oversubscribed system looks healthy and simply lags.
        "inference": budget.stats(),
    }


@router.get("/sources")
async def list_source_kinds() -> dict:
    """Every camera type the system can ingest, with the fields each needs.

    Returned to the frontend so the add-camera form builds itself and stays in
    step with the backend instead of hardcoding a stale list.
    """
    from app.services.sources import SOURCE_KINDS
    return {"kinds": SOURCE_KINDS}


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
        "source_kinds": [
            "rtsp", "onvif", "webcam", "browser", "screen", "video", "fake",
            "mjpeg", "snapshot", "hls", "folder",
        ],
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
    source_kind: str = Field(
        ...,
        pattern=_SOURCE_KIND_RE,
    )
    source_kwargs: dict = Field(default_factory=dict)
    timeout: float = 8.0


@router.post("/test")
async def test_source(payload: ProbeIn) -> dict:
    """Open a source, grab one frame, report resolution + latency (test-before-add)."""
    import anyio

    from app.services.camera_connect import probe_source
    timeout = max(1.0, min(20.0, float(payload.timeout or 8.0)))
    # Browser push has no remote open — ready once the camera exists.
    if payload.source_kind in ("browser", "browser-crop", "push"):
        return {
            "ok": True,
            "source_kind": "browser",
            "width": 0,
            "height": 0,
            "latency_ms": 0,
            "note": "Browser crop: share a tab/window after add, then draw the crop region.",
        }
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
    kwargs = dict(payload.source_kwargs or {})
    if payload.source_kind in ("browser", "browser-crop", "push"):
        kwargs.setdefault("camera_id", payload.camera_id)
    cfg = CameraConfig(
        camera_id=payload.camera_id,
        source_kind=payload.source_kind,
        source_kwargs=kwargs,
        required_ppe=set(payload.required_ppe),
        fps_limit=payload.fps_limit,
        restricted_zones=payload.restricted_zones,
        hazards_enabled=payload.hazards_enabled,
        pose_enabled=payload.pose_enabled,
    )
    try:
        _manager().add(cfg)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _manager().status(payload.camera_id)


@router.post("/{camera_id}/push-frame")
async def push_browser_frame(
    camera_id: str,
    file: UploadFile = File(...),
) -> dict:
    """Receive one JPEG from the browser crop client (multipart field `file`)."""
    from app.services.browser_push import get_hub

    data = await file.read()
    if not data:
        raise HTTPException(400, "empty frame body")
    if len(data) > 8_000_000:
        raise HTTPException(413, "frame too large (max 8 MB)")
    try:
        return get_hub().push_jpeg(camera_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{camera_id}/push-status")
async def browser_push_status(camera_id: str) -> dict:
    from app.services.browser_push import get_hub

    return get_hub().status(camera_id)


# playback speed -> real-time multiplier (see VideoFileSource pacing)
_SPEED_MULT = {"slow": 0.5, "normal": 1.0, "fast": 2.0}


@router.post("/upload-video")
async def upload_video(
    file: UploadFile = File(...),
    camera_id: str = Form("demo"),
    loop: bool = Form(True),
    required_ppe: str = Form("helmet,vest"),
    speed: str = Form("normal"),   # slow | normal | fast
    fps_limit: float = Form(6.0),
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
        fps_limit=max(1.0, float(fps_limit or 6.0)),
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
    # Soft-disable in storage so restore_fleet does not bring it back, while
    # keeping zones / detection rules if the camera is re-added later.
    try:
        from app.services.camera_store import disable_camera
        await disable_camera(camera_id)
    except Exception:
        pass
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


@router.get("/meta/identities")
async def identities() -> dict:
    """Who the system is currently tracking, anonymously.

    These are colour signatures, not people. They cannot identify anyone and
    they expire — the question they answer is "is this the same worker as a
    moment ago", which is what makes repeat-offender counts real instead of
    counts of tracker fragments.
    """
    from app.core.config import get_settings
    from app.ml.reid import get_gallery

    s = get_settings()
    out = get_gallery().snapshot()
    out["enabled"] = bool(s.REID_ENABLED)
    return out


@router.post("/meta/identities/clear")
async def clear_identities() -> dict:
    """Forget every appearance signature. Use at shift change."""
    from app.ml.reid import get_gallery

    get_gallery().clear()
    return {"cleared": True}


class CalibrateRectIn(BaseModel):
    """Four ground corners of something whose real size is known."""
    image_quad: list = Field(..., min_length=4, max_length=4)
    width_m: float = Field(..., gt=0, le=500)
    length_m: float = Field(..., gt=0, le=500)
    note: str = ""


class CalibratePointsIn(BaseModel):
    image_points: list = Field(..., min_length=4)
    world_points: list = Field(..., min_length=4)
    note: str = ""


@router.get("/{camera_id}/calibration")
async def get_calibration(camera_id: str) -> dict:
    """This camera's ground plane, if it has one."""
    try:
        out = _manager().get_calibration(camera_id)
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    out["how"] = ("Click the four ground corners of something whose size you "
                  "know — a concrete bay, a painted lane, a pallet — clockwise "
                  "from top-left, and give its width and length in metres.")
    return out


@router.put("/{camera_id}/calibration")
async def put_calibration(camera_id: str, body: CalibrateRectIn) -> dict:
    """Calibrate from a known rectangle on the ground. Applied live.

    Turns pixel geometry into metres for this camera: near-miss becomes a real
    distance rather than a box overlap, and distances can be stated in units an
    operator can check with a tape measure.
    """
    from app.ml.calibration import from_rectangle

    plane, problems = from_rectangle(body.image_quad, body.width_m,
                                     body.length_m, note=body.note)
    if plane is None:
        raise HTTPException(422, {"errors": problems})
    try:
        _manager().set_calibration(camera_id, plane.as_dict())
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    out = plane.as_dict()
    out["warnings"] = problems
    return out


@router.put("/{camera_id}/calibration/points")
async def put_calibration_points(camera_id: str, body: CalibratePointsIn) -> dict:
    """Calibrate from explicit image/world correspondences (survey data)."""
    from app.ml.calibration import from_points

    plane, problems = from_points(body.image_points, body.world_points,
                                  note=body.note)
    if plane is None:
        raise HTTPException(422, {"errors": problems})
    try:
        _manager().set_calibration(camera_id, plane.as_dict())
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    out = plane.as_dict()
    out["warnings"] = problems
    return out


@router.delete("/{camera_id}/calibration")
async def clear_calibration(camera_id: str) -> dict:
    try:
        _manager().set_calibration(camera_id, {})
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    return {"camera_id": camera_id, "calibrated": False}


class MeasureIn(BaseModel):
    a: list = Field(..., min_length=2, max_length=2)
    b: list = Field(..., min_length=2, max_length=2)


@router.post("/{camera_id}/calibration/measure")
async def measure(camera_id: str, body: MeasureIn) -> dict:
    """Measure the ground distance between two image points, in metres.

    The sanity check that makes calibration trustworthy: point at two things
    whose separation you know and confirm the system agrees. A homography built
    from slightly wrong clicks produces plausible-looking numbers, so there has
    to be a way to catch that before anyone alerts on it.
    """
    from app.ml.calibration import load

    try:
        data = _manager().get_calibration(camera_id)
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    plane = load(data)
    if plane is None:
        raise HTTPException(409, "this camera is not calibrated")
    d = plane.distance_m(tuple(body.a), tuple(body.b))
    if d is None:
        raise HTTPException(422, "one of those points maps to the horizon — "
                                 "it is above the ground plane")
    return {"camera_id": camera_id, "metres": round(d, 2),
            "quality": plane.quality, "error_m": round(plane.error_m, 3),
            "reminder": ("Both points must be ON THE GROUND. A homography is "
                         "only valid on the plane it was fitted to, so pointing "
                         "at something at head height returns a wrong number.")}


class PoseIn(BaseModel):
    enabled: bool


@router.post("/{camera_id}/pose")
async def set_pose(camera_id: str, payload: PoseIn) -> dict:
    """Turn keypoint estimation on/off for one camera. Applied live.

    Pose fixes the failure the fixed bounding-box bands have with posture: a
    worker bending over has their head more than halfway down their own box, so
    the band logic does not credit their helmet and starts building a violation
    against someone who is wearing one. It costs a second model call per frame
    on this camera, which is why it is per camera and not a global switch.
    """
    try:
        enabled = _manager().set_pose(camera_id, payload.enabled)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    out = _manager().status(camera_id)
    out["pose_enabled"] = enabled
    if enabled:
        from app.ml.pose import get_pose
        out["pose_weights"] = get_pose().weights
        out["note"] = ("Keypoints active from the next frame. Expect roughly "
                       "double the inference cost on this camera.")
    return out


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

