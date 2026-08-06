"""
Central configuration. Portable by design: auto-detects GPU/CPU,
reads everything from environment with sane defaults so the same
image runs on a Jetson, a GPU server, or a plain laptop.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path


def _detect_device() -> str:
    """Return 'cuda', 'mps', or 'cpu' without importing torch at module load."""
    forced = os.getenv("PPE_DEVICE")
    if forced:
        return forced
    try:
        import torch  # local import keeps startup cheap on CPU-only boxes

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


class Settings:
    # ---- deployment role -------------------------------------------------
    # "edge"  -- the plant PC: cameras, inference, live view, recording, training.
    #            Everything heavy. Uses the local GPU/CPU and local disk.
    # "cloud" -- the free-tier dashboard: violations feed + the sync receiver,
    #            nothing else. Never imports torch/ultralytics/opencv, which is
    #            the whole point: the ML stack alone is ~500 MB resident and a
    #            512 MB instance is out of memory before it serves a request.
    ROLE: str = os.getenv("PPE_ROLE", "edge").strip().lower()

    # ---- paths -----------------------------------------------------------
    ROOT: Path = Path(os.getenv("PPE_ROOT", Path(__file__).resolve().parents[3]))
    DATA_DIR: Path = ROOT / "data"
    WEIGHTS_DIR: Path = DATA_DIR / "weights"
    CAPTURES_DIR: Path = DATA_DIR / "captures"
    DATASETS_DIR: Path = DATA_DIR / "datasets"
    EXPORTS_DIR: Path = DATA_DIR / "exports"
    RECORDINGS_DIR: Path = DATA_DIR / "recordings"

    # ---- database --------------------------------------------------------
    # Defaults to SQLite so it runs with zero setup; point at Postgres in prod.
    DATABASE_URL: str = os.getenv(
        "PPE_DATABASE_URL", f"sqlite+aiosqlite:///{DATA_DIR / 'ppe.db'}"
    )

    # ---- model -----------------------------------------------------------
    # Base weights fetched on first run. Default to YOLO12 (latest stable);
    # falls back to yolo11m automatically if the installed ultralytics can't
    # resolve v12 (see Detector._resolve_weights). Both already know 'person'
    # from COCO, which we use for gating PPE logic.
    BASE_WEIGHTS: str = os.getenv("PPE_BASE_WEIGHTS", "yolo12m.pt")
    BASE_WEIGHTS_FALLBACK: str = os.getenv("PPE_BASE_WEIGHTS_FALLBACK", "yolo11m.pt")
    # If a fine-tuned PPE checkpoint exists, it takes priority over base.
    ACTIVE_WEIGHTS_NAME: str = os.getenv("PPE_ACTIVE_WEIGHTS", "ppe_active.pt")
    DEVICE: str = _detect_device()
    CONF_THRESHOLD: float = float(os.getenv("PPE_CONF", "0.35"))
    IOU_THRESHOLD: float = float(os.getenv("PPE_IOU", "0.5"))
    # Preserve full resolution on accelerated hardware while keeping CPU-only
    # free instances within memory. PPE_IMGSZ always overrides this default.
    IMG_SIZE: int = int(os.getenv(
        "PPE_IMGSZ",
        "640" if DEVICE in ("cuda", "mps") else "416",
    ))
    # Tracker: "bytetrack.yaml" (default) or "botsort.yaml" (re-ID, better for
    # crowded scenes / occlusion, slightly heavier).
    TRACKER: str = os.getenv("PPE_TRACKER", "bytetrack.yaml")
    # SAHI sliced inference for small-PPE recall (predict mode only).
    USE_SAHI: bool = os.getenv("PPE_SAHI", "0") not in ("0", "", "false", "False")
    SAHI_SLICE: int = int(os.getenv("PPE_SAHI_SLICE", "640"))
    SAHI_OVERLAP: float = float(os.getenv("PPE_SAHI_OVERLAP", "0.2"))

    # ---- evidence clips ---------------------------------------------------
    # A short animated GIF beside every violation still. A single frame cannot
    # show whether someone had been bare-headed for the whole approach or was
    # caught mid-way through putting a helmet on, which is precisely the point
    # contractors dispute.
    EVIDENCE_GIF_ENABLED: bool = os.getenv("PPE_EVIDENCE_GIF", "1") not in (
        "0", "", "false", "False")
    EVIDENCE_GIF_SECONDS: float = float(os.getenv("PPE_EVIDENCE_GIF_S", "10"))
    # GIF has no interframe compression, so these defaults matter: 400px at
    # 5 fps keeps ten seconds around a megabyte, small enough to send over
    # Telegram/WhatsApp without a transcode step.
    EVIDENCE_GIF_WIDTH: int = int(os.getenv("PPE_EVIDENCE_GIF_WIDTH", "400"))
    EVIDENCE_GIF_FPS: float = float(os.getenv("PPE_EVIDENCE_GIF_FPS", "5"))

    # ---- re-identification (Track B) --------------------------------------
    # ANONYMOUS: a colour histogram of the person crop, never a face. It creates
    # no biometric record, cannot identify anyone, and expires — which is what
    # makes it defensible under the DPDP Act and acceptable to a plant workforce.
    # On by default because it costs microseconds and strictly improves the
    # identity resolution the violation engine already does.
    REID_ENABLED: bool = os.getenv("PPE_REID", "1") not in ("0", "", "false", "False")
    # A shift, roughly. Long enough that a worker who steps away for tea is the
    # same person when they come back; short enough that nothing accumulates
    # into a durable record of anybody.
    REID_TTL_S: float = float(os.getenv("PPE_REID_TTL_S", "900"))
    REID_THRESHOLD: float = float(os.getenv("PPE_REID_THRESHOLD", "0.82"))
    # Deliberately stricter across cameras: different lighting makes scores
    # noisier, and a wrong cross-camera merge blames one worker for another's
    # violations. Splitting one person in two is the safer failure.
    REID_CROSS_THRESHOLD: float = float(os.getenv("PPE_REID_CROSS", "0.88"))

    # ---- pose (Track B: perception depth) --------------------------------
    # Off by default and enabled per camera. Pose is a SECOND model per frame,
    # and the detector is already the fleet bottleneck — the inference budget
    # exists precisely because one model cannot serve twenty cameras. Turn it on
    # for cameras watching people work, where posture varies and the fixed
    # bounding-box bands misjudge anyone bending; leave it off on a gate camera
    # where everyone walks past upright.
    POSE_ENABLED_DEFAULT: bool = os.getenv("PPE_POSE", "0") not in (
        "0", "", "false", "False")
    # Smallest checkpoint by default: this runs on CPU-only boxes, and pose is
    # answering "roughly where is the head", not a biomechanics question.
    POSE_WEIGHTS: str = os.getenv("PPE_POSE_WEIGHTS", "yolo11n-pose.pt")
    POSE_CONF: float = float(os.getenv("PPE_POSE_CONF", "0.35"))
    POSE_IMGSZ: int = int(os.getenv("PPE_POSE_IMGSZ", "640"))
    # Fall geometry. Both must hold: torso past this angle from vertical AND
    # head no higher than this fraction of body height above the hips. Either
    # alone fires on bending or crouching.
    FALL_TORSO_DEG: float = float(os.getenv("PPE_FALL_TORSO_DEG", "55"))
    FALL_HEAD_FRAC: float = float(os.getenv("PPE_FALL_HEAD_FRAC", "0.18"))

    # ---- active learning -------------------------------------------------
    # A frame is "uncertain" if any PPE-relevant box falls in this band.
    LOW_CONF_BAND: tuple[float, float] = (0.25, 0.55)
    CAPTURE_COOLDOWN_S: int = int(os.getenv("PPE_CAPTURE_COOLDOWN", "8"))
    # Dedup: one alert/photo per (camera, person, violation) within this window,
    # so the same person missing the same gear doesn't spam identical photos.
    VIOLATION_COOLDOWN_S: int = int(os.getenv("PPE_VIOLATION_COOLDOWN", "30"))
    # Only detections the model is UNSURE about (below this confidence) are put
    # in the training queue -- that's where human labels add value. Confident
    # detections still raise alerts, they just don't clutter the labeler.
    TRAINING_CONF_MAX: float = float(os.getenv("PPE_TRAINING_CONF_MAX", "0.80"))

    # ---- alerts ----------------------------------------------------------
    ALERT_COOLDOWN_S: int = int(os.getenv("PPE_ALERT_COOLDOWN", "60"))

    # ---- NVR / recording -------------------------------------------------
    # Default record mode for a camera with nothing configured. "events" is the
    # safe default: continuous recording on a 20-camera site fills a disk in
    # days, whereas event clips keep the evidence that actually gets disputed.
    RECORD_MODE_DEFAULT: str = os.getenv("PPE_RECORD_MODE", "events")
    # Continuous footage is cut into segments so retention can delete whole
    # files and playback can seek without decoding an entire day.
    RECORD_SEGMENT_S: int = int(os.getenv("PPE_RECORD_SEGMENT_S", "300"))
    # Seconds of footage kept in memory ahead of an event. A violation is
    # already several seconds old by the time the engine confirms it, so
    # without pre-roll the clip starts after the interesting part.
    RECORD_PRE_ROLL_S: float = float(os.getenv("PPE_RECORD_PRE_ROLL_S", "8"))
    RECORD_POST_ROLL_S: float = float(os.getenv("PPE_RECORD_POST_ROLL_S", "12"))
    # Recording fps is deliberately decoupled from inference fps: evidence
    # video wants smoothness, the detector wants headroom.
    RECORD_FPS: float = float(os.getenv("PPE_RECORD_FPS", "8"))
    # Longest edge of recorded video. 1280 keeps faces and gear legible while
    # costing about a third of full 1080p storage.
    RECORD_MAX_WIDTH: int = int(os.getenv("PPE_RECORD_MAX_WIDTH", "1280"))
    RECORD_JPEG_QUALITY: int = int(os.getenv("PPE_RECORD_JPEG_QUALITY", "82"))
    # Retention. Whichever limit bites first wins; locked segments are exempt.
    RECORD_RETENTION_DAYS: int = int(os.getenv("PPE_RECORD_RETENTION_DAYS", "14"))
    RECORD_MAX_GB: float = float(os.getenv("PPE_RECORD_MAX_GB", "50"))
    # Burn the detection overlay into recorded video. Off by default: an
    # evidence clip a contractor disputes should show the scene, not our boxes.
    RECORD_OVERLAY: bool = os.getenv("PPE_RECORD_OVERLAY", "0") not in (
        "0", "", "false", "False")

    # ---- LAN access (wall TVs, phones on the plant network) ---------------
    # The agent binds to loopback by default: on a single operator PC nothing
    # else needs to reach it, and loopback is the one origin browsers exempt
    # from mixed-content blocking.
    #
    # Wall displays and phones are different machines, so they need a real LAN
    # bind. That is opt-in, because it moves the trust boundary from "this PC"
    # to "anyone on the plant network" — which includes camera feeds.
    HOST: str = os.getenv("PPE_HOST", "127.0.0.1")
    # Optional shared secret for LAN access. Accepted as an X-PPE-Key header OR
    # a ?ppe_key= query parameter — the query form is not laziness: an <img>
    # tag streaming MJPEG cannot set headers, and the video wall is the entire
    # reason for binding to the LAN in the first place. (?k= is already taken:
    # the stream URLs use it as a cache-buster.)
    LAN_TOKEN: str = os.getenv("PPE_LAN_TOKEN", "").strip()

    # ---- cloud sync (edge -> cloud, outbound only) ------------------------
    # The agent never accepts an inbound connection from the cloud. It pushes
    # violations out over HTTPS and that is the entire coupling, which is what
    # makes this deployable inside a plant network with no firewall change.
    SYNC_URL: str = os.getenv("PPE_SYNC_URL", "").strip().rstrip("/")
    AGENT_ID: str = os.getenv("PPE_AGENT_ID", "").strip()
    AGENT_TOKEN: str = os.getenv("PPE_AGENT_TOKEN", "").strip()
    # OFF by default, deliberately. Pushing plant surveillance data to a public
    # cloud is a decision an operator makes, not a default they discover after
    # the fact. Manual push is the primary path; the timer is opt-in.
    AUTO_SYNC: bool = os.getenv("PPE_AUTO_SYNC", "0") not in (
        "0", "", "false", "False")
    SYNC_INTERVAL_S: int = int(os.getenv("PPE_SYNC_INTERVAL_S", str(4 * 3600)))
    # Rows per HTTP request. A four-hour backlog on a busy site is thousands of
    # violations; one request carrying all of them times out and retries forever.
    SYNC_BATCH: int = int(os.getenv("PPE_SYNC_BATCH", "100"))
    SYNC_TIMEOUT_S: float = float(os.getenv("PPE_SYNC_TIMEOUT_S", "60"))
    # The thumbnail is the ONLY evidence the cloud ever sees — full-res stills,
    # GIFs and clips stay on the agent — so it has to stay legible. 640px q75 is
    # ~45 KB, which keeps a 100-row batch around 5 MB.
    SYNC_THUMB_WIDTH: int = int(os.getenv("PPE_SYNC_THUMB_WIDTH", "640"))
    SYNC_THUMB_QUALITY: int = int(os.getenv("PPE_SYNC_THUMB_QUALITY", "75"))

    # ---- cloud-side agent credentials -------------------------------------
    # "agentid:token,agentid2:token2". Seeded into the sync_agents table at
    # boot, hashed. Env rather than an admin UI because there is exactly one
    # plant PC today, and a login screen nobody uses is a bigger liability than
    # an environment variable. Revoke by removing the entry and redeploying, or
    # by flipping sync_agents.enabled.
    SYNC_AGENTS: str = os.getenv("PPE_SYNC_AGENTS", "").strip()

    # A single join code an operator types into the installer. The agent calls
    # /api/sync/enroll with it and is handed its own id and token, so nobody has
    # to invent an agent id, keep two secrets in step, or edit a Render
    # environment variable per plant PC.
    #
    # It is a shared bearer secret: anyone holding it can register an agent. It
    # is therefore rotatable (change the variable, redeploy) and every agent it
    # creates can be revoked individually via sync_agents.enabled. Enrollment
    # only ever creates a pusher -- it grants no read access to anything.
    ENROLL_CODE: str = os.getenv("PPE_ENROLL_CODE", "").strip()

    # Per-customer codes: "customer:code" pairs, comma or whitespace separated.
    #
    #     PPE_ENROLL_CODES="rsp:7Kd2-xQ91, tatasteel:Bf44-mL07"
    #
    # One code per customer rather than one for everybody, so a leak is contained
    # to a single site and can be rotated without breaking every other customer's
    # future installs. The matched customer is recorded on the agent, which is
    # what makes "revoke this customer" a query instead of an eyeball exercise.
    # ENROLL_CODE stays supported so existing deployments keep working.
    ENROLL_CODES: str = os.getenv("PPE_ENROLL_CODES", "").strip()

    def enroll_codes(self) -> list[tuple[str, str]]:
        """(customer, code) pairs from both settings. Never logged."""
        pairs: list[tuple[str, str]] = []
        for chunk in re.split(r"[,\s]+", self.ENROLL_CODES or ""):
            chunk = chunk.strip()
            if not chunk:
                continue
            customer, sep, code = chunk.partition(":")
            # No separator means somebody wrote a bare code here. Honour it
            # rather than silently ignoring a code the operator believes is live.
            if not sep:
                customer, code = "", chunk
            code = code.strip()
            if code:
                pairs.append((customer.strip().lower(), code))
        if self.ENROLL_CODE:
            pairs.append(("", self.ENROLL_CODE))
        return pairs

    # ---- cloud-side retention --------------------------------------------
    # The cloud is a dashboard, not an archive: the agent holds the system of
    # record. Free Postgres is ~1 GB, which is ~20k thumbnails, so old cloud
    # rows are pruned while the originals stay on the plant PC.
    CLOUD_RETENTION_DAYS: int = int(os.getenv("PPE_CLOUD_RETENTION_DAYS", "90"))

    @property
    def is_edge(self) -> bool:
        return self.ROLE != "cloud"

    @property
    def is_cloud(self) -> bool:
        return self.ROLE == "cloud"

    def ensure_dirs(self) -> None:
        for d in (
            self.DATA_DIR,
            self.WEIGHTS_DIR,
            self.CAPTURES_DIR,
            self.DATASETS_DIR,
            self.EXPORTS_DIR,
            self.RECORDINGS_DIR,
        ):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s
