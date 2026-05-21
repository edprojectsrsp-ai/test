"""HTTP routes for AI chat - WITH JWT AUTH. Mount under /ai in main."""
import os, json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
from app.services.orchestrator import (
    create_conversation, chat_once, chat_stream, get_db
)
from app.security.auth import require_user, get_scheme_filter_for_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


class StartConversationIn(BaseModel):
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None
    title: Optional[str] = None
    source: str = "web"


class ChatIn(BaseModel):
    conversation_id: int
    message: str
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None


def _check_conv_owner(conversation_id: int, user_id: int):
    """Ensure user owns this conversation."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT user_id FROM ai_conversations WHERE conversation_id=%s", (conversation_id,))
    r = cur.fetchone()
    conn.close()
    if not r:
        raise HTTPException(404, "Conversation not found")
    if r[0] != user_id:
        raise HTTPException(403, "Not your conversation")


@router.post("/conversations/start")
def start_conversation(payload: StartConversationIn, user: dict = Depends(require_user)):
    cid = create_conversation(
        user_id=user["user_id"], scheme_id=payload.scheme_id,
        package_id=payload.package_id, title=payload.title, source=payload.source,
    )
    return {"conversation_id": cid}


@router.post("/chat")
async def chat(payload: ChatIn, user: dict = Depends(require_user)):
    _check_conv_owner(payload.conversation_id, user["user_id"])
    # Pass scheme_filter through so AI tools only see allowed schemes
    scheme_filter = get_scheme_filter_for_user(user)
    result = await chat_once(
        user_query=payload.message,
        conversation_id=payload.conversation_id,
        user_id=user["user_id"],
        scheme_id=payload.scheme_id,
        package_id=payload.package_id,
        allowed_scheme_ids=scheme_filter,
    )
    return result


@router.post("/chat/stream")
async def chat_stream_endpoint(payload: ChatIn, user: dict = Depends(require_user)):
    _check_conv_owner(payload.conversation_id, user["user_id"])
    scheme_filter = get_scheme_filter_for_user(user)
    async def event_gen():
        async for event in chat_stream(
            user_query=payload.message,
            conversation_id=payload.conversation_id,
            user_id=user["user_id"],
            scheme_id=payload.scheme_id,
            package_id=payload.package_id,
            allowed_scheme_ids=scheme_filter,
        ):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.get("/conversations")
def list_conversations(limit: int = 30, user: dict = Depends(require_user)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT conversation_id, title, scheme_id, package_id, started_at, last_message_at,
               message_count, total_tokens
        FROM ai_conversations
        WHERE user_id=%s AND NOT is_archived
        ORDER BY last_message_at DESC NULLS LAST, started_at DESC
        LIMIT %s
    """, (user["user_id"], limit))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"conversations": rows}


@router.get("/conversations/{conversation_id}/messages")
def get_messages(conversation_id: int, user: dict = Depends(require_user)):
    _check_conv_owner(conversation_id, user["user_id"])
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT message_id, role, content, tools_called, cited_scheme_ids, cited_package_ids,
               cited_document_ids, cited_chunk_ids, provider, model_name, tokens_used, created_at
        FROM ai_messages WHERE conversation_id=%s ORDER BY created_at ASC
    """, (conversation_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"messages": rows}


@router.post("/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    document_type: str = Form("other"),
    scheme_id: Optional[int] = Form(None),
    package_id: Optional[int] = Form(None),
    user: dict = Depends(require_user),
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
          file.filename, safe_name, len(data), file_hash, file.content_type, user["user_id"]))
    doc_id = cur.fetchone()[0]
    conn.commit()
    conn.close()

    from app.ingestion.processor import process_document
    background_tasks.add_task(process_document, doc_id)
    return {"document_id": doc_id, "title": title, "size_bytes": len(data), "status": "queued"}


@router.get("/documents/{document_id}/status")
def document_status(document_id: int, user: dict = Depends(require_user)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT document_id, title, extraction_status, embedding_status, chunk_count,
               auto_summary, keywords, important_points, scheme_id
        FROM documents WHERE document_id=%s
    """, (document_id,))
    r = cur.fetchone()
    conn.close()
    if not r:
        raise HTTPException(404, "Document not found")
    return dict(r)


@router.get("/health")
def health():
    """Health check - reports which providers are reachable. No auth required."""
    from app.providers.router import get_router
    r = get_router()
    return {
        "ok": True,
        "providers_configured": r.get_available(),
        "tools_registered": len(__import__("app.tools.db_tools", fromlist=["TOOL_REGISTRY"]).TOOL_REGISTRY),
    }
