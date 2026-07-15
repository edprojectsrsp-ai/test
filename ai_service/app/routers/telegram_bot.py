"""Telegram adapter for the Project Brain assistant.

Thin transport layer over app.services.assistant_gateway — it only translates
Telegram updates to gateway calls and sends replies back. All logic (commands,
RAG, document ingestion, scheme focus) lives in the gateway so Telegram and
WhatsApp behave identically.

Setup:
  1. @BotFather → /newbot → copy the token
  2. set TELEGRAM_BOT_TOKEN in the AI service environment
  3. the poller auto-starts with the AI service (see main.py startup)
     — or run standalone:  python -m app.routers.telegram_bot
  4. in Telegram: /link <your_user_id>, then chat or send documents
"""
from __future__ import annotations

import asyncio
import logging
import os

import httpx

from app.services.assistant_gateway import handle_document, handle_text

logger = logging.getLogger(__name__)
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}" if TOKEN else None
FILE_API = f"https://api.telegram.org/file/bot{TOKEN}" if TOKEN else None
_MAX_FILE_MB = int(os.environ.get("ASSISTANT_MAX_FILE_MB", "25"))


async def send(chat_id: int, text: str):
    if not API:
        return
    async with httpx.AsyncClient(timeout=30.0) as c:
        # Telegram caps messages at 4096 chars; chunk long RAG answers.
        for i in range(0, len(text), 3900):
            await c.post(f"{API}/sendMessage", json={
                "chat_id": chat_id, "text": text[i:i + 3900],
                "parse_mode": "Markdown", "disable_web_page_preview": True})


async def _download(file_id: str):
    async with httpx.AsyncClient(timeout=60.0) as c:
        r = await c.get(f"{API}/getFile", params={"file_id": file_id})
        info = r.json().get("result", {})
        path = info.get("file_path")
        if not path:
            return None, None
        size = info.get("file_size", 0)
        if size and size > _MAX_FILE_MB * 1024 * 1024:
            return path, b""  # too large — caller reports
        fr = await c.get(f"{FILE_API}/{path}")
        return path, fr.content


async def handle_update(update: dict):
    msg = update.get("message") or update.get("channel_post")
    if not msg:
        return
    chat_id = msg["chat"]["id"]
    tg_user_id = str(msg.get("from", {}).get("id", chat_id))
    caption = msg.get("caption", "")

    # ---- documents / images -------------------------------------------------
    doc = msg.get("document")
    photo = msg.get("photo")
    if doc or photo:
        await send(chat_id, "📥 Filing your document…")
        if doc:
            file_id, filename = doc["file_id"], doc.get("file_name", "document")
        else:  # photos arrive as an array of sizes; take the largest
            file_id, filename = photo[-1]["file_id"], f"photo_{photo[-1]['file_unique_id']}.jpg"
        _path, raw = await _download(file_id)
        if raw is None:
            await send(chat_id, "⚠️ Couldn't fetch that file from Telegram.")
            return
        if raw == b"":
            await send(chat_id, f"⚠️ That file is larger than {_MAX_FILE_MB} MB.")
            return
        reply = await asyncio.to_thread(handle_document, "telegram", tg_user_id, filename, raw, caption)
        await send(chat_id, reply)
        return

    # ---- text ---------------------------------------------------------------
    text = msg.get("text")
    if not text:
        return
    if not text.startswith("/"):
        await send(chat_id, "🧠 Thinking…")
    reply = await handle_text("telegram", tg_user_id, text)
    await send(chat_id, reply)


async def poll(stop_event: "asyncio.Event | None" = None):
    """Long-poll Telegram for updates until stop_event is set."""
    if not TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled.")
        return
    logger.info("Telegram bot polling started.")
    offset = 0
    while not (stop_event and stop_event.is_set()):
        try:
            async with httpx.AsyncClient(timeout=40.0) as c:
                r = await c.get(f"{API}/getUpdates", params={"offset": offset, "timeout": 25})
                data = r.json()
            for upd in data.get("result", []):
                offset = upd["update_id"] + 1
                try:
                    await handle_update(upd)
                except Exception:
                    logger.exception("telegram update handling failed")
        except Exception as e:
            logger.warning(f"telegram poll error: {e}")
            await asyncio.sleep(3)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(poll())
