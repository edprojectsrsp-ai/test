"""
SAHI-style sliced inference -- recover SMALL PPE that full-frame YOLO misses.

Gloves, goggles and distant helmets are tiny in a wide CCTV view; downscaling
to 640 erases them. Slicing Aided Hyper Inference tiles the frame, runs the
detector per tile at full effective resolution, remaps boxes to frame space and
merges overlaps with NMS.

Design:
  - Model-agnostic. The caller passes `predict_tile(sub_bgr) -> list[RawBox]`,
    so the tiling + merge logic is unit-testable WITHOUT YOLO/torch, and the
    detector wires the real model in.
  - Optional full-frame pass fused with tiles (SAHI's standard trick) to keep
    large, obvious detections that a small tile might clip.
  - Pure geometry; only needs numpy for the frame slice (BGR ndarray in).

Tracking note: SAHI produces per-frame detections without stable track ids, so
it is used in `predict` mode. ByteTrack/BoT-SORT run on the full-frame path.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RawBox:
    cls_name: str
    raw_name: str
    confidence: float
    xyxy: tuple[float, float, float, float]


def compute_slices(width: int, height: int, slice_size: int = 640,
                   overlap: float = 0.2) -> list[tuple[int, int, int, int]]:
    """Return tile rectangles (x0,y0,x1,y1) covering the frame with overlap."""
    if width <= slice_size and height <= slice_size:
        return [(0, 0, width, height)]
    step = max(1, int(slice_size * (1.0 - overlap)))
    xs = list(range(0, max(1, width - slice_size + 1), step))
    ys = list(range(0, max(1, height - slice_size + 1), step))
    if not xs or xs[-1] + slice_size < width:
        xs.append(max(0, width - slice_size))
    if not ys or ys[-1] + slice_size < height:
        ys.append(max(0, height - slice_size))
    tiles = []
    for y in sorted(set(ys)):
        for x in sorted(set(xs)):
            tiles.append((x, y, min(x + slice_size, width), min(y + slice_size, height)))
    return tiles


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    denom = area_a + area_b - inter
    return inter / denom if denom > 0 else 0.0


def nms_merge(boxes: list[RawBox], iou_thresh: float = 0.5) -> list[RawBox]:
    """Class-aware greedy NMS over merged tile detections."""
    kept: list[RawBox] = []
    for b in sorted(boxes, key=lambda d: d.confidence, reverse=True):
        if all(not (k.cls_name == b.cls_name and _iou(k.xyxy, b.xyxy) > iou_thresh)
               for k in kept):
            kept.append(b)
    return kept


def sliced_predict(frame, predict_tile, slice_size: int = 640, overlap: float = 0.2,
                   include_full_frame: bool = True, iou_thresh: float = 0.5) -> list[RawBox]:
    """
    Run `predict_tile(sub_bgr_frame) -> list[RawBox]` over slices, remap to frame
    coordinates, optionally add a full-frame pass, and NMS-merge.
    """
    h, w = frame.shape[:2]
    tiles = compute_slices(w, h, slice_size, overlap)
    merged: list[RawBox] = []

    for (x0, y0, x1, y1) in tiles:
        sub = frame[y0:y1, x0:x1]
        for rb in predict_tile(sub):
            bx0, by0, bx1, by1 = rb.xyxy
            merged.append(RawBox(
                rb.cls_name, rb.raw_name, rb.confidence,
                (bx0 + x0, by0 + y0, bx1 + x0, by1 + y0),
            ))

    if include_full_frame and (w > slice_size or h > slice_size):
        for rb in predict_tile(frame):
            merged.append(rb)

    return nms_merge(merged, iou_thresh)
