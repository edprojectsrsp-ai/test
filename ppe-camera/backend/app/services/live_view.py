"""
Live view -- annotated frames from worker threads to the browser.

Industry-style overlay (matches commercial PPE demos):
  - GREEN box + "Cap Found" / "Safety Jacket Found" chips on present gear
  - RED box + "Mask Not found" chips on missing required gear
  - Top banner with camera / mode / violation count

Workers publish latest annotated JPEG; stream router serves MJPEG.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Generator

from app.ml.taxonomy import DISPLAY_NAMES, GEAR_PAIRS, found_label, missing_label

_frames: dict[str, bytes] = {}
_meta: dict[str, dict] = {}
_lock = threading.Lock()

# BGR colors (OpenCV)
_RED = (60, 60, 230)
_GREEN = (80, 180, 80)
_GREEN_DARK = (40, 140, 40)
_RED_DARK = (40, 40, 200)
_WHITE = (255, 255, 255)
_BANNER_OK = (45, 55, 45)
_BANNER_BAD = (40, 40, 160)
# Amber == "we could not judge this". Distinct from red on purpose: a red box
# is an accusation a contractor can dispute, and it has to mean the system
# actually saw the absence.
_AMBER = (30, 150, 220)
_AMBER_DARK = (20, 110, 170)
_BANNER_AMBER = (25, 75, 110)


def _assessable(person, item: str, frame_w: int, frame_h: int, rule) -> tuple[bool, str]:
    """Can this person's `item` be judged at all in this frame?

    Delegates to the very same ViolationEngine gate that decides whether a
    violation may fire, so the picture and the alert log can never disagree.
    Falls back to permissive when no rule is supplied, preserving the old
    behaviour for any caller that has not been updated.
    """
    if rule is None:
        return True, ""
    try:
        from app.ml.violations import ViolationEngine

        return ViolationEngine(rule)._assessable(person, item, frame_w, frame_h)
    except Exception:
        return True, ""


def _center_in(person, box) -> bool:
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    return person[0] <= cx <= person[2] and person[1] <= cy <= person[3]


def _chip(out, text: str, x: int, y: int, bg, fg=_WHITE, scale=0.48, thickness=1):
    """Rounded-ish filled label chip (pill), clamped into frame. Returns bottom y used."""
    import cv2

    h, w = out.shape[:2]
    (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    pad_x, pad_y = 8, 5
    box_w, box_h = tw + pad_x * 2, th + pad_y * 2 + baseline
    # clamp
    x = max(2, min(x, w - box_w - 2))
    y = max(box_h + 2, min(y, h - 2))
    x1, y1 = x, y - box_h
    x2, y2 = x + box_w, y
    cv2.rectangle(out, (x1, y1), (x2, y2), bg, -1)
    # thin highlight border
    border = _GREEN_DARK if bg[1] > bg[2] else _RED_DARK
    cv2.rectangle(out, (x1, y1), (x2, y2), border, 1)
    cv2.putText(
        out, text, (x1 + pad_x, y2 - pad_y - baseline),
        cv2.FONT_HERSHEY_SIMPLEX, scale, fg, thickness, cv2.LINE_AA,
    )
    return y2


def _person_subbox(person_xyxy, zone: str):
    """Approximate head / face / torso / hands / feet boxes from person bbox."""
    x1, y1, x2, y2 = person_xyxy
    w, h = x2 - x1, y2 - y1
    if zone == "head":
        return (x1 + w * 0.2, y1, x2 - w * 0.2, y1 + h * 0.28)
    if zone == "face":
        return (x1 + w * 0.28, y1 + h * 0.12, x2 - w * 0.28, y1 + h * 0.38)
    if zone == "torso":
        return (x1 + w * 0.08, y1 + h * 0.28, x2 - w * 0.08, y1 + h * 0.78)
    if zone == "hands":
        return (x1, y1 + h * 0.45, x2, y1 + h * 0.75)
    if zone == "feet":
        return (x1 + w * 0.15, y1 + h * 0.82, x2 - w * 0.15, y2)
    return person_xyxy


_ZONE = {
    "helmet": "head", "mask": "face", "goggles": "face",
    "vest": "torso", "harness": "torso",
    "gloves": "hands", "boots": "feet",
}


def draw_overlay(frame, fr, mode: str, camera_id: str, required=None, rule=None):
    """Commercial-style PPE overlay on a BGR frame. Returns annotated copy.

    `rule` is the camera's live ZoneRule. Pass it: without it this function
    treats "no gear detected on this person" as "gear missing", which on a
    camera watching a slab 60 m away paints every 20-pixel worker red and puts
    "VIOLATIONS: 7" in the banner — while ViolationEngine, which does gate on
    assessability, fires nothing and sends no alert. Operators then reasonably
    conclude alerting is broken. PPE that cannot be judged is now drawn amber
    and labelled "n/a", and the banner counts only defensible violations.
    """
    import cv2

    required = list(required) if required else ["helmet", "vest"]
    # keep only known gear keys
    required = [r for r in required if r in GEAR_PAIRS]
    if not required:
        required = ["helmet", "vest"]

    out = frame.copy()
    persons = [d for d in fr.detections if d.cls_name == "person"]
    gear = [d for d in fr.detections if d.cls_name != "person"]

    # --- draw raw gear / hazard detections first ---
    for d in gear:
        x1, y1, x2, y2 = (int(v) for v in d.xyxy)
        neg = d.cls_name.startswith("no_")
        hazard = d.cls_name in ("smoking", "mobile_phone", "fire", "smoke", "fall")
        if hazard:
            cv2.rectangle(out, (x1, y1), (x2, y2), _RED, 2)
            _chip(out, d.cls_name.replace("_", " ").title() + "!", x1, y1, _RED)
        elif neg:
            # negative class from model — red "Not found" style
            gear_id = d.cls_name[3:]  # strip no_
            cv2.rectangle(out, (x1, y1), (x2, y2), _RED, 2)
            _chip(out, missing_label(gear_id), x1, max(y1, 24), _RED)
        else:
            # positive gear
            gear_id = d.cls_name
            if gear_id in GEAR_PAIRS:
                cv2.rectangle(out, (x1, y1), (x2, y2), _GREEN, 2)
                _chip(out, found_label(gear_id), x1, max(y1, 24), _GREEN)
            else:
                cv2.rectangle(out, (x1, y1), (x2, y2), _GREEN, 1)

    # --- per-person required-PPE checklist (headline signal) ---
    violations = 0
    unknown_people = 0

    for p in persons:
        px1, py1, px2, py2 = (int(v) for v in p.xyxy)
        missing: list[str] = []
        present: list[str] = []
        unsure: list[str] = []
        for item in required:
            ok, _why = _assessable(p, item, fr.width, fr.height, rule)
            has_pos = any(
                g.cls_name == item and _center_in(p.xyxy, g.xyxy) for g in gear
            )
            has_neg = any(
                g.cls_name == f"no_{item}" and _center_in(p.xyxy, g.xyxy) for g in gear
            )
            if has_pos and not has_neg:
                present.append(item)
            elif has_neg:
                missing.append(item)          # the model actually saw the absence
            elif ok:
                # Assessable and nothing found: on a model with no negative
                # class (SH17), absence on a clearly visible person is the
                # violation signal.
                missing.append(item)
            else:
                unsure.append(item)

        # person outline: red if a real violation, amber if we cannot tell
        if missing:
            violations += 1
            cv2.rectangle(out, (px1, py1), (px2, py2), _RED, 2)
        elif unsure:
            unknown_people += 1
            cv2.rectangle(out, (px1, py1), (px2, py2), _AMBER, 1)
        else:
            cv2.rectangle(out, (px1, py1), (px2, py2), _GREEN, 2)

        for item in unsure:
            bx1, by1, bx2, by2 = (int(v) for v in _person_subbox(p.xyxy, _ZONE.get(item, "torso")))
            _chip(out, f"{DISPLAY_NAMES.get(item, item.title())} n/a",
                  bx1 - 8, by1 + 4, _AMBER)

        # Found / Not found chips around the person (reference-style)
        side = 0
        for item in present:
            already = any(
                g.cls_name == item and _center_in(p.xyxy, g.xyxy) for g in gear
            )
            if already:
                continue
            bx1, by1, bx2, by2 = (int(v) for v in _person_subbox(p.xyxy, _ZONE.get(item, "torso")))
            cv2.rectangle(out, (bx1, by1), (bx2, by2), _GREEN, 2)
            lx = bx1 - 8 if side % 2 == 0 else bx2 + 4
            _chip(out, found_label(item), lx, by1 + 4, _GREEN)
            side += 1

        for item in missing:
            already_neg = any(
                g.cls_name == f"no_{item}" and _center_in(p.xyxy, g.xyxy) for g in gear
            )
            if not already_neg:
                bx1, by1, bx2, by2 = (int(v) for v in _person_subbox(p.xyxy, _ZONE.get(item, "torso")))
                cv2.rectangle(out, (bx1, by1), (bx2, by2), _RED, 2)
                lx = bx1 - 8 if side % 2 == 0 else max(4, bx2 - 120)
                _chip(out, missing_label(item), lx, by1 + 4, _RED)
            side += 1

    # --- top status banner ---
    h, w = out.shape[:2]
    banner_h = 28
    banner = _BANNER_BAD if violations else (_BANNER_AMBER if unknown_people
                                             else _BANNER_OK)
    cv2.rectangle(out, (0, 0), (w, banner_h), banner, -1)
    left = f"{camera_id}  |  {mode.upper()}  |  {time.strftime('%H:%M:%S')}"
    # "TOO FAR" is the honest headline when nobody is close enough to judge:
    # a green COMPLIANT banner over unassessable workers reads as an all-clear
    # that was never actually checked.
    if violations:
        right = f"VIOLATIONS: {violations}  ({len(persons)} person)"
    elif unknown_people:
        right = f"TOO FAR TO JUDGE: {unknown_people}  ({len(persons)} person)"
    else:
        right = f"COMPLIANT  ({len(persons)} person)"
    cv2.putText(out, left, (8, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.5, _WHITE, 1, cv2.LINE_AA)
    (rw, _), _ = cv2.getTextSize(right, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 2)
    cv2.putText(out, right, (max(8, w - rw - 10), 19), cv2.FONT_HERSHEY_SIMPLEX, 0.52, _WHITE, 2, cv2.LINE_AA)

    # required PPE legend strip (bottom)
    legend = "Required: " + ", ".join(found_label(r).replace(" Found", "") for r in required)
    (lw, lh), _ = cv2.getTextSize(legend, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
    cv2.rectangle(out, (0, h - 22), (min(w, lw + 16), h), (20, 20, 20), -1)
    cv2.putText(out, legend, (6, h - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (210, 210, 210), 1, cv2.LINE_AA)
    return out


def publish(camera_id: str, frame_bgr, meta: dict | None = None) -> None:
    """Encode + store the newest frame for a camera. Never raises."""
    try:
        import cv2

        ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 84])
        if not ok:
            return
        with _lock:
            _frames[camera_id] = buf.tobytes()
            _meta[camera_id] = {**(meta or {}), "ts": time.time()}
    except Exception:
        pass


def latest(camera_id: str) -> bytes | None:
    with _lock:
        return _frames.get(camera_id)


# --- live-teach state -------------------------------------------------------
# The RAW frame + this frame's detections, kept alongside the annotated JPEG.
# Live Teach needs both: clickable boxes must be the model's actual output
# (not pixels burnt into the stream), and a correction must be saved on a
# clean image or the training set learns to detect our own red rectangles.
_state: dict[str, dict] = {}
_frame_seq: dict[str, int] = {}

# A short history of recent frames, not just the newest one. Teaching used to
# read `_state` alone, so the camera overwrote the frame while the operator was
# still looking at it: by the time they clicked, the stored frame had moved on
# and the correction was either refused or — worse, before the frame_id guard —
# silently attached to a different scene. With a ring buffer the click always
# resolves to the exact frame that was on screen.
#
# 150 frames is ~25 s at the 6 fps default and ~5 s at 30 fps, which is longer
# than anyone spends deciding whether a worker is wearing a helmet. Memory is
# bounded per camera: a 1280x720 BGR frame is 2.6 MB, so a camera holds at most
# ~400 MB at full HD — hence the downscale below.
_RING_MAX = 150
_ring: dict[str, deque] = {}
# Frames an operator has explicitly pinned while a teach dialog is open. Pinned
# frames survive eviction so a slow decision cannot lose the evidence.
_pinned: dict[tuple[str, int], dict] = {}
_PIN_TTL_S = 600.0


def publish_state(camera_id: str, frame_bgr, fr) -> None:
    """Store the raw frame + detections for teach/flag. Never raises."""
    try:
        seq = _frame_seq.get(camera_id, 0) + 1
        _frame_seq[camera_id] = seq
        dets = [{
            "cls": d.cls_name, "raw": d.raw_name,
            "conf": round(float(d.confidence), 3),
            "xyxy": [round(float(v), 1) for v in d.xyxy],
            "track_id": d.track_id,
        } for d in fr.detections]
        entry = {
            "frame_id": seq,
            "frame": frame_bgr.copy(),
            "detections": dets,
            "width": int(fr.width), "height": int(fr.height),
            "ts": time.time(),
        }
        with _lock:
            _state[camera_id] = entry
            ring = _ring.get(camera_id)
            if ring is None:
                ring = _ring[camera_id] = deque(maxlen=_RING_MAX)
            ring.append(entry)
    except Exception:
        pass


def live_state(camera_id: str) -> dict | None:
    with _lock:
        return _state.get(camera_id)


def frame_state(camera_id: str, frame_id: int | None) -> dict | None:
    """The exact frame `frame_id`, from the pins or the ring. None if gone.

    Falls back to the newest frame when no id is asked for, so callers that
    genuinely want "whatever is on screen now" keep working.
    """
    if frame_id is None:
        return live_state(camera_id)
    with _lock:
        pinned = _pinned.get((camera_id, int(frame_id)))
        if pinned is not None:
            return pinned
        for entry in reversed(_ring.get(camera_id, ())):
            if entry["frame_id"] == int(frame_id):
                return entry
    return None


def pin_frame(camera_id: str, frame_id: int | None = None) -> dict | None:
    """Hold a frame against eviction while an operator labels it.

    Returns the pinned entry. Expired pins are swept on every call rather than
    by a timer: pinning is rare and operator-driven, so a background thread to
    tidy up after it would be more machinery than the problem deserves.
    """
    entry = frame_state(camera_id, frame_id)
    if entry is None:
        return None
    now = time.time()
    with _lock:
        for key, pinned in list(_pinned.items()):
            if now - pinned.get("pinned_at", now) > _PIN_TTL_S:
                _pinned.pop(key, None)
        pinned = dict(entry)
        pinned["pinned_at"] = now
        _pinned[(camera_id, int(entry["frame_id"]))] = pinned
    return pinned


def unpin_frame(camera_id: str, frame_id: int) -> bool:
    with _lock:
        return _pinned.pop((camera_id, int(frame_id)), None) is not None


def latest_meta(camera_id: str) -> dict:
    with _lock:
        return dict(_meta.get(camera_id, {}))


def mjpeg(camera_id: str, fps: float = 10.0, stale_after: float = 10.0) -> Generator[bytes, None, None]:
    """Yield an MJPEG multipart stream of the camera's latest frames."""
    boundary = b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
    period = 1.0 / max(1.0, fps)
    last_sent: bytes | None = None
    started = time.time()
    while True:
        buf = latest(camera_id)
        if buf is None:
            if time.time() - started > stale_after:
                return
            time.sleep(0.2)
            continue
        if buf is not last_sent:
            yield boundary + str(len(buf)).encode() + b"\r\n\r\n" + buf + b"\r\n"
            last_sent = buf
        time.sleep(period)
