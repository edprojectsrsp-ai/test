#!/usr/bin/env python
"""
First-run helper. Run ONCE on the machine that will do inference.

What it does:
  1. Detects your device (CUDA / MPS / CPU) and prints it.
  2. Downloads the YOLO11 base weights (yolo11m.pt) via Ultralytics.
  3. Runs a tiny sanity inference on a blank frame to confirm the stack works.

It does NOT fine-tune anything -- the base model already detects 'person'
(from COCO). To detect PPE classes, follow the training path in the README
using a public PPE dataset + your own reviewed captures.

Usage:
    python scripts/first_run.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    from app.core.config import get_settings

    s = get_settings()
    print(f"device detected : {s.DEVICE}")
    print(f"base weights    : {s.BASE_WEIGHTS}")
    print(f"weights dir     : {s.WEIGHTS_DIR}")

    try:
        from ultralytics import YOLO
    except ImportError:
        print("\nultralytics not installed. Run: pip install -r requirements.txt")
        return 1

    print("\nloading base weights (downloads on first use)...")
    model = YOLO(s.BASE_WEIGHTS)

    import numpy as np

    frame = np.zeros((s.IMG_SIZE, s.IMG_SIZE, 3), dtype="uint8")
    print("running sanity inference on a blank frame...")
    res = model.predict(frame, device=s.DEVICE, verbose=False)
    print(f"OK -- model ran, {len(res[0].boxes)} boxes on blank frame (expected 0).")
    print("\nStack is working. Start the API with:")
    print("    uvicorn app.main:app --reload --port 8000")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

