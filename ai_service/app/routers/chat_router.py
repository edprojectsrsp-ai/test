"""HTTP routes for AI chat. Mount under /ai in main."""
import os, json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
from app.services.orchestrator import (
    create_conversation, chat_once, chat_stream, get_db
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


class StartConversationIn(BaseModel):
    user_id: int
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None
    title: Optional[str] = None
    source: str = "web"


class ChatIn(BaseModel):
    conversation_id: int
    user_id: int
    message: str
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None
    # Sprint AI: optional provider override. Accepts:
    #   - None / unset       → use task-aware routing (existing behavior)
    #   - "openai" | "gemini" | "groq" | "ollama" → force that provider,
    #     with a single-step ollama fallback if the forced one fails
    #   - "auto" → explicit synonym for None (some UIs prefer a literal value)
    provider: Optional[str] = None
    # Optional model override within a provider (e.g. for openrouter free model selection)
    model_override: Optional[str] = None
    # If True, disables even the small fallback chain when a provider is forced —
    # useful when testing a specific provider in isolation.
    strict_provider: bool = False


def _normalize_provider(p: Optional[str]) -> Optional[str]:
    """Treat 'auto' / '' / None / 'default' as 'no override'."""
    if not p:
        return None
    p = p.strip().lower()
    if p in ("", "auto", "default", "router", "none"):
        return None
    return p


@router.get("/providers")
def list_providers():
    """List configured providers and the default selection for the UI dropdown."""
    from app.providers.router import get_router, DEFAULT_PROVIDER, VALID_PROVIDERS
    r = get_router()
    return {
        "available": r.get_available(),
        "default": r.get_default_provider() or DEFAULT_PROVIDER,
        "configured_default": DEFAULT_PROVIDER,
        "all_known": sorted(list(VALID_PROVIDERS)),
    }


@router.post("/conversations/start")
def start_conversation(payload: StartConversationIn):
    """Create a new conversation thread."""
    cid = create_conversation(
        user_id=payload.user_id, scheme_id=payload.scheme_id,
        package_id=payload.package_id, title=payload.title, source=payload.source,
    )
    return {"conversation_id": cid}


@router.get("/conversations")
def list_conversations(limit: int = 50):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT conversation_id, user_id, scheme_id, package_id, title, source,
               created_at, last_message_at, message_count, total_tokens
        FROM ai_conversations
        ORDER BY last_message_at DESC
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    conn.close()
    return rows


@router.get("/conversations/{conversation_id}/messages")
def list_messages(conversation_id: int, limit: int = 200):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT message_id, role, content, tools_called,
               cited_scheme_ids, cited_package_ids, cited_document_ids, cited_chunk_ids,
               provider, model_name, tokens_used, created_at
        FROM ai_messages
        WHERE conversation_id=%s
        ORDER BY created_at ASC
        LIMIT %s
    """, (conversation_id, limit))
    rows = cur.fetchall()
    conn.close()
    return rows


@router.post("/chat")
async def chat(payload: ChatIn):
    """Non-streaming response. Returns {reply, provider, model, ...}."""
    provider = _normalize_provider(payload.provider)
    # model_override is now passed per-request (provider clone inside the
    # router) instead of mutating the shared singleton — the old approach
    # leaked one user's model choice into every concurrent request.
    resp = await chat_once(
        conversation_id=payload.conversation_id,
        user_id=payload.user_id,
        message=payload.message,
        scheme_id=payload.scheme_id,
        package_id=payload.package_id,
        forced_provider=provider,
        strict_forced=payload.strict_provider,
        model_override=payload.model_override if provider else None,
    )
    return resp


@router.post("/chat/stream")
async def chat_stream_endpoint(payload: ChatIn):
    """Streaming response, SSE-ish JSON lines."""
    provider = _normalize_provider(payload.provider)

    async def gen():
        async for chunk in chat_stream(
            conversation_id=payload.conversation_id,
            user_id=payload.user_id,
            message=payload.message,
            scheme_id=payload.scheme_id,
            package_id=payload.package_id,
            forced_provider=provider,
            strict_forced=payload.strict_provider,
            model_override=payload.model_override if provider else None,
        ):
            yield json.dumps(chunk) + "\n"

    return StreamingResponse(gen(), media_type="text/plain")


@router.post("/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type: str = Form("other"),
    title: str = Form(""),
    scheme_id: Optional[int] = Form(None),
    package_id: Optional[int] = Form(None),
    user_id: int = Form(...),
):
    """Upload a document and queue for processing (text extract → chunk → embed)."""
    import hashlib
    upload_dir = os.environ.get("UPLOAD_DIR", "/var/lib/project_brain/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    data = await file.read()
    file_hash = hashlib.sha256(data).hexdigest()
    safe_name = f"{file_hash[:16]}_{file.filename}"
    file_path = os.path.join(upload_dir, safe_name)
    with open(file_path, "wb") as f:
        f.write(data)

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO documents (scheme_id, package_id, document_type, title,
                               file_name, file_path, file_size_bytes, file_hash, mime_type,
                               extraction_status, embedding_status, uploaded_by)
        VALUES (%s, %s, %s::document_type_enum, %s, %s, %s, %s, %s, %s,
                'pending', 'pending', %s)
        RETURNING document_id
    """, (scheme_id, package_id, document_type, title,
          file.filename, safe_name, len(data), file_hash, file.content_type, user_id))
    doc_id = cur.fetchone()[0]
    conn.commit()
    conn.close()

    from app.ingestion.processor import process_document
    background_tasks.add_task(process_document, doc_id)

    return {"document_id": doc_id, "title": title, "size_bytes": len(data), "status": "queued"}


@router.get("/documents/{document_id}/status")
def document_status(document_id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT document_id, title, extraction_status, embedding_status, chunk_count,
               auto_summary, keywords, important_points
        FROM documents WHERE document_id=%s
    """, (document_id,))
    r = cur.fetchone()
    conn.close()
    if not r:
        raise HTTPException(404, "Document not found")
    return dict(r)


@router.get("/health")
def health():
    """Health check - reports which providers are reachable."""
    from app.providers.router import get_router
    r = get_router()
    return {
        "ok": True,
        "providers_configured": r.get_available(),
        "default_provider": r.get_default_provider(),
        "tools_registered": len(__import__("app.tools.db_tools", fromlist=["TOOL_REGISTRY"]).TOOL_REGISTRY),
    }
