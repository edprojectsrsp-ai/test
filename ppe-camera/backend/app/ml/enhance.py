"""
Image enhancement stage -- runs on each frame before detection.

Industrial CCTV is often backlit, low-light, hazy (steel-plant dust/smoke), or
low-contrast. A light enhancement pass measurably lifts small-PPE recall. This
is deliberately cheap (per-frame, real-time) and OFF by default so it never
surprises anyone; enable per-camera or globally via PPE_ENHANCE=1.

Techniques (all optional, cv2-based, graceful no-op if cv2 missing):
  - CLAHE on the L channel (LAB)  -> local contrast without blowing highlights
  - optional gamma                -> lift shadows in dark frames
  - optional mild denoise         -> steel-plant sensor noise

Returns the SAME frame object type it was given (BGR numpy). On any failure it
returns the input untouched -- enhancement must never break the pipeline.
"""
from __future__ import annotations

import os


def _enabled() -> bool:
    return os.getenv("PPE_ENHANCE", "0") not in ("0", "", "false", "False")


def _gamma() -> float:
    try:
        return float(os.getenv("PPE_ENHANCE_GAMMA", "1.0"))
    except ValueError:
        return 1.0


def _denoise() -> bool:
    return os.getenv("PPE_ENHANCE_DENOISE", "0") not in ("0", "", "false", "False")


def enhance(frame):
    """CLAHE (+ optional gamma/denoise). No-op unless PPE_ENHANCE is set."""
    if not _enabled():
        return frame
    try:
        import cv2
        import numpy as np

        img = frame
        g = _gamma()
        if abs(g - 1.0) > 1e-3:
            inv = 1.0 / max(g, 1e-3)
            table = (np.array([(i / 255.0) ** inv for i in range(256)]) * 255).astype("uint8")
            img = cv2.LUT(img, table)

        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)

        if _denoise():
            img = cv2.fastNlMeansDenoisingColored(img, None, 3, 3, 7, 21)
        return img
    except Exception:
        return frame
