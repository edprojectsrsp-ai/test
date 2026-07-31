r"""
NVR / DVR onboarding -- add a recorder once, get every camera behind it.

On a real plant nobody hands you sixteen IP addresses. They hand you one NVR on
the site network with sixteen analogue or IP cameras hanging off it, and every
channel is reachable at the same host on the same RTSP port with only the
channel number changing. Adding those one at a time through the single-camera
form means typing the same credentials sixteen times and getting the brand's
path scheme right sixteen times.

This module does the enumeration instead:

    scan(...)      build the per-channel RTSP URL for a brand, probe each one
                   in parallel, and report which channels actually carry video
    plan(...)      turn the responsive channels into ready-to-add camera configs

Probing is parallel and bounded. A sixteen-channel sweep at eight seconds per
channel is over two minutes serially, which no operator waits through; run with
a small thread pool it is a handful of seconds, and a dead channel costs the
timeout only once rather than delaying every channel after it.

Nothing here imports torch/YOLO — it reuses camera_connect's URL builder and
probe, so a scan works on a machine with no model loaded.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from app.services.camera_connect import BRAND_TEMPLATES, build_rtsp_url, probe_source

log = logging.getLogger(__name__)

# Sub-stream by default when importing a whole recorder: sixteen 1080p main
# streams is ~80 Mbps and more decode than any single box has. The sub stream is
# typically 640x480 and plenty for PPE at gate distances; per-camera main-stream
# upgrades are a later, deliberate choice.
DEFAULT_IMPORT_STREAM = "sub"


def _channel_url(brand: str, host: str, username: str, password: str,
                 port: int | None, channel: int, stream: str, path: str) -> dict:
    return build_rtsp_url(
        brand=brand, host=host, username=username, password=password,
        port=port, channel=channel, stream=stream, path=path,
    )


def scan(
    brand: str,
    host: str,
    username: str = "",
    password: str = "",
    port: int | None = None,
    channels: int = 8,
    stream: str = DEFAULT_IMPORT_STREAM,
    path: str = "",
    timeout: float = 6.0,
    workers: int = 6,
) -> dict:
    """Probe channels 1..N of one recorder. Never raises.

    Returns {brand, host, stream, channels: [...], found, tested}. Each channel
    entry carries the masked URL so the response can be logged or shown without
    leaking the password.
    """
    brand = (brand or "generic").lower()
    if brand not in BRAND_TEMPLATES:
        brand = "generic"
    channels = max(1, min(64, int(channels or 8)))
    timeout = max(2.0, min(20.0, float(timeout or 6.0)))
    workers = max(1, min(16, int(workers or 6)))

    def _one(ch: int) -> dict:
        try:
            built = _channel_url(brand, host, username, password, port, ch,
                                 stream, path)
        except ValueError as e:
            return {"channel": ch, "ok": False, "error": str(e), "url": "",
                    "masked": ""}
        res = probe_source("rtsp", {"url": built["url"], "transport": "tcp"},
                           timeout=timeout)
        return {
            "channel": ch,
            "ok": bool(res.get("ok")),
            "width": res.get("width"),
            "height": res.get("height"),
            "latency_ms": res.get("latency_ms"),
            "error": res.get("error"),
            "url": built["url"],
            "masked": built["masked"],
            "path": built["path"],
            "port": built["port"],
        }

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(_one, range(1, channels + 1)))

    found = [r for r in results if r["ok"]]
    return {
        "brand": brand,
        "host": host,
        "stream": stream,
        "tested": len(results),
        "found": len(found),
        "channels": results,
        "hint": (
            f"{len(found)} of {len(results)} channels responded. Empty channels "
            "usually mean no camera is connected there — or that this brand uses "
            "a different path scheme, in which case try 'generic' with the exact "
            "RTSP path from the recorder's web UI."
        ),
    }


def plan(
    device_id: str,
    brand: str,
    host: str,
    channels: list[dict],
    username: str = "",
    password: str = "",
    port: int | None = None,
    stream: str = DEFAULT_IMPORT_STREAM,
    path: str = "",
    required_ppe: list[str] | None = None,
    fps_limit: float = 4.0,
    transport: str = "tcp",
) -> list[dict]:
    """Turn chosen channels into camera configs, without adding them.

    Kept separate from the add so the API can report exactly what it is about
    to create — importing sixteen cameras is not something to discover after
    the fact.

    fps_limit defaults lower than a single camera's: sixteen channels all
    demanding 6 fps is 96 inferences a second, which no single detector serves.
    The inference budget would throttle them anyway; asking for a realistic rate
    up front means the skip counters stay clean and the operator is not told the
    system is dropping frames it never had capacity for.
    """
    required_ppe = list(required_ppe or ["helmet", "vest"])
    out: list[dict] = []
    for ch in channels:
        num = int(ch.get("channel") or 0)
        if num <= 0:
            continue
        url = ch.get("url") or _channel_url(
            brand, host, username, password, port, num, stream, path)["url"]
        camera_id = ch.get("camera_id") or f"{device_id}-ch{num:02d}"
        out.append({
            "camera_id": camera_id,
            "channel": num,
            "source_kind": "rtsp",
            "source_kwargs": {"url": url, "transport": transport},
            "required_ppe": required_ppe,
            "fps_limit": float(fps_limit),
            "name": ch.get("name") or f"{device_id} channel {num}",
        })
    return out
