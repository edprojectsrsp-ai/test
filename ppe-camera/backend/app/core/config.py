"""
Central configuration. Portable by design: auto-detects GPU/CPU,
reads everything from environment with sane defaults so the same
image runs on a Jetson, a GPU server, or a plain laptop.
"""
from __future__ import annotations

import os
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
    # ---- paths -----------------------------------------------------------
    ROOT: Path = Path(os.getenv("PPE_ROOT", Path(__file__).resolve().parents[3]))
    DATA_DIR: Path = ROOT / "data"
    WEIGHTS_DIR: Path = DATA_DIR / "weights"
    CAPTURES_DIR: Path = DATA_DIR / "captures"
    DATASETS_DIR: Path = DATA_DIR / "datasets"
    EXPORTS_DIR: Path = DATA_DIR / "exports"

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
    IMG_SIZE: int = int(os.getenv("PPE_IMGSZ", "640"))
    # Tracker: "bytetrack.yaml" (default) or "botsort.yaml" (re-ID, better for
    # crowded scenes / occlusion, slightly heavier).
    TRACKER: str = os.getenv("PPE_TRACKER", "bytetrack.yaml")
    # SAHI sliced inference for small-PPE recall (predict mode only).
    USE_SAHI: bool = os.getenv("PPE_SAHI", "0") not in ("0", "", "false", "False")
    SAHI_SLICE: int = int(os.getenv("PPE_SAHI_SLICE", "640"))
    SAHI_OVERLAP: float = float(os.getenv("PPE_SAHI_OVERLAP", "0.2"))

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

    def ensure_dirs(self) -> None:
        for d in (
            self.DATA_DIR,
            self.WEIGHTS_DIR,
            self.CAPTURES_DIR,
            self.DATASETS_DIR,
            self.EXPORTS_DIR,
        ):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s

