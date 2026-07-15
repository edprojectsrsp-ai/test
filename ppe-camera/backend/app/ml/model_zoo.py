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


# Catalog shown in the AI Model dropdown (order = display order).
CATALOG: list[ZooModel] = [
    ZooModel(
        key="snehil-demo",
        label="Demo PPE Model (Snehil)",
        kind="pretrained",
        classes=["Hardhat", "Mask", "NO-Hardhat", "NO-Mask", "NO-Safety Vest",
                 "Person", "Safety Cone", "Safety Vest", "machinery", "vehicle"],
        url="https://raw.githubusercontent.com/snehilsanyal/"
            "Construction-Site-Safety-PPE-Detection/main/models/best.pt",
        sha256="4d07bbd92ca30d5c12dd67ccf52b2f54f533c9ccfef534284124682ef9f56129",
        license="see snehilsanyal/Construction-Site-Safety-PPE-Detection (GitHub)",
        note="YOLOv8n, 10-class construction PPE. Great for the live demo.",
        verified=False,
        file_ext=".pt",
    ),
    ZooModel(
        key="voxdroid-enterprise",
        label="Enterprise PPE Model (VoxDroid)",
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
        note="YOLOv8s, 200 epochs, ~95% precision / ~80% recall. Heavier, more "
             "accurate than the Snehil demo model.",
        verified=False,
        file_ext=".pt",
    ),
    ZooModel(
        key="nduka1999",
        label="PPE YOLO11s (nduka1999)",
        kind="pretrained",
        classes=["hardhat", "no-hardhat", "vest", "no-vest", "person"],
        url=os.getenv(
            "PPE_NDUKA_URL",
            "https://huggingface.co/nduka1999/nd_ppe_yolo11s/resolve/main/best.onnx?download=true",
        ),
        # Optional pin: leave empty by default (HF CDN re-exports can change).
        sha256=os.getenv("PPE_NDUKA_SHA256", ""),
        license="MIT — huggingface.co/nduka1999/nd_ppe_yolo11s",
        note="YOLO11s ONNX (~38 MB). Cap + vest. First select downloads from HF — wait until LIVE before upload video.",
        verified=False,
        file_ext=".onnx",
    ),
    ZooModel(
        key="hexmon-vyra",
        label="Vyra YOLOv8m (Hexmon)",
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
        note="YOLOv8m (~52 MB), 14 classes incl. gloves/goggles/fall. First select downloads from HF — wait until LIVE before upload video.",
        verified=False,
        file_ext=".pt",
    ),
    ZooModel(
        key="custom-path",
        label="Custom Model (.pt path)",
        kind="custom",
        note="Point at a local .pt already on the server.",
    ),
    ZooModel(
        key="upload",
        label="Upload Model (.pt)",
        kind="upload",
        note="Upload your Colab-trained best.pt. Unverified source -- your trust.",
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
    return out


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
