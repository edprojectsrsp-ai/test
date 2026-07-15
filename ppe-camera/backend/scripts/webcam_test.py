#!/usr/bin/env python
"""
Live webcam PPE test -- the fastest way to SEE the system work on CPU.

Opens your webcam, runs YOLO11 + tracking on each frame, draws boxes, and
prints when a violation fires. No server, no dashboard needed -- just proves
the detection + violation pipeline on real video from your laptop camera.

Usage:
    python scripts/webcam_test.py                 # default camera, require helmet+vest
    python scripts/webcam_test.py --require helmet
    python scripts/webcam_test.py --index 1       # external USB cam
    python scripts/webcam_test.py --no-window     # headless, prints only

Press 'q' in the window to quit.

Note: on CPU with yolo11m this runs a few FPS -- fine for testing. Drop to
yolo11n (PPE_BASE_WEIGHTS=yolo11n.pt) for a faster, less accurate check.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=int, default=0, help="webcam index")
    ap.add_argument("--require", nargs="+", default=["helmet", "vest"],
                    help="required PPE items")
    ap.add_argument("--no-window", action="store_true", help="headless mode")
    args = ap.parse_args()

    try:
        import cv2
    except ImportError:
        print("opencv not installed. Run: pip install -r requirements.txt")
        return 1

    from app.core.config import get_settings
    from app.ml.detector import get_detector
    from app.ml.violations import ViolationEngine, ZoneRule
    from app.ml import taxonomy

    s = get_settings()
    print(f"device: {s.DEVICE} | weights: {s.BASE_WEIGHTS}")
    print(f"required PPE: {args.require}")
    print("loading model (first run downloads weights)...")

    detector = get_detector()
    engine = ViolationEngine(ZoneRule(required=set(args.require)))

    cap = cv2.VideoCapture(args.index)
    if not cap.isOpened():
        print(f"ERROR: could not open webcam index {args.index}")
        return 1

    # color per class family: gear = green, violation = red, person = cyan
    def color_for(cls_name: str):
        if cls_name in taxonomy.VIOLATION_CLASSES:
            return (0, 0, 255)          # red (BGR)
        if cls_name == "person":
            return (255, 200, 0)        # cyan-ish
        return (0, 200, 0)              # green

    print("running -- press 'q' to quit\n")
    frames = 0
    t0 = time.time()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames += 1

            result = detector.infer(frame, track=True)
            for d in result.detections:
                x1, y1, x2, y2 = (int(v) for v in d.xyxy)
                c = color_for(d.cls_name)
                cv2.rectangle(frame, (x1, y1), (x2, y2), c, 2)
                label = f"{d.cls_name} {d.confidence:.2f}"
                cv2.putText(frame, label, (x1, max(0, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, c, 1, cv2.LINE_AA)

            for fired in engine.update(result):
                tid = f" track {fired.track_id}" if fired.track_id is not None else ""
                print(f"[VIOLATION] missing {fired.gear}{tid} "
                      f"(conf {fired.confidence:.2f})")

            if not args.no_window:
                fps = frames / (time.time() - t0)
                cv2.putText(frame, f"{fps:.1f} FPS  device={s.DEVICE}",
                            (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                            (255, 255, 255), 2, cv2.LINE_AA)
                cv2.imshow("PPE test (press q to quit)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()

    dt = time.time() - t0
    print(f"\nprocessed {frames} frames in {dt:.1f}s "
          f"({frames/dt:.1f} FPS avg on {s.DEVICE})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

