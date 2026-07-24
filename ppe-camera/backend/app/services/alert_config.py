"""
Alert configuration store -- runtime-editable, frontend-configurable.

Historically every alert channel was env-only (PPE_ALERT_WEBHOOK, WHATSAPP_*,
PPE_SMTP_*), which meant changing a Telegram chat id required an ops deploy.
This store keeps a small JSON document on disk (DATA_DIR/alert_config.json)
that the Settings tab writes to over the API, and resolves each value as:

    runtime JSON  >  environment variable  >  built-in default

so existing .env deployments keep working untouched, while anything set from
the UI wins. Reads are hot-pathed by the alert worker thread, so the whole
document is cached in memory behind a lock and only re-read when it changes.

Secrets (bot token) are never returned verbatim by the API -- see masked().
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from app.core.config import get_settings

_LOCK = threading.RLock()
_CACHE: dict[str, Any] | None = None

# key -> (env var fallback, default)
_SPEC: dict[str, tuple[str | None, Any]] = {
    "telegram_enabled":   ("PPE_TELEGRAM_ENABLED", False),
    "telegram_bot_token": ("PPE_TELEGRAM_BOT_TOKEN", ""),
    "telegram_chat_ids":  ("PPE_TELEGRAM_CHAT_IDS", ""),   # comma-separated
    "telegram_send_photo": ("PPE_TELEGRAM_SEND_PHOTO", True),
    "webhook_url":        ("PPE_ALERT_WEBHOOK", ""),
    "cooldown_s":         ("PPE_ALERT_COOLDOWN", 60),
    # --- alert policy (per-person deduplication) ---------------------------
    # key_mode "person" dedupes per worker; "camera_gear" reproduces the old
    # zone-level behaviour and suits scene hazards like fire, where which
    # person triggered it is irrelevant.
    "key_mode":            (None, "person"),
    "person_cooldown_s":   ("PPE_PERSON_COOLDOWN", 0),      # 0 = use cooldown_s
    "escalate_after_s":    ("PPE_ESCALATE_AFTER", 900),
    "max_escalations":     (None, 3),
    "incident_reset_s":    ("PPE_INCIDENT_RESET", 1800),
    "max_per_minute":      ("PPE_MAX_ALERTS_PER_MIN", 12),
    "digest_window_s":     ("PPE_DIGEST_WINDOW", 300),
    "quiet_from":          (None, -1),                       # -1 = disabled
    "quiet_to":            (None, -1),
    # which violation types to notify on; empty list == all
    "telegram_gear_filter": (None, []),
}

_SECRET_KEYS = {"telegram_bot_token"}


def _config_path() -> Path:
    return Path(get_settings().DATA_DIR) / "alert_config.json"


def _coerce(value: Any, default: Any) -> Any:
    """Coerce an env string into the type implied by the default."""
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() not in ("0", "", "false", "no", "off")
    if isinstance(default, int) and not isinstance(default, bool):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
    if isinstance(default, list):
        if isinstance(value, list):
            return value
        return [p.strip() for p in str(value).split(",") if p.strip()]
    return value


def _load_raw() -> dict[str, Any]:
    global _CACHE
    with _LOCK:
        if _CACHE is not None:
            return _CACHE
        path = _config_path()
        data: dict[str, Any] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8")) or {}
            except (OSError, json.JSONDecodeError):
                data = {}  # corrupt file must not break alerting
        _CACHE = data
        return _CACHE


def get(key: str) -> Any:
    """Resolve one setting: runtime JSON > env > default."""
    env_key, default = _SPEC.get(key, (None, ""))
    raw = _load_raw()
    if key in raw and raw[key] not in (None, ""):
        return _coerce(raw[key], default)
    if key in raw and isinstance(default, bool):
        return _coerce(raw[key], default)
    if env_key:
        env_val = os.getenv(env_key)
        if env_val not in (None, ""):
            return _coerce(env_val, default)
    return default


def all_values() -> dict[str, Any]:
    return {k: get(k) for k in _SPEC}


def masked() -> dict[str, Any]:
    """Config safe to return to the browser -- secrets reduced to a hint."""
    out = all_values()
    for k in _SECRET_KEYS:
        val = str(out.get(k) or "")
        out[k] = f"{val[:6]}…{val[-4:]}" if len(val) > 12 else ("set" if val else "")
        out[f"{k}_set"] = bool(val)
    return out


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a partial update and persist. Unknown keys are ignored."""
    global _CACHE
    with _LOCK:
        data = dict(_load_raw())
        for key, value in patch.items():
            if key not in _SPEC:
                continue
            # An empty secret means "leave unchanged", not "clear it" -- the UI
            # never receives the real token back, so it can't echo it to us.
            if key in _SECRET_KEYS and not value:
                continue
            data[key] = value
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(path)  # atomic: worker thread never sees a half-written file
        _CACHE = data
    return masked()


def chat_ids() -> list[str]:
    raw = get("telegram_chat_ids")
    if isinstance(raw, list):
        return [str(c).strip() for c in raw if str(c).strip()]
    return [c.strip() for c in str(raw).split(",") if c.strip()]


def telegram_ready() -> bool:
    return bool(get("telegram_enabled") and get("telegram_bot_token") and chat_ids())


def invalidate() -> None:
    global _CACHE
    with _LOCK:
        _CACHE = None
