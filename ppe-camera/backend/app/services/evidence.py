r"""
Evidence clips -- a 10-second animated GIF beside every violation still.

Why a moving clip and not just the JPEG
---------------------------------------
A still frame is thin evidence and it is the thing contractors dispute. It shows
one instant with no context: it cannot show that the worker had been bare-headed
for the whole approach rather than caught mid-way through putting a helmet on,
and it cannot show what they were doing. The argument "he had just taken it off
for a second" is unanswerable from one frame and obvious from ten seconds.

Why GIF specifically
--------------------
Because of where the evidence has to go. A GIF plays inline in a plain <img>,
in the Telegram and WhatsApp messages the alert service already sends, in an
email, and in a PDF export — with no player, no codec negotiation, and no
transcoding step that can fail on a machine where OpenCV could not open H.264.
The NVR module already keeps proper video for anyone who wants to scrub; this is
the copy that travels.

The cost is real and worth stating: GIF is 256 colours and has no interframe
compression, so ten seconds is measured in megabytes where the equivalent MP4 is
tens of kilobytes. That is why the defaults downscale hard (400 px wide, 5 fps)
and why this is capped rather than left to grow.

Where the frames come from
--------------------------
`live_view`'s ring buffer, which already holds the last 150 raw frames per
camera for the teach path. That buffer is populated on every inferred frame
whether or not recording is armed, so an evidence GIF does not require the NVR
to be switched on — and the frames are the RAW ones, not the annotated MJPEG, so
the clip shows the scene rather than our own overlay burnt into it.

The clip spans the event rather than starting at it. A violation is confirmed
several frames after it begins (the engine deliberately requires sustained
evidence), so a clip starting at the fire instant has already missed the
approach. Building it is therefore deferred: fire at T, wait for the post-roll,
then take T-5s..T+5s out of the ring.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger(__name__)


def _sample(entries: list, target: int) -> list:
    """Evenly thin a frame list down to `target` frames, keeping the ends."""
    if target <= 0 or len(entries) <= target:
        return entries
    step = len(entries) / target
    return [entries[min(len(entries) - 1, int(i * step))] for i in range(target)]


def build_gif(camera_id: str, centre_ts: float | None = None,
              seconds: float | None = None, out_path: Path | None = None,
              width: int | None = None, fps: float | None = None) -> dict:
    """Render an animated GIF around `centre_ts` from the live frame ring.

    Returns {ok, path, frames, seconds, bytes, reason}. Never raises: evidence
    enrichment must not be able to break the capture it is decorating.
    """
    s = get_settings()
    seconds = float(seconds or s.EVIDENCE_GIF_SECONDS)
    width = int(width or s.EVIDENCE_GIF_WIDTH)
    fps = float(fps or s.EVIDENCE_GIF_FPS)
    centre_ts = float(centre_ts or time.time())
    half = seconds / 2.0

    try:
        import cv2
        from PIL import Image

        from app.services import live_view

        with live_view._lock:                      # noqa: SLF001 - same package
            ring = list(live_view._ring.get(camera_id, ()))  # noqa: SLF001
        if not ring:
            return {"ok": False, "reason": "no buffered frames for this camera"}

        lo, hi = centre_ts - half, centre_ts + half
        window = [e for e in ring if lo <= e["ts"] <= hi]
        if len(window) < 2:
            # The ring may not span the requested window (a slow camera, or a
            # request made before the post-roll accumulated). Fall back to
            # whatever is nearest rather than returning nothing.
            window = sorted(ring, key=lambda e: abs(e["ts"] - centre_ts))[
                :max(2, int(seconds * fps))]
            window.sort(key=lambda e: e["ts"])
        if len(window) < 2:
            return {"ok": False, "reason": "not enough frames to animate"}

        frames = _sample(window, max(2, int(seconds * fps)))
        span = frames[-1]["ts"] - frames[0]["ts"]

        images = []
        for entry in frames:
            bgr = entry["frame"]
            h, w = bgr.shape[:2]
            if w > width:
                scale = width / float(w)
                bgr = cv2.resize(bgr, (width, max(2, int(h * scale))))
            images.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))

        if out_path is None:
            out_dir = Path(s.CAPTURES_DIR) / camera_id / "clips"
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{int(centre_ts * 1000)}.gif"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # Real elapsed time per frame, not the nominal rate: a camera running
        # below its requested fps would otherwise produce a clip that plays
        # faster than the event actually happened, which is exactly the kind of
        # distortion that makes evidence arguable.
        per_frame_ms = int(max(40.0, (span / max(1, len(frames) - 1)) * 1000))
        images[0].save(
            str(out_path), save_all=True, append_images=images[1:],
            duration=per_frame_ms, loop=0, optimize=True,
            # 128 colours rather than 256: on plant footage the difference is
            # invisible and the file is meaningfully smaller to send.
            colors=128,
        )
        size = out_path.stat().st_size
        return {"ok": True, "path": str(out_path), "frames": len(images),
                "seconds": round(span, 2), "bytes": size,
                "mb": round(size / 1024 ** 2, 2)}
    except Exception as exc:  # noqa: BLE001
        log.warning("could not build evidence gif for %s: %s", camera_id, exc)
        return {"ok": False, "reason": f"{type(exc).__name__}: {exc}"}


def schedule_for_capture(camera_id: str, capture_id: str,
                         centre_ts: float | None = None) -> None:
    """Build the clip after the post-roll has accumulated, then attach it.

    Deferred on a timer thread rather than built inline for two reasons. The
    obvious one is that GIF encoding takes hundreds of milliseconds and the
    caller is on the camera's capture path. The load-bearing one is that half
    the interesting footage has not happened yet: the clip is meant to span the
    event, so it cannot be built at the moment the event fires.
    """
    s = get_settings()
    if not s.EVIDENCE_GIF_ENABLED:
        return
    centre = float(centre_ts or time.time())
    delay = max(0.5, s.EVIDENCE_GIF_SECONDS / 2.0 + 0.5)

    def _work() -> None:
        result = build_gif(camera_id, centre_ts=centre)
        if not result.get("ok"):
            return
        try:
            from app.services import runtime

            loop = getattr(runtime, "_loop", None)
            if loop is None or loop.is_closed():
                return
            import asyncio

            asyncio.run_coroutine_threadsafe(
                _attach(capture_id, result["path"]), loop)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not attach clip to capture %s: %s", capture_id, exc)

    threading.Timer(delay, _work).start()


async def _attach(capture_id: str, path: str) -> None:
    try:
        from app.core.db import SessionLocal
        from app.models.review import CaptureItem

        async with SessionLocal() as session:
            item = await session.get(CaptureItem, capture_id)
            if item is None:
                return
            item.clip_path = path
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("could not store clip path for %s: %s", capture_id, exc)
