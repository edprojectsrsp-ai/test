"""Channel-agnostic assistant gateway (Telegram / WhatsApp / any messenger).

A single entry point for inbound messages from any chat channel:

  * slash commands  — /start /help /link /scheme /portfolio /clear
  * document / photo — ingested into the Document Vault, scheme-specific if a
    scheme is set for the chat, otherwise portfolio-wide (scheme_id = NULL)
  * any other text   — a grounded RAG answer via the orchestrator

Per-chat state (the linked Project Brain user, the active scheme, and the AI
conversation id) is held in memory keyed by (channel, external_user_id). The
channel adapters (telegram_bot.py, whatsapp_router.py) only translate transport
payloads to/from these functions — all the logic lives here so both channels
behave identically.
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
from dataclasses import dataclass
from typing import Optional

from app.services.orchestrator import chat_once, create_conversation, get_db
from app.ingestion.ingest_v2 import ingest_file

logger = logging.getLogger(__name__)

ALLOWED_EXT = {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
PORTFOLIO_LABEL = "Portfolio (all schemes)"


@dataclass
class Session:
    conversation_id: Optional[int] = None
    scheme_id: Optional[int] = None
    scheme_name: str = PORTFOLIO_LABEL


_SESSIONS: dict[tuple[str, str], Session] = {}


def _session(channel: str, ext_id: str) -> Session:
    key = (channel, str(ext_id))
    if key not in _SESSIONS:
        _SESSIONS[key] = Session()
    return _SESSIONS[key]


# --------------------------------------------------------------------------- #
#  User identity                                                              #
# --------------------------------------------------------------------------- #
def resolve_pb_user(channel: str, ext_user_id: str, phone: Optional[str] = None) -> Optional[int]:
    """Map a channel identity to a Project Brain user_id.

    Telegram → users.telegram_user_id ; WhatsApp → last-10-digit phone match.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        if channel == "telegram":
            # telegram_user_id is a bigint; compare as text so a non-numeric id
            # can't raise a cast error.
            cur.execute("SELECT user_id FROM users WHERE telegram_user_id::text=%s AND is_active=TRUE",
                        (str(ext_user_id),))
        else:  # whatsapp / sms — match by phone number tail
            digits = re.sub(r"\D", "", phone or str(ext_user_id))[-10:]
            if not digits:
                return None
            cur.execute("SELECT user_id FROM users WHERE is_active=TRUE AND "
                        "regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE %s",
                        (f"%{digits}",))
        row = cur.fetchone()
        if row:
            return row[0]
    finally:
        conn.close()
    # optional demo fallback so a fresh install is usable before any linking
    dflt = os.environ.get("ASSISTANT_DEFAULT_USER_ID")
    return int(dflt) if dflt and dflt.isdigit() else None


def link_telegram(ext_user_id: str, pb_user_id: int) -> bool:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET telegram_user_id=%s WHERE user_id=%s AND is_active=TRUE",
                    (str(ext_user_id), pb_user_id))
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    except Exception:
        conn.rollback()
        return False
    finally:
        conn.close()


def resolve_scheme(query: str) -> tuple[Optional[int], Optional[str]]:
    """Resolve a scheme by id, code, or (fuzzy) name."""
    q = query.strip()
    if not q:
        return None, None
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT scheme_id, scheme_name FROM scheme_master "
            "WHERE NOT COALESCE(is_deleted, FALSE) AND ("
            "  (%s ~ '^[0-9]+$' AND scheme_id = NULLIF(%s,'')::int) "
            "  OR scheme_code ILIKE %s OR scheme_name ILIKE %s) "
            "ORDER BY (scheme_name ILIKE %s) DESC LIMIT 1",
            (q, q, f"%{q}%", f"%{q}%", q),
        )
        row = cur.fetchone()
        return (row[0], row[1]) if row else (None, None)
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
#  Message handling                                                           #
# --------------------------------------------------------------------------- #
HELP = (
    "*Project Brain Assistant*\n\n"
    "Ask me anything about your schemes, packages, plans, delays and CAPEX — "
    "I answer from the live project database.\n\n"
    "*Commands*\n"
    "• `/scheme COB-7` — focus a scheme (answers + uploads attach here)\n"
    "• `/portfolio` — switch back to all schemes\n"
    "• `/link 5` — link this chat to your Project Brain user id\n"
    "• `/clear` — start a fresh conversation\n\n"
    "*Documents* — send a PDF / DOCX / image (with an optional caption) and I'll "
    "file it in the Document Vault and index it so you can ask about it. It attaches "
    "to your focused scheme, or to the portfolio if none is set."
)


async def handle_text(channel: str, ext_user_id: str, text: str,
                      phone: Optional[str] = None) -> str:
    text = (text or "").strip()
    sess = _session(channel, ext_user_id)

    if text.lower() in ("/start", "start"):
        return "👋 " + HELP
    if text.lower() in ("/help", "help"):
        return HELP

    if text.lower().startswith("/link"):
        parts = text.split()
        if channel != "telegram":
            return "Linking by command is Telegram-only. WhatsApp is matched by your registered phone number."
        if len(parts) != 2 or not parts[1].isdigit():
            return "Usage: `/link 5` (your Project Brain user id)."
        if not str(ext_user_id).isdigit():
            return "This channel id isn't a numeric Telegram id."
        ok = link_telegram(ext_user_id, int(parts[1]))
        return f"✅ Linked to user id {parts[1]}." if ok else "❌ Link failed (user not found or inactive)."

    if text.lower().startswith("/scheme"):
        arg = text[len("/scheme"):].strip()
        if not arg:
            return f"Current focus: *{sess.scheme_name}*. Use `/scheme COB-7` to change, `/portfolio` to clear."
        sid, sname = resolve_scheme(arg)
        if not sid:
            return f"No scheme matched '{arg}'. Try the scheme code or a bit of the name."
        sess.scheme_id, sess.scheme_name = sid, sname
        return f"🎯 Focused on *{sname}* (id {sid}). Answers and uploads now attach here."

    if text.lower() in ("/portfolio", "/all"):
        sess.scheme_id, sess.scheme_name = None, PORTFOLIO_LABEL
        return "🌐 Focus cleared — now answering across the *whole portfolio*."

    if text.lower() in ("/clear", "/reset"):
        sess.conversation_id = None
        return "🔄 Conversation cleared."

    # identify user for RAG
    pb_user = resolve_pb_user(channel, ext_user_id, phone)
    if not pb_user:
        if channel == "telegram":
            return "❗ Link your account first: `/link <your_user_id>`."
        return "❗ Your number isn't registered in Project Brain. Ask an admin to add your phone to your user."

    if sess.conversation_id is None:
        sess.conversation_id = create_conversation(
            user_id=pb_user, scheme_id=sess.scheme_id, source=channel,
            title=f"{channel} chat {ext_user_id}")

    try:
        result = await chat_once(
            conversation_id=sess.conversation_id, user_id=pb_user,
            message=text, scheme_id=sess.scheme_id)
        reply = result.get("response") or "(no answer)"
        meta = f"\n\n_via {result.get('provider','?')} · {result.get('latency_ms',0)}ms_"
        return reply + meta
    except Exception as e:
        logger.exception("gateway chat error")
        return f"❌ Error answering: {str(e)[:250]}"


def handle_document(channel: str, ext_user_id: str, filename: str, raw: bytes,
                    caption: str = "", phone: Optional[str] = None) -> str:
    """Ingest an attachment into the Document Vault for this chat's focus."""
    sess = _session(channel, ext_user_id)
    pb_user = resolve_pb_user(channel, ext_user_id, phone) or 1

    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        return (f"⚠️ '{filename}' ({ext or 'no extension'}) isn't a supported document. "
                f"Send PDF, DOCX, TXT or an image.")
    if not raw:
        return "⚠️ Empty file."

    title = (caption.strip() or os.path.splitext(os.path.basename(filename))[0] or "Document")[:200]
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        result = ingest_file(
            tmp_path, title=title, document_type="other",
            scheme_id=sess.scheme_id, user_id=pb_user, channel=channel)
    except Exception as e:
        logger.exception("gateway ingest error")
        return f"❌ Couldn't file that document: {str(e)[:250]}"
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    where = sess.scheme_name if sess.scheme_id else "the *portfolio* vault"
    chunks = result.get("chunks") or result.get("chunk_count") or 0
    return (f"📎 Filed *{title}* in {where} — {chunks} chunk(s) indexed. "
            f"You can now ask me about it.")


def session_summary(channel: str, ext_user_id: str) -> dict:
    s = _session(channel, ext_user_id)
    return {"scheme_id": s.scheme_id, "scheme_name": s.scheme_name,
            "conversation_id": s.conversation_id}
