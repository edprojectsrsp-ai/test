"""WhatsApp adapter for the Project Brain assistant (Meta Cloud API).

Same gateway as Telegram — only the transport differs. WhatsApp uses webhooks
rather than long-polling, so this exposes:

  GET  /channels/whatsapp/webhook   verification handshake (hub.challenge)
  POST /channels/whatsapp/webhook   inbound messages + media

Setup (Meta / Facebook Cloud API):
  1. Create a WhatsApp app, get a permanent access token + phone number id.
  2. Set env: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN.
  3. Point the webhook at  https://<host>/channels/whatsapp/webhook  with the
     same verify token. (Expose the AI service via a tunnel / reverse proxy.)

The router mounts even without credentials: verification and sends become
no-ops (logged), so the rest of the service is unaffected until you configure it.
Twilio's WhatsApp API can be added as a second adapter against the same gateway.
"""
from __future__ import annotations

import logging
import os

import httpx
from fastapi import APIRouter, Request, Response

from app.services.assistant_gateway import handle_document, handle_text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/channels/whatsapp", tags=["WhatsApp"])

TOKEN = os.environ.get("WHATSAPP_TOKEN")
PHONE_ID = os.environ.get("WHATSAPP_PHONE_ID")
VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "project-brain")
GRAPH = "https://graph.facebook.com/v19.0"
_MAX_FILE_MB = int(os.environ.get("ASSISTANT_MAX_FILE_MB", "25"))


async def send_text(to: str, text: str):
    if not (TOKEN and PHONE_ID):
        logger.info("[whatsapp:dry-run] -> %s: %s", to, text[:120])
        return
    async with httpx.AsyncClient(timeout=30.0) as c:
        for i in range(0, len(text), 3800):  # WhatsApp body limit ~4096
            await c.post(
                f"{GRAPH}/{PHONE_ID}/messages",
                headers={"Authorization": f"Bearer {TOKEN}"},
                json={"messaging_product": "whatsapp", "to": to, "type": "text",
                      "text": {"body": text[i:i + 3800]}},
            )


async def _download_media(media_id: str):
    """Resolve a WhatsApp media id to (filename, bytes)."""
    if not TOKEN:
        return None, None
    async with httpx.AsyncClient(timeout=60.0) as c:
        meta = (await c.get(f"{GRAPH}/{media_id}",
                            headers={"Authorization": f"Bearer {TOKEN}"})).json()
        url = meta.get("url")
        if not url:
            return None, None
        if meta.get("file_size", 0) > _MAX_FILE_MB * 1024 * 1024:
            return "toolarge", b""
        r = await c.get(url, headers={"Authorization": f"Bearer {TOKEN}"})
        mime = meta.get("mime_type", "")
        ext = _ext_for_mime(mime)
        return f"whatsapp_{media_id}{ext}", r.content


def _ext_for_mime(mime: str) -> str:
    return {
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "text/plain": ".txt",
        "image/jpeg": ".jpg", "image/png": ".png",
    }.get(mime.split(";")[0].strip(), ".bin")


@router.get("/webhook")
def verify(request: Request):
    """Meta webhook verification handshake."""
    params = request.query_params
    if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == VERIFY_TOKEN:
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=403, content="verification failed")


@router.post("/webhook")
async def inbound(request: Request):
    body = await request.json()
    try:
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for msg in value.get("messages", []):
                    await _process_message(msg)
    except Exception:
        logger.exception("whatsapp inbound handling failed")
    # Always 200 quickly so Meta doesn't retry.
    return {"status": "received"}


async def _process_message(msg: dict):
    import asyncio
    wa_id = msg.get("from")          # sender phone (also the external user id)
    mtype = msg.get("type")

    if mtype == "text":
        text = msg.get("text", {}).get("body", "")
        if not text.startswith("/"):
            await send_text(wa_id, "🧠 Thinking…")
        reply = await handle_text("whatsapp", wa_id, text, phone=wa_id)
        await send_text(wa_id, reply)
        return

    if mtype in ("document", "image"):
        media = msg.get(mtype, {})
        caption = media.get("caption", "")
        filename = media.get("filename", "")
        await send_text(wa_id, "📥 Filing your document…")
        fname, raw = await _download_media(media.get("id", ""))
        if raw is None:
            await send_text(wa_id, "⚠️ Couldn't fetch that media (check WhatsApp credentials).")
            return
        if fname == "toolarge":
            await send_text(wa_id, f"⚠️ That file is larger than {_MAX_FILE_MB} MB.")
            return
        reply = await asyncio.to_thread(
            handle_document, "whatsapp", wa_id, filename or fname, raw, caption, wa_id)
        await send_text(wa_id, reply)
        return

    await send_text(wa_id, "Send me a text question or a document (PDF / DOCX / image).")
