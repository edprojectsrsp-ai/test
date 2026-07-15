"""dataset_registry.py -- curated public PPE datasets + a safe downloader.

This is the "Public Datasets" arm of the Master Dataset Architecture. It holds a
manifest of the well-known public PPE/construction-safety datasets and knows how
to pull each one -- via Roboflow (API key), Kaggle (kaggle.json), or a direct
URL -- into a common downloads/ folder ready for merge + quality audit.

Why a manifest instead of hardcoded downloads:
- Most of these datasets require credentials (Roboflow workspace key, Kaggle
  token) and are gigabytes. We NEVER auto-pull multi-GB data without the
  operator explicitly asking and providing creds. `list` and `plan` are always
  safe/offline; `fetch` only reaches the network when you name a dataset AND the
  needed credential is present, else it prints exactly what to set and skips.

Usage:
    python dataset_registry.py list
    python dataset_registry.py plan   --all
    python dataset_registry.py fetch  --name construction-ppe --out data/downloads
    python dataset_registry.py fetch  --name sh17 --out data/downloads   # needs KAGGLE creds
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class DatasetSpec:
    name: str
    source: str                      # "roboflow" | "kaggle" | "url"
    ref: str                         # rf: "workspace/project/version" | kaggle slug | URL
    classes_hint: list[str] = field(default_factory=list)
    approx_images: int = 0
    license: str = "see source"
    note: str = ""
    needs_env: list[str] = field(default_factory=list)


# The public arm of your Master Dataset diagram. Extend freely.
REGISTRY: list[DatasetSpec] = [
    DatasetSpec(
        "sh17", "kaggle", "mugheesahmad/sh17-dataset-for-ppe-detection",
        classes_hint=["person", "head", "helmet", "vest", "gloves", "glasses",
                      "boots", "mask", "ear-protection"],
        approx_images=8099, license="research-use (see Kaggle)",
        note="17-class human safety dataset (SH17).", needs_env=["KAGGLE_USERNAME", "KAGGLE_KEY"],
    ),
    DatasetSpec(
        "construction-ppe", "roboflow", "roboflow-universe/construction-site-safety/1",
        classes_hint=["helmet", "no-helmet", "vest", "no-vest", "person"],
        approx_images=3200, license="CC BY 4.0 (varies)",
        note="Construction-Safety / hardhat-vest.", needs_env=["ROBOFLOW_API_KEY"],
    ),
    DatasetSpec(
        "chvg", "roboflow", "roboflow-universe/chvg-color-helmet-vest-glove/1",
        classes_hint=["helmet", "vest", "gloves", "goggles"],
        approx_images=1500, license="see source",
        note="Color-Helmet-Vest-Glove (CHVG).", needs_env=["ROBOFLOW_API_KEY"],
    ),
    DatasetSpec(
        "shel5k", "url", "https://github.com/ciber-lab/pictor-ppe",  # placeholder ref
        classes_hint=["helmet", "head", "person", "vest"],
        approx_images=5000, license="academic",
        note="SHEL5K safety-helmet dataset.", needs_env=[],
    ),
    DatasetSpec(
        "pictor-ppe", "url", "https://github.com/ciber-lab/pictor-ppe",
        classes_hint=["worker", "helmet", "vest"],
        approx_images=1500, license="academic",
        note="Pictor-PPE crowdsourced construction images.", needs_env=[],
    ),
    DatasetSpec(
        "roboflow-hardhat", "roboflow", "roboflow-universe/hard-hat-workers/2",
        classes_hint=["helmet", "head", "person"],
        approx_images=7000, license="Public Domain",
        note="Hard Hat Workers (Northeastern SMV).", needs_env=["ROBOFLOW_API_KEY"],
    ),
]

BY_NAME = {d.name: d for d in REGISTRY}


def _env_missing(spec: DatasetSpec) -> list[str]:
    return [e for e in spec.needs_env if not os.environ.get(e)]


# ------------------------------------------------------------------ fetchers
def _fetch_roboflow(spec: DatasetSpec, out_dir: str) -> dict:
    try:
        from roboflow import Roboflow
    except Exception:
        return {"ok": False, "reason": "pip install roboflow"}
    try:
        ws, proj, ver = spec.ref.split("/")
        rf = Roboflow(api_key=os.environ["ROBOFLOW_API_KEY"])
        dataset = rf.workspace(ws).project(proj).version(int(ver)).download(
            "yolov11", location=os.path.join(out_dir, spec.name)
        )
        return {"ok": True, "location": getattr(dataset, "location", out_dir)}
    except Exception as e:
        return {"ok": False, "reason": f"roboflow error: {e}"}


def _fetch_kaggle(spec: DatasetSpec, out_dir: str) -> dict:
    try:
        import kaggle  # noqa: F401
    except Exception:
        return {"ok": False, "reason": "pip install kaggle (and set KAGGLE creds)"}
    dest = os.path.join(out_dir, spec.name)
    os.makedirs(dest, exist_ok=True)
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi

        api = KaggleApi()
        api.authenticate()
        api.dataset_download_files(spec.ref, path=dest, unzip=True)
        return {"ok": True, "location": dest}
    except Exception as e:
        return {"ok": False, "reason": f"kaggle error: {e}"}


def _fetch_url(spec: DatasetSpec, out_dir: str) -> dict:
    # We deliberately do NOT auto-clone/large-download. Point the operator at it.
    return {"ok": False, "reason": f"manual: obtain from {spec.ref} and unpack into {out_dir}/{spec.name}"}


def fetch(name: str, out_dir: str) -> dict:
    spec = BY_NAME.get(name)
    if spec is None:
        return {"ok": False, "reason": f"unknown dataset '{name}'. Known: {sorted(BY_NAME)}"}
    missing = _env_missing(spec)
    if missing:
        return {"ok": False, "reason": f"set env {missing} first (credentials for {spec.source})"}
    os.makedirs(out_dir, exist_ok=True)
    if spec.source == "roboflow":
        return _fetch_roboflow(spec, out_dir)
    if spec.source == "kaggle":
        return _fetch_kaggle(spec, out_dir)
    return _fetch_url(spec, out_dir)


def plan(names: Optional[list[str]] = None) -> list[dict]:
    specs = REGISTRY if not names else [BY_NAME[n] for n in names if n in BY_NAME]
    out = []
    for s in specs:
        out.append({
            **asdict(s),
            "credentials_ready": not _env_missing(s),
            "missing_env": _env_missing(s),
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Public PPE dataset registry + downloader")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("plan")
    p.add_argument("--all", action="store_true")
    p.add_argument("--name", nargs="*", default=None)
    f = sub.add_parser("fetch")
    f.add_argument("--name", required=True)
    f.add_argument("--out", default="data/downloads")

    args = ap.parse_args()
    if args.cmd == "list":
        for s in REGISTRY:
            ready = "READY" if not _env_missing(s) else f"needs {_env_missing(s)}"
            print(f"{s.name:20s} {s.source:9s} ~{s.approx_images:>6} imgs  [{ready}]  {s.note}")
    elif args.cmd == "plan":
        names = None if args.all else args.name
        print(json.dumps(plan(names), indent=2))
    elif args.cmd == "fetch":
        print(json.dumps(fetch(args.name, args.out), indent=2))


if __name__ == "__main__":
    main()
