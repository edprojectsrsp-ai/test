"""
Model version management -- the admin face of the self-training loop.

Reads/writes the SAME JSON registry as ppe_upgrade/train_cli.py (set
PPE_REGISTRY for both to <WEIGHTS_DIR>/registry.json). Activating a version
copies its weights over ACTIVE_WEIGHTS_NAME and hot-reloads the detector --
running cameras pick up the new model on their next frame, no restart.

  GET   /models                 list versions (+ which is active/live)
  POST  /models/{ver}/activate  make a version live (hot-swap)
  POST  /models/rollback        previous version live
  POST  /models/reload          re-read weights from disk (after manual copy)

  -- AI Model dropdown (model zoo) --
  GET   /models/zoo             catalog for the dropdown (Snehil, VoxDroid, ...)
  POST  /models/zoo/{key}/select   download (if needed) + activate a catalog model
  POST  /models/zoo/select-custom  activate a local .pt by path
  POST  /models/upload          upload a .pt and activate it
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.config import get_settings
from app.ml.detector import get_detector

router = APIRouter(prefix="/api/models", tags=["models"])


def _registry_path() -> Path:
    s = get_settings()
    return Path(os.getenv("PPE_REGISTRY", str(s.WEIGHTS_DIR / "registry.json")))


def _load() -> dict:
    p = _registry_path()
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return {"versions": [], "active": None}


def _save(reg: dict) -> None:
    p = _registry_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w") as f:
        json.dump(reg, f, indent=2)


def _activate(reg: dict, version: int) -> dict:
    entry = next((v for v in reg["versions"] if v["version"] == version), None)
    if entry is None:
        raise HTTPException(404, f"unknown version {version}")
    weights = Path(entry["weights"])
    if not weights.exists():
        raise HTTPException(409, f"weights file missing on disk: {weights}")
    s = get_settings()
    s.WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    # Preserve .pt vs .onnx so Ultralytics loads the right format (nduka ships ONNX).
    ext = weights.suffix.lower() if weights.suffix else ".pt"
    if ext not in (".pt", ".onnx", ".engine", ".torchscript"):
        ext = ".pt"
    dest = s.WEIGHTS_DIR / f"ppe_active{ext}"
    for old in s.WEIGHTS_DIR.glob("ppe_active.*"):
        if old.resolve() != dest.resolve():
            try:
                old.unlink()
            except OSError:
                pass
    # Also clear legacy ACTIVE_WEIGHTS_NAME if different
    legacy = s.WEIGHTS_DIR / s.ACTIVE_WEIGHTS_NAME
    if legacy.resolve() != dest.resolve() and legacy.exists():
        try:
            legacy.unlink()
        except OSError:
            pass
    shutil.copy2(weights, dest)
    reg["active"] = version
    _save(reg)
    get_detector().reload()  # hot-swap: workers use the new model next frame
    return {"active": version, "weights": str(weights),
            "live_weights": get_detector().active_weights}


@router.get("")
async def list_models() -> dict:
    reg = _load()
    det = get_detector()
    return {
        "active": reg["active"],
        "live_weights": det.active_weights,
        "versions": [
            {
                "version": v["version"],
                "weights": v["weights"],
                "note": v.get("note", ""),
                "metrics": v.get("metrics", {}),
                "created": time.strftime("%Y-%m-%d %H:%M", time.localtime(v.get("ts", 0))),
                "is_active": v["version"] == reg["active"],
                "on_disk": Path(v["weights"]).exists(),
            }
            for v in sorted(reg["versions"], key=lambda x: -x["version"])
        ],
    }


@router.post("/{version}/activate")
async def activate(version: int) -> dict:
    return _activate(_load(), version)


@router.post("/rollback")
async def rollback() -> dict:
    reg = _load()
    ordered = sorted(v["version"] for v in reg["versions"])
    if reg["active"] not in ordered or ordered.index(reg["active"]) == 0:
        raise HTTPException(409, "no earlier version to roll back to")
    return _activate(reg, ordered[ordered.index(reg["active"]) - 1])


@router.post("/reload")
async def reload_weights() -> dict:
    get_detector().reload()
    return {"reloaded": True, "live_weights": get_detector().active_weights}


# ----------------------------------------------------------------- model zoo
@router.get("/zoo")
async def zoo_list() -> dict:
    """Catalog for the AI-Model dropdown."""
    from app.ml import model_zoo

    reg = _load()
    active_key = None
    for v in reg["versions"]:
        if v["version"] == reg.get("active"):
            active_key = v.get("zoo_key")
    return {"active_key": active_key, "models": model_zoo.catalog()}


@router.post("/zoo/{key}/select")
async def zoo_select(key: str) -> dict:
    """Download (if needed) + activate a catalog model.

    Heavy work (HF download + YOLO load) runs in a worker thread so video
    upload and other API calls stay responsive.
    """
    import asyncio
    from app.ml import model_zoo

    try:
        result = await asyncio.to_thread(model_zoo.select, key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # network / checksum / load errors
        raise HTTPException(502, f"could not activate '{key}': {e}")
    return {"selected": key, **result}


@router.post("/zoo/select-custom")
async def zoo_select_custom(path: str = Form(...)) -> dict:
    from app.ml import model_zoo

    try:
        result = model_zoo.select("custom-path", custom_path=path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"selected": "custom-path", **result}


@router.post("/upload")
async def upload_model(file: UploadFile = File(...),
                       activate: bool = Form(True)) -> dict:
    """Upload a .pt (e.g. your Colab-trained best.pt) and optionally activate.

    Security: a .pt is a pickle -- this loads code on activate. Only upload
    checkpoints you trust (your own training output)."""
    name = file.filename or "uploaded.pt"
    if not name.lower().endswith(".pt"):
        raise HTTPException(422, "only .pt checkpoints are accepted")
    s = get_settings()
    zoo = s.WEIGHTS_DIR / "zoo"
    zoo.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    dest = zoo / f"upload__{safe}"
    with open(dest, "wb") as f:
        f.write(await file.read())
    if not activate:
        return {"uploaded": str(dest), "activated": False}
    from app.ml import model_zoo

    try:
        result = model_zoo.select("upload", custom_path=str(dest))
    except Exception as e:
        raise HTTPException(502, f"uploaded but could not activate: {e}")
    return {"uploaded": str(dest), "activated": True, **result}
