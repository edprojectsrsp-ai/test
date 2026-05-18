"""
Telegram bot for asking AI questions during meetings.

Setup:
  1. Talk to @BotFather on Telegram → /newbot → get TELEGRAM_BOT_TOKEN
  2. export TELEGRAM_BOT_TOKEN=...
  3. Run: python -m app.routers.telegram_bot
  4. In Telegram: link your account by /link <user_id>
     The bot will set users.telegram_user_id, then you can chat freely.

Commands:
  /start   - welcome
  /link N  - link your Telegram chat to project_brain user N
  /clear   - clear current conversation (start fresh)
  (any text) - chat with AI
"""
import os
import asyncio
import logging
import json
from typing import Optional
import httpx
import psycopg2
import psycopg2.extras
from app.services.orchestrator import create_conversation, chat_once, get_db

logger = logging.getLogger(__name__)
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}"
USER_CONVERSATION_CACHE: dict[int, int] = {}  # telegram_user_id → conversation_id


async def send(chat_id: int, text: str, parse_mode: str = "Markdown"):
    async with httpx.AsyncClient(timeout=30.0) as c:
        await c.post(f"{API}/sendMessage",
                     json={"chat_id": chat_id, "text": text[:4000],
                           "parse_mode": parse_mode, "disable_web_page_preview": True})


def get_pb_user(telegram_user_id: int) -> Optional[int]:
    """Look up project_brain user_id linked to this Telegram account."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT user_id FROM users WHERE telegram_user_id=%s AND is_active=TRUE",
                (telegram_user_id,))
    r = cur.fetchone()
    conn.close()
    return r[0] if r else None


def link_telegram(telegram_user_id: int, pb_user_id: int) -> bool:
    """Link a Telegram account to a project_brain user."""
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE users SET telegram_user_id=%s WHERE user_id=%s AND is_active=TRUE",
                    (telegram_user_id, pb_user_id))
        ok = cur.rowcount > 0
        conn.commit()
    except psycopg2.IntegrityError:
        # Already linked to someone else
        conn.rollback()
        ok = False
    conn.close()
    return ok


async def handle_update(update: dict):
    msg = update.get("message")
    if not msg or "text" not in msg:
        return
    chat_id = msg["chat"]["id"]
    tg_user_id = msg["from"]["id"]
    text = msg["text"].strip()

    # Commands
    if text.startswith("/start"):
        await send(chat_id,
            "👋 *Project Brain Assistant*\n\n"
            "Link your account first:\n`/link <your_user_id>`\n\n"
            "Then ask me anything about your schemes and packages.")
        return

    if text.startswith("/link"):
        parts = text.split()
        if len(parts) != 2 or not parts[1].isdigit():
            await send(chat_id, "Usage: `/link 5` (where 5 is your user_id)")
            return
        pb_user = int(parts[1])
        ok = link_telegram(tg_user_id, pb_user)
        if ok:
            await send(chat_id, f"✅ Linked to user_id={pb_user}. Ask me anything now.")
        else:
            await send(chat_id, "❌ Link failed. User not found, inactive, or already linked elsewhere.")
        return

    if text.startswith("/clear"):
        USER_CONVERSATION_CACHE.pop(tg_user_id, None)
        await send(chat_id, "🔄 Conversation cleared. Fresh start.")
        return

    # Need to be linked
    pb_user = get_pb_user(tg_user_id)
    if not pb_user:
        await send(chat_id, "❗ Link your account first: `/link <your_user_id>`")
        return

    # Get or create conversation
    if tg_user_id not in USER_CONVERSATION_CACHE:
        cid = create_conversation(user_id=pb_user, source="telegram",
                                  title=f"Telegram chat {tg_user_id}")
        USER_CONVERSATION_CACHE[tg_user_id] = cid
    cid = USER_CONVERSATION_CACHE[tg_user_id]

    await send(chat_id, "🧠 Thinking...")

    try:
        result = await chat_once(user_query=text, conversation_id=cid, user_id=pb_user)
        reply = result.get("response") or "(empty response)"
        # Add footer with provider + latency
        footer = f"\n\n_via {result.get('provider','?')} · {result.get('latency_ms',0)}ms · {result.get('tokens_used',0)} tok_"
        await send(chat_id, reply + footer)
    except Exception as e:
        logger.exception("Telegram bot error")
        await send(chat_id, f"❌ Error: {str(e)[:300]}")


async def poll():
    """Long-poll Telegram for updates."""
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set. Set it and restart.")
        return
    offset = 0
    while True:
        try:
            async with httpx.AsyncClient(timeout=60.0) as c:
                r = await c.get(f"{API}/getUpdates",
                                params={"offset": offset, "timeout": 30})
                data = r.json()
            for upd in data.get("result", []):
                offset = upd["update_id"] + 1
                await handle_update(upd)
        except Exception as e:
            logger.warning(f"Telegram poll error: {e}")
            await asyncio.sleep(2)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(poll())
