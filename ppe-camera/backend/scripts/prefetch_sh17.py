"""Pre-download an SH17 checkpoint and confirm it loads + reports PPE classes.

Downloads only — it does NOT activate. Selecting the model in the AI Model
dropdown is still the operator's call; this just means the first click is
instant instead of a 40 MB wait, and proves the URL and the checkpoint are
good before anyone is relying on it live.

Run:  PYTHONPATH=. .venv/Scripts/python.exe scripts/prefetch_sh17.py [key]
"""
from __future__ import annotations

import sys

from app.ml import model_zoo

key = sys.argv[1] if len(sys.argv) > 1 else "sh17-yolo9m"
print(f"downloading {key} …")
path = model_zoo.ensure_downloaded(key)
print(f"  -> {path}  ({path.stat().st_size / 1e6:.1f} MB)")

from ultralytics import YOLO

names = YOLO(str(path)).names
print(f"  classes ({len(names)}): {sorted(names.values())}")

from app.ml import taxonomy

mapped = {n: taxonomy.canon(n) for n in names.values()}
ppe = {k: v for k, v in mapped.items() if v}
print(f"  mapped to canonical PPE: {ppe}")
print(f"  ignored (non-PPE): {sorted(k for k, v in mapped.items() if not v)}")
