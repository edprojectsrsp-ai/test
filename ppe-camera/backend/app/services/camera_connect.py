"""
Comprehensive camera connectivity helpers.

Three jobs, all independent of the heavy ML stack so they stay easy to test:

  1. build_rtsp_url(...)  -- turn brand + host + credentials + channel/stream
                             into the correct RTSP URL. Every major CCTV brand
                             uses a different path scheme; operators should not
                             have to memorise them.
  2. probe_source(...)    -- open ANY source kind, grab one frame with a hard
                             timeout, report {ok, width, height, latency_ms,
                             error}. This is the "test before you add" path.
  3. discover_onvif(...)  -- WS-Discovery sweep of the LAN for ONVIF cameras.

Nothing here imports torch/YOLO. probe_source lazily builds a FrameSource via
the existing factory, so it works for rtsp / onvif / webcam / video / screen.
"""
from __future__ import annotations

import time
from urllib.parse import quote


# ---------------------------------------------------------------------------
# 1. Brand RTSP URL templates
# ---------------------------------------------------------------------------
# {u}=user {p}=password (already URL-encoded) {h}=host {port}=port
# {ch}=channel number  {s1}=stream token for "main"/"sub" per that brand.
# Paths are the well-published defaults; the UI always shows the result as an
# editable field so odd firmware can be corrected by hand.

BRAND_TEMPLATES: dict[str, dict] = {
    "hikvision": {
        "label": "Hikvision",
        "default_port": 554,
        "main": "/Streaming/Channels/{ch}01",
        "sub": "/Streaming/Channels/{ch}02",
        "note": "Also covers most Hikvision OEM DVR/NVRs.",
    },
    "dahua": {
        "label": "Dahua",
        "default_port": 554,
        "main": "/cam/realmonitor?channel={ch}&subtype=0",
        "sub": "/cam/realmonitor?channel={ch}&subtype=1",
        "note": "Dahua NVR/IPC scheme.",
    },
    "cpplus": {
        "label": "CP Plus",
        "default_port": 554,
        "main": "/cam/realmonitor?channel={ch}&subtype=0",
        "sub": "/cam/realmonitor?channel={ch}&subtype=1",
        "note": "CP Plus is Dahua-OEM — same path scheme.",
    },
    "uniview": {
        "label": "Uniview (UNV)",
        "default_port": 554,
        "main": "/unicast/c{ch}/s0/live",
        "sub": "/unicast/c{ch}/s1/live",
        "note": "Older UNV firmware uses /media/video1 — edit if needed.",
    },
    "axis": {
        "label": "Axis",
        "default_port": 554,
        "main": "/axis-media/media.amp",
        "sub": "/axis-media/media.amp?resolution=640x480",
        "note": "Channel ignored; single stream endpoint.",
    },
    "bosch": {
        "label": "Bosch",
        "default_port": 554,
        "main": "/rtsp_tunnel?inst={ch}",
        "sub": "/rtsp_tunnel?inst={ch}&h26x=4",
        "note": "Bosch encoder tunnel.",
    },
    "honeywell": {
        "label": "Honeywell",
        "default_port": 554,
        "main": "/stream{ch}",
        "sub": "/stream{ch}sub",
        "note": "Varies by series — verify with Test.",
    },
    "hanwha": {
        "label": "Hanwha / Wisenet",
        "default_port": 554,
        "main": "/profile2/media.smp",
        "sub": "/profile3/media.smp",
        "note": "Wisenet profile-based media endpoints.",
    },
    "generic": {
        "label": "Generic / ONVIF path",
        "default_port": 554,
        "main": "{path}",
        "sub": "{path}",
        "note": "Provide the exact RTSP path yourself (e.g. /live/ch00_0).",
    },
}


def brand_catalog() -> list[dict]:
    """Brand list for the config UI."""
    return [
        {
            "id": bid,
            "label": b["label"],
            "default_port": b["default_port"],
            "note": b.get("note", ""),
            "needs_path": bid == "generic",
        }
        for bid, b in BRAND_TEMPLATES.items()
    ]


def build_rtsp_url(
    brand: str,
    host: str,
    username: str = "",
    password: str = "",
    port: int | None = None,
    channel: int = 1,
    stream: str = "main",
    path: str = "",
) -> dict:
    """Compose the RTSP URL for a brand. Returns {url, masked, path}.

    `masked` hides the password for safe display/logging.
    """
    brand = (brand or "generic").lower()
    tpl = BRAND_TEMPLATES.get(brand) or BRAND_TEMPLATES["generic"]
    host = (host or "").strip()
    if not host:
        raise ValueError("host/IP is required")
    port = int(port or tpl["default_port"])
    stream = "sub" if str(stream).lower() in ("sub", "secondary", "2") else "main"

    raw_path = tpl[stream].format(ch=int(channel or 1), path=(path or "").strip())
    if brand == "generic" and not raw_path:
        raw_path = "/"
    if not raw_path.startswith("/"):
        raw_path = "/" + raw_path

    # credentials — URL-encode so @ : / in passwords don't break the URL
    cred = ""
    cred_mask = ""
    if username:
        u = quote(username, safe="")
        p = quote(password, safe="") if password else ""
        cred = f"{u}:{p}@" if password else f"{u}@"
        cred_mask = f"{username}:{'*' * len(password)}@" if password else f"{username}@"

    url = f"rtsp://{cred}{host}:{port}{raw_path}"
    masked = f"rtsp://{cred_mask}{host}:{port}{raw_path}"
    return {"url": url, "masked": masked, "path": raw_path, "port": port, "brand": brand}


# ---------------------------------------------------------------------------
# 2. Connection probe -- "test before add"
# ---------------------------------------------------------------------------
def probe_source(source_kind: str, source_kwargs: dict, timeout: float = 8.0) -> dict:
    """Open a source, grab one frame with a hard wall-clock timeout.

    Returns: {ok, width, height, channels, latency_ms, source_kind, error}
    Never raises; a bad camera comes back as {ok: False, error: "..."}.
    """
    import threading

    from app.services.sources import build_source

    result: dict = {
        "ok": False,
        "source_kind": source_kind,
        "width": None,
        "height": None,
        "channels": None,
        "latency_ms": None,
        "error": None,
    }

    def _work() -> None:
        t0 = time.time()
        src = None
        try:
            src = build_source(source_kind, **(source_kwargs or {}))
            src.open()
            frame = None
            # a real stream may need a few reads before the first decoded frame
            for _ in range(60):
                frame = src.read()
                if frame is not None and getattr(frame, "size", 0) > 0:
                    break
                time.sleep(0.05)
            if frame is None or getattr(frame, "size", 0) == 0:
                result["error"] = "opened, but no frame decoded within timeout"
                return
            shape = getattr(frame, "shape", None)
            if shape is not None and len(shape) >= 2:
                result["height"] = int(shape[0])
                result["width"] = int(shape[1])
                result["channels"] = int(shape[2]) if len(shape) > 2 else 1
            result["latency_ms"] = int((time.time() - t0) * 1000)
            result["ok"] = True
        except Exception as e:  # noqa: BLE001 - report every failure verbatim
            result["error"] = f"{type(e).__name__}: {e}"
        finally:
            if src is not None:
                try:
                    src.close()
                except Exception:
                    pass

    t = threading.Thread(target=_work, name="probe", daemon=True)
    t.start()
    t.join(timeout=timeout)
    if t.is_alive():
        result["error"] = f"timeout after {timeout:.0f}s (camera unreachable or wrong credentials)"
    return result


# ---------------------------------------------------------------------------
# 3. ONVIF LAN discovery (WS-Discovery)
# ---------------------------------------------------------------------------
def discover_onvif(timeout: float = 4.0) -> dict:
    """WS-Discovery sweep for ONVIF devices on the local network.

    Degrades gracefully: if the optional WSDiscovery package isn't installed we
    return {available: False, ...} rather than erroring.
    """
    try:
        from wsdiscovery.discovery import ThreadedWSDiscovery as WSDiscovery
        from wsdiscovery import QName
    except Exception:  # pragma: no cover - optional dep
        return {
            "available": False,
            "devices": [],
            "error": "WSDiscovery not installed. Run: pip install WSDiscovery",
        }

    import re

    devices: list[dict] = []
    wsd = WSDiscovery()
    try:
        wsd.start()
        # ONVIF NetworkVideoTransmitter type
        nvt = QName("http://www.onvif.org/ver10/network/wsdl", "NetworkVideoTransmitter")
        services = wsd.searchServices(types=[nvt], timeout=int(max(1, timeout)))
        for svc in services:
            xaddrs = list(svc.getXAddrs() or [])
            host = ""
            for xa in xaddrs:
                m = re.search(r"https?://([^/:]+)", xa)
                if m:
                    host = m.group(1)
                    break
            devices.append({
                "host": host,
                "xaddrs": xaddrs,
                "scopes": [str(s) for s in (svc.getScopes() or [])][:6],
                "epr": str(svc.getEPR()),
            })
    except Exception as e:  # pragma: no cover
        return {"available": True, "devices": devices, "error": f"{type(e).__name__}: {e}"}
    finally:
        try:
            wsd.stop()
        except Exception:
            pass

    # de-dupe by host
    seen: set = set()
    uniq = []
    for d in devices:
        key = d["host"] or d["epr"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(d)
    return {"available": True, "devices": uniq, "error": None}
