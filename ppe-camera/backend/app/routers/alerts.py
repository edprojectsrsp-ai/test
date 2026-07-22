"""
Alert settings API -- backs the "Settings" tab in the PPE module.

Lets an operator configure Telegram notifications from the browser instead of
editing .env and redeploying:

  GET  /api/alerts/config          current config (bot token masked)
  PUT  /api/alerts/config          save partial config
  POST /api/alerts/test            send a test alert to the configured chats
  GET  /api/alerts/telegram/chats  discover chat ids from getUpdates
  GET  /api/alerts/telegram/verify validate the bot token (getMe)

Chat-id discovery exists because it is the single most common setup failure:
users know their bot token but not the numeric chat id. They message the bot
once, hit "Detect", and we read it off getUpdates.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import alert_config
from app.services.alert_service import AlertService, get_alert_service

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


class AlertConfigPatch(BaseModel):
    telegram_enabled: bool | None = None
    telegram_bot_token: str | None = None
    telegram_chat_ids: str | None = None
    telegram_send_photo: bool | None = None
    telegram_gear_filter: list[str] | None = None
    webhook_url: str | None = None
    cooldown_s: int | None = None


class TestPayload(BaseModel):
    camera: str = "TEST-CAM"
    violation: str = "NO_HELMET"


def _tg_call(token: str, method: str, params: dict | None = None) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(params or {}).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise HTTPException(status_code=400,
                            detail=f"Telegram API error {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502,
                            detail=f"Cannot reach Telegram: {exc.reason}") from exc


def _token_or_400(supplied: str | None = None) -> str:
    token = supplied or str(alert_config.get("telegram_bot_token") or "")
    if not token:
        raise HTTPException(status_code=400, detail="No Telegram bot token configured")
    return token


@router.get("/config")
async def get_config() -> dict:
    cfg = alert_config.masked()
    cfg["telegram_ready"] = alert_config.telegram_ready()
    cfg["chat_count"] = len(alert_config.chat_ids())
    return cfg


@router.put("/config")
async def put_config(patch: AlertConfigPatch) -> dict:
    body = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not body:
        raise HTTPException(status_code=400, detail="Empty update")
    if "cooldown_s" in body and not (0 <= int(body["cooldown_s"]) <= 86400):
        raise HTTPException(status_code=400, detail="cooldown_s must be 0..86400")
    if "telegram_bot_token" in body:
        body["telegram_bot_token"] = body["telegram_bot_token"].strip()
    saved = alert_config.update(body)
    saved["telegram_ready"] = alert_config.telegram_ready()
    saved["chat_count"] = len(alert_config.chat_ids())
    return saved


@router.get("/telegram/verify")
async def verify_token(token: str | None = None) -> dict:
    result = _tg_call(_token_or_400(token), "getMe")
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail="Invalid bot token")
    bot = result.get("result", {})
    return {"ok": True, "bot_username": bot.get("username"),
            "bot_name": bot.get("first_name"), "bot_id": bot.get("id")}


@router.get("/telegram/chats")
async def discover_chats(token: str | None = None) -> dict:
    """Read recent updates and list every chat that has messaged the bot."""
    result = _tg_call(_token_or_400(token), "getUpdates", {"limit": 100, "timeout": 0})
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail="getUpdates failed")
    seen: dict[str, dict] = {}
    for update in result.get("result", []):
        msg = (update.get("message") or update.get("channel_post")
               or update.get("my_chat_member") or {})
        chat = msg.get("chat") or {}
        cid = chat.get("id")
        if cid is None:
            continue
        title = (chat.get("title")
                 or " ".join(filter(None, [chat.get("first_name"), chat.get("last_name")]))
                 or chat.get("username") or str(cid))
        seen[str(cid)] = {"chat_id": str(cid), "title": title,
                          "type": chat.get("type", "private")}
    if not seen:
        return {"chats": [], "hint": "Send any message to the bot (or add it to your "
                                     "group and post once), then press Detect again."}
    return {"chats": list(seen.values())}


@router.post("/test")
async def send_test(payload: TestPayload) -> dict:
    """Send a test alert straight through the Telegram channel, bypassing cooldown."""
    if not alert_config.telegram_ready():
        raise HTTPException(
            status_code=400,
            detail="Telegram not ready: enable it, set a bot token and at least one chat id")
    token = _token_or_400()
    text = AlertService.format_message({
        "violation": payload.violation,
        "camera": payload.camera,
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "meta": {"note": "Test alert from Project Brain \u2014 delivery is working."},
    })
    delivered, failed = [], []
    for chat_id in alert_config.chat_ids():
        try:
            AlertService._telegram_text(token, chat_id, text)
            delivered.append(chat_id)
        except Exception as exc:  # noqa: BLE001 - report per-chat, don't abort
            failed.append({"chat_id": chat_id, "error": str(exc)[:200]})
    if not delivered:
        raise HTTPException(status_code=502,
                            detail=f"All sends failed: {failed}")
    return {"ok": True, "delivered": delivered, "failed": failed}


@router.post("/test/live")
async def send_test_live() -> dict:
    """Push a synthetic violation through the real queue (exercises cooldown + all channels)."""
    svc = get_alert_service()
    decision = svc.fire("TEST-CAM", "HELMET", None, {"note": "synthetic live-path test"})
    return {"queued": decision}
