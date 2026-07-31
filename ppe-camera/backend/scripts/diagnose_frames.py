"""Run one or more checkpoints over real captured frames and report, per person,
whether their cap and jacket were actually seen.

This exists to answer a specific field question: "is the orange jacket / yellow
helmet actually being detected, or is the system just calling everyone a
violation?" It prints person height in pixels alongside the verdict, because
that is usually the answer — PPE on a 30 px figure is not assessable by any
model, and a violation engine that reports one anyway is guessing.

Run:
  PYTHONPATH=. .venv/Scripts/python.exe scripts/diagnose_frames.py <img> [img...]
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2

from app.core.config import get_settings
from app.ml import taxonomy
from app.ml.violations import ViolationEngine, ZoneRule

MODELS = {
    "voxdroid (old)": "zoo/voxdroid-enterprise.pt",
    "SH17 v9-m (new)": "zoo/sh17-yolo9m.pt",
}
REQUIRED = {"helmet", "vest"}


def run(weights: Path, frame, imgsz: int) -> list:
    from ultralytics import YOLO

    s = get_settings()
    res = YOLO(str(weights)).predict(
        frame, conf=s.CONF_THRESHOLD, iou=s.IOU_THRESHOLD,
        imgsz=imgsz, device=s.DEVICE, verbose=False)[0]
    out = []
    if res.boxes is None:
        return out
    for b in res.boxes:
        raw = res.names[int(b.cls)]
        out.append((taxonomy.canon(raw) or raw, raw, float(b.conf),
                    tuple(float(v) for v in b.xyxy[0].tolist())))
    return out


def report(name: str, dets: list, h: int) -> None:
    people = [d for d in dets if d[0] == "person"]
    gear = [d for d in dets if d[0] != "person"]
    kinds: dict[str, int] = {}
    for d in gear:
        kinds[d[0]] = kinds.get(d[0], 0) + 1
    print(f"    {name:18s} persons={len(people):<3} gear={kinds or '{}'}")

    if not people:
        return
    heights = sorted(int(p[3][3] - p[3][1]) for p in people)
    print(f"      person heights px: {heights}  (frame {h}px)")

    # Feed the real engine so assessability gating is what production applies.
    from app.ml.detector import Detection, FrameResult

    fr = FrameResult(width=0, height=h)
    fr.width = 1
    for cls, raw, conf, xyxy in dets:
        fr.detections.append(Detection(cls, raw, conf, xyxy))
    fr.width = max(int(d[3][2]) for d in dets) if dets else 0
    engine = ViolationEngine(ZoneRule(required=set(REQUIRED)))
    engine.update(fr)
    tally: dict[str, int] = {}
    for a in engine.last_assessments:
        tally[f"{a.gear}:{a.state}"] = tally.get(f"{a.gear}:{a.state}", 0) + 1
    for k in sorted(tally):
        print(f"      {k:26s} x{tally[k]}")


def main() -> None:
    s = get_settings()
    imgsz_list = [int(s.IMG_SIZE)]
    if s.IMG_SIZE != 960:
        imgsz_list.append(960)     # what a distant-camera feed actually needs

    for img_path in sys.argv[1:]:
        frame = cv2.imread(img_path)
        if frame is None:
            print(f"!! could not read {img_path}")
            continue
        h, w = frame.shape[:2]
        print(f"\n=== {Path(img_path).name}  ({w}x{h}) ===")
        for label, rel in MODELS.items():
            wpath = s.WEIGHTS_DIR / rel
            if not wpath.exists():
                print(f"    {label:18s} (not downloaded)")
                continue
            for imgsz in imgsz_list:
                dets = run(wpath, frame, imgsz)
                report(f"{label} @{imgsz}", dets, h)


if __name__ == "__main__":
    main()
