"""
Joining the cloud with a single code.

The operator types one join code. This calls the cloud, receives an agent id and
token, writes them to .env, and applies them to the running process so the first
push works without a restart.

Writing .env from a running service is deliberate. The alternative is telling
someone to open a file under Program Files in an elevated editor, paste two
values without transposing them, and restart a Windows service -- on a plant PC,
at the end of an install, which is exactly where a setup gets abandoned.
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger(__name__)


def env_path() -> Path:
    """Where .env lives. PPE_ROOT is set by the installer to the install dir."""
    root = os.getenv("PPE_ROOT")
    if root:
        return Path(root) / ".env"
    # Repo layout: app/services/enroll_client.py -> backend/.env
    return Path(__file__).resolve().parents[2] / ".env"


def write_env(values: dict[str, str]) -> Path:
    """Upsert keys in .env, preserving every other line and its comments.

    A rewrite-from-template would silently discard whatever the site had tuned
    by hand -- thresholds, camera defaults, a Postgres URL -- which is a very
    expensive way to save a few lines of parsing.
    """
    path = env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    remaining = dict(values)
    out: list[str] = []
    for line in lines:
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=", line)
        if m and m.group(1) in remaining:
            key = m.group(1)
            out.append(f"{key}={remaining.pop(key)}")
        else:
            out.append(line)
    if remaining:
        if out and out[-1].strip():
            out.append("")
        out.append("# --- written by enrollment ---")
        out.extend(f"{k}={v}" for k, v in remaining.items())

    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return path


async def enroll(cloud_url: str, code: str, name: str = "") -> dict:
    """Join the cloud. Returns a report; never raises for expected failures."""
    import httpx
    import socket

    cloud_url = (cloud_url or "").strip().rstrip("/")
    if not cloud_url:
        return {"ok": False, "error": "cloud URL is required"}
    if not code.strip():
        return {"ok": False, "error": "join code is required"}

    hostname = socket.gethostname()
    payload = {"code": code.strip(), "name": name.strip() or hostname,
               "hostname": hostname}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{cloud_url}/api/sync/enroll", json=payload)
    except Exception as exc:  # noqa: BLE001 - network is the expected failure
        return {"ok": False, "error": f"could not reach {cloud_url}: {exc}"}

    if r.status_code == 401:
        return {"ok": False, "error": "join code rejected by the server"}
    if r.status_code == 503:
        return {"ok": False,
                "error": "the server has enrollment disabled (PPE_ENROLL_CODE unset)"}
    if r.status_code >= 400:
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}

    data = r.json() or {}
    agent_id, token = data.get("agent_id"), data.get("agent_token")
    if not agent_id or not token:
        return {"ok": False, "error": "server did not return credentials"}

    try:
        path = write_env({
            "PPE_SYNC_URL": cloud_url,
            "PPE_AGENT_ID": agent_id,
            "PPE_AGENT_TOKEN": token,
        })
    except Exception as exc:  # noqa: BLE001
        # The credentials are valid but unsaved, and the token is not
        # recoverable from the server. Hand it back so it is not simply lost.
        return {"ok": False, "agent_id": agent_id, "agent_token": token,
                "error": f"enrolled, but could not write .env ({exc}). "
                         f"Set PPE_AGENT_ID / PPE_AGENT_TOKEN manually."}

    # Apply to the live process. get_settings is lru_cached, so mutating the
    # instance is what lets a push work immediately instead of after a restart.
    s = get_settings()
    s.SYNC_URL, s.AGENT_ID, s.AGENT_TOKEN = cloud_url, agent_id, token

    log.info("enrolled with %s as %s", cloud_url, agent_id)
    return {"ok": True, "agent_id": agent_id, "sync_url": cloud_url,
            "env_file": str(path)}
