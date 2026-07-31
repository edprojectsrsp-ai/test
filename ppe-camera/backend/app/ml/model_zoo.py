"""
Model Zoo -- the catalog behind the "AI Model" dropdown.

Each entry is a selectable detector: a pretrained PPE model that downloads on
first select, or a slot for a user-supplied checkpoint (custom path / upload).
Selecting one downloads (if needed), registers it, activates it, and hot-swaps
the live detector.

Security note: a .pt is a pickle -> loading an untrusted one can execute code.
Catalog entries may be checksum-pinned (sha256). Uploaded/custom checkpoints
are the operator's own trust decision.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import time
import urllib.request
from dataclasses import dataclass, field, asdict
from pathlib import Path

from app.core.config import get_settings


@dataclass
class ZooModel:
    key: str                              # dropdown id
    label: str                            # dropdown text
    kind: str                             # "pretrained" | "custom" | "upload"
    classes: list[str] = field(default_factory=list)   # this model's own labels
    url: str = ""                         # download source (pretrained)
    sha256: str = ""                      # integrity pin (pretrained); empty = skip
    license: str = "unknown"
    note: str = ""
    verified: bool = False                # accuracy vetted on plant footage?
    file_ext: str = ".pt"                 # .pt or .onnx
    tier: str = "standard"                # "light" | "standard" | "heavy"
    recommended: bool = False             # preferred default for plant deploys
    # Relative plant efficacy score 0–100 (helmet colours, gear coverage, track).
    # Not a lab mAP substitute — used only for UI ranking / guidance.
    efficacy: int = 50
    plant_ready: bool = False             # OK as default for industrial sites


# Catalog order = dropdown order. SH17 family first (best industrial efficacy).
# Efficacy ranking (plant PPE, coloured hardhats, multi-gear):
#   sh17-yolo9e > sh17-yolo9m > hexmon-vyra > sh17-yolo8s
#   > voxdroid > snehil > nduka (ONNX, no track)
CATALOG: list[ZooModel] = [
    # --- SH17 family (real industrial photography) -------------------------
    ZooModel(
        key="sh17-yolo9m",
        label="★ SH17 Industrial — YOLOv9-m (recommended)",
        kind="pretrained",
        classes=["person", "ear", "ear-mufs", "face", "face-guard", "face-mask",
                 "foot", "tool", "glasses", "gloves", "helmet", "hands", "head",
                 "medical-suit", "shoes", "safety-suit", "safety-vest"],
        url=os.getenv(
            "PPE_SH17_M_URL",
            "https://github.com/ahmadmughees/SH17dataset/releases/download/v1/yolo9m.pt",
        ),
        sha256=os.getenv("PPE_SH17_M_SHA256", ""),
        license="research/benchmark weights — github.com/ahmadmughees/SH17dataset "
                "(images under the Pexels license)",
        note="PLANT DEFAULT (~39 MB). mAP50≈68.6. Helmets all colours (yellow/red/"
             "white/blue), gloves, goggles, boots, vest. Best accuracy/speed tradeoff.",
        verified=True,
        file_ext=".pt",
        tier="standard",
        recommended=True,
        efficacy=92,
        plant_ready=True,
    ),
    ZooModel(
        key="sh17-yolo9e",
        label="SH17 Industrial — YOLOv9-e (max accuracy)",
        kind="pretrained",
        classes=["person", "ear", "ear-mufs", "face", "face-guard", "face-mask",
                 "foot", "tool", "glasses", "gloves", "helmet", "hands", "head",
                 "medical-suit", "shoes", "safety-suit", "safety-vest"],
        url=os.getenv(
            "PPE_SH17_E_URL",
            "https://github.com/ahmadmughees/SH17dataset/releases/download/v1/yolo9e.pt",
        ),
        sha256=os.getenv("PPE_SH17_E_SHA256", ""),
        license="research/benchmark weights — github.com/ahmadmughees/SH17dataset "
                "(images under the Pexels license)",
        note="HIGHEST ACCURACY (~112 MB). mAP50≈70.9. GPU recommended for multi-cam "
             "real-time. Prefer this when quality > FPS.",
        verified=True,
        file_ext=".pt",
        tier="heavy",
        efficacy=96,
        plant_ready=True,
    ),
    ZooModel(
        key="sh17-yolo8s",
        label="SH17 Industrial — YOLOv8-s (CPU light)",
        kind="pretrained",
        classes=["person", "ear", "ear-mufs", "face", "face-guard", "face-mask",
                 "foot", "tool", "glasses", "gloves", "helmet", "hands", "head",
                 "medical-suit", "shoes", "safety-suit", "safety-vest"],
        url=os.getenv(
            "PPE_SH17_S_URL",
            "https://github.com/ahmadmughees/SH17dataset/releases/download/v1/yolo8s.pt",
        ),
        sha256=os.getenv("PPE_SH17_S_SHA256", ""),
        license="research/benchmark weights — github.com/ahmadmughees/SH17dataset "
                "(images under the Pexels license)",
        note="CPU-friendly (~22 MB). mAP50≈63.7. Use on laptops / free cloud CPU.",
        verified=True,
        file_ext=".pt",
        tier="light",
        efficacy=84,
        plant_ready=True,
    ),
    ZooModel(
        key="hexmon-vyra",
        label="Vyra YOLOv8m (Hexmon) — fall + gloves",
        kind="pretrained",
        classes=[
            "Fall-Detected", "Gloves", "Goggles", "Hardhat", "Ladder", "Mask",
            "NO-Gloves", "NO-Goggles", "NO-Hardhat", "NO-Mask", "NO-Safety Vest",
            "Person", "Safety Cone", "Safety Vest",
        ],
        url=os.getenv(
            "PPE_HEXMON_URL",
            "https://huggingface.co/Hexmon/vyra-yolo-ppe-detection/resolve/main/best.pt?download=true",
        ),
        sha256=os.getenv("PPE_HEXMON_SHA256", ""),
        license="CC-BY-4.0 — huggingface.co/Hexmon/vyra-yolo-ppe-detection",
        note="YOLOv8m (~52 MB). Extra fall detection + gloves/goggles. Weaker on "
             "coloured plant hardhats than SH17. Wait for LIVE after first download.",
        verified=False,
        file_ext=".pt",
        tier="heavy",
        efficacy=78,
        plant_ready=True,
    ),
    ZooModel(
        key="voxdroid-enterprise",
        label="VoxDroid Enterprise (demo / css-data)",
        kind="pretrained",
        classes=["Hardhat", "Mask", "NO-Hardhat", "NO-Mask", "NO-Safety Vest",
                 "Person", "Safety Cone", "Safety Vest", "machinery", "vehicle"],
        url=os.getenv(
            "PPE_VOXDROID_URL",
            "https://raw.githubusercontent.com/VoxDroid/"
            "Construction-Site-Safety-PPE-Detection/main/Model-Training/Outputs/"
            "runs/detect/yolov8s_ppe_css_200_epochs/weights/best.pt",
        ),
        sha256=os.getenv(
            "PPE_VOXDROID_SHA256",
            "470cc1d2f39774ade966488719d20635da56431123a8b189ec87fec041f0bc47",
        ),
        license="see VoxDroid/Construction-Site-Safety-PPE-Detection (GitHub)",
        note="YOLOv8s css-data. Strong lab precision, misses many yellow/red "
             "hardhats on real plants. Prefer SH17 for production.",
        verified=False,
        file_ext=".pt",
        tier="heavy",
        efficacy=62,
        plant_ready=False,
    ),
    ZooModel(
        key="snehil-demo",
        label="Snehil Demo (fast demo only)",
        kind="pretrained",
        classes=["Hardhat", "Mask", "NO-Hardhat", "NO-Mask", "NO-Safety Vest",
                 "Person", "Safety Cone", "Safety Vest", "machinery", "vehicle"],
        url="https://raw.githubusercontent.com/snehilsanyal/"
            "Construction-Site-Safety-PPE-Detection/main/models/best.pt",
        sha256="4d07bbd92ca30d5c12dd67ccf52b2f54f533c9ccfef534284124682ef9f56129",
        license="see snehilsanyal/Construction-Site-Safety-PPE-Detection (GitHub)",
        note="YOLOv8n demo. Fast but same css-data hardhat colour bias. Not for plant.",
        verified=False,
        file_ext=".pt",
        tier="standard",
        efficacy=55,
        plant_ready=False,
    ),
    ZooModel(
        key="nduka1999",
        label="nduka YOLO11s ONNX (legacy light)",
        kind="pretrained",
        classes=["hardhat", "no-hardhat", "vest", "no-vest", "person"],
        url=os.getenv(
            "PPE_NDUKA_URL",
            "https://huggingface.co/nduka1999/nd_ppe_yolo11s/resolve/main/best.onnx?download=true",
        ),
        sha256=os.getenv("PPE_NDUKA_SHA256", ""),
        license="MIT — huggingface.co/nduka1999/nd_ppe_yolo11s",
        note="ONNX only — no ByteTrack multi-person tracking. Cap+vest only. "
             "Superseded by SH17 YOLOv8-s.",
        verified=False,
        file_ext=".onnx",
        tier="light",
        efficacy=48,
        plant_ready=False,
    ),
    ZooModel(
        key="custom-path",
        label="Custom Model (.pt path on server)",
        kind="custom",
        note="Fine-tuned plant weights already on disk. Best long-term after Review→Train.",
        tier="heavy",
        efficacy=90,
        plant_ready=True,
    ),
    ZooModel(
        key="upload",
        label="Upload Model (.pt)",
        kind="upload",
        note="Upload Colab/Ultralytics best.pt from your plant fine-tune. Your trust boundary.",
        tier="heavy",
        efficacy=90,
        plant_ready=True,
    ),
]

BY_KEY = {m.key: m for m in CATALOG}


def _zoo_dir() -> Path:
    d = get_settings().WEIGHTS_DIR / "zoo"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _local_path(m: ZooModel) -> Path:
    ext = m.file_ext if str(m.file_ext).startswith(".") else f".{m.file_ext}"
    return _zoo_dir() / f"{m.key}{ext}"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def catalog() -> list[dict]:
    """Dropdown payload: each model + whether its weights are already local."""
    out = []
    for m in CATALOG:
        local = _local_path(m) if m.kind == "pretrained" else _zoo_dir() / f"{m.key}.pt"
        d = asdict(m)
        d["downloaded"] = local.exists()
        d["available"] = bool(m.url) or m.kind in ("custom", "upload") or local.exists()
        d["local_path"] = str(local) if local.exists() else ""
        out.append(d)
    # Best plant models first when the UI sorts by efficacy
    out.sort(key=lambda x: (
        0 if x.get("recommended") else 1,
        -(x.get("efficacy") or 0),
        x.get("label") or "",
    ))
    return out


def recommended_key() -> str:
    """Default plant model key (SH17-m if present in catalog)."""
    for m in CATALOG:
        if m.recommended and m.kind == "pretrained":
            return m.key
    return "sh17-yolo9m"


def ensure_downloaded(key: str) -> Path:
    """Download (once) + optional checksum-verify a pretrained catalog model.

    Blocking I/O — call via asyncio.to_thread from request handlers so the
    API stays responsive (video upload must not hang during a 50 MB pull).
    """
    m = BY_KEY.get(key)
    if m is None:
        raise ValueError(f"unknown model '{key}'")
    if m.kind != "pretrained":
        raise ValueError(f"'{key}' is not a downloadable model (kind={m.kind})")
    dest = _local_path(m)
    pin = (m.sha256 or "").strip()
    min_bytes = 1_000_000  # real YOLO weights are multi-MB; HTML error pages are small
    if dest.exists() and dest.stat().st_size >= min_bytes and (not pin or _sha256(dest) == pin):
        return dest
    if dest.exists() and (dest.stat().st_size < min_bytes or (pin and _sha256(dest) != pin)):
        dest.unlink(missing_ok=True)
    if not m.url:
        raise ValueError(f"'{m.label}' has no download URL set yet")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        req = urllib.request.Request(
            m.url,
            headers={
                "User-Agent": "ppe-camera-model-zoo/1.0",
                "Accept": "application/octet-stream,*/*",
            },
        )
        with urllib.request.urlopen(req, timeout=900) as resp, open(tmp, "wb") as out:  # noqa: S310
            # Reject HTML error pages from Cloudflare / HF
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "text/html" in ctype:
                raise ValueError(
                    f"download returned HTML instead of weights for {key} "
                    f"(check URL / network / Hugging Face access)"
                )
            shutil.copyfileobj(resp, out, length=1024 * 1024)
        size = tmp.stat().st_size
        if size < min_bytes:
            tmp.unlink(missing_ok=True)
            raise ValueError(
                f"download too small for {key} ({size} bytes) — likely a failed HF fetch"
            )
        if pin:
            got = _sha256(tmp)
            if got != pin:
                tmp.unlink(missing_ok=True)
                raise ValueError(
                    f"checksum mismatch for {key}: got {got[:12]}..., "
                    f"expected {pin[:12]}..."
                )
        tmp.replace(dest)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return dest


def register_and_activate(weights_path: Path, key: str, note: str = "") -> dict:
    """Register weights in the shared registry, activate, and hot-swap the
    live detector. Mirrors routers/models.py so both stay in sync."""
    from app.routers.models import _load, _save, _activate

    reg = _load()
    version = (max((v["version"] for v in reg["versions"]), default=0)) + 1
    m = BY_KEY.get(key)
    entry = {
        "version": version,
        "weights": str(weights_path),
        "note": note or (m.label if m else key),
        "metrics": {},
        "ts": time.time(),
        "zoo_key": key,
        "classes": (m.classes if m else []),
    }
    reg["versions"].append(entry)
    _save(reg)
    return _activate(reg, version)


def select(key: str, custom_path: str | None = None) -> dict:
    """Dropdown action: make `key` the live model.
      - pretrained: download (if needed, checksum-verified) -> activate
      - custom:     activate an existing local .pt at custom_path
      - upload:     caller uploads first, then activates via custom_path
    """
    m = BY_KEY.get(key)
    if m is None:
        raise ValueError(f"unknown model '{key}'")
    if m.kind == "pretrained":
        path = ensure_downloaded(key)
        return register_and_activate(path, key)
    # custom / upload: activate a provided local checkpoint
    if not custom_path:
        raise ValueError(f"'{m.label}' needs a .pt path")
    p = Path(custom_path)
    if not p.exists():
        raise ValueError(f"weights not found: {custom_path}")
    dest = _zoo_dir() / f"{key}{p.suffix or '.pt'}"
    if p.resolve() != dest.resolve():
        shutil.copy2(p, dest)
    return register_and_activate(dest, key, note=f"{m.label}: {p.name}")
