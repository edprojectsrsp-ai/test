"""
ingest_router.py — Document Vault API for Project Brain AI service.

Design decisions (locked):
  * ORIGINALS ARE KEPT. Every upload is written content-addressed to
    UPLOAD_DIR (sha256-prefixed) before any parsing. Chunks/embeddings/OKF
    are DERIVED and rebuildable; the original is the audit/legal source of
    truth (contracts especially) and enables re-chunk/re-embed later.
  * Every document carries keywords text[]: manual labels from the uploader
    merged with deterministic auto-extraction (codes like COB-7, domain
    acronyms like LD/PMC/DPR, salient terms, resolved entity codes).
    Keywords are filterable here AND by the AI via hybrid_search_documents.

Endpoints (mounted under /ai/ingest):
  POST   /upload                    multipart file + metadata → ingest
  POST   /text                      pasted WhatsApp export / letter text
  GET    /documents                 list w/ filters: q, type, scheme_id, keyword, channel
  GET    /documents/{id}            detail + chunk preview
  GET    /documents/{id}/download   the exact original bytes
  PATCH  /documents/{id}/keywords   replace labels
  DELETE /documents/{id}            soft delete
  GET    /schemes                   id+code+name for the frontend picker
  GET    /keywords                  distinct labels w/ counts (filter bar)
"""
from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.ingestion.ingest_v2 import (ingest_contract, ingest_correspondence,
                                     ingest_file, ingest_whatsapp_export)

router = APIRouter(prefix="/ai/ingest", tags=["ingest"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/var/project_brain/uploads")

ALLOWED_EXT = {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
DOC_TYPES = {"contract", "correspondence_in", "correspondence_out", "record_note",
             "drawing", "report", "other"}


def _db():
    dsn = (os.environ.get("PROJECT_BRAIN_DB_URL")
           or os.environ.get("DATABASE_URL")
           or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain")
    return psycopg2.connect(dsn)


def _save_original(raw: bytes, file_name: str) -> str:
    """Content-addressed permanent storage of the exact uploaded bytes."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    h = hashlib.sha256(raw).hexdigest()
    safe = os.path.basename(file_name).replace("/", "_")
    path = os.path.join(UPLOAD_DIR, f"{h[:16]}_{safe}")
    if not os.path.exists(path):          # dedupe identical uploads
        with open(path, "wb") as f:
            f.write(raw)
    return path


def _require_scheme(scheme_id: Optional[int]) -> int:
    """Require a real portfolio scheme before accepting project evidence."""
    if scheme_id is None:
        raise HTTPException(400, "scheme_id is required; link the document to a scheme")
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM scheme_master WHERE scheme_id=%s AND NOT coalesce(is_deleted, false)",
            (scheme_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(404, f"Scheme {scheme_id} not found")
    finally:
        conn.close()
    return scheme_id


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form("other"),
    title: str = Form(""),
    scheme_id: Optional[int] = Form(None),
    package_id: Optional[int] = Form(None),
    keywords: str = Form(""),             # comma-separated manual labels
    user_id: int = Form(1),
):
    scheme_id = _require_scheme(scheme_id)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type {ext}. Allowed: {sorted(ALLOWED_EXT)}")
    if document_type not in DOC_TYPES:
        raise HTTPException(400, f"document_type must be one of {sorted(DOC_TYPES)}")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    original_path = _save_original(raw, file.filename or "upload")
    manual_kw = [k.strip() for k in keywords.split(",") if k.strip()]

    # Parse from a temp copy; the original at original_path is never touched.
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        result = ingest_file(
            tmp_path,
            title=title or (file.filename or "Document"),
            document_type=document_type,
            scheme_id=scheme_id, package_id=package_id, user_id=user_id,
            keywords=manual_kw, file_path=original_path,
        )
    finally:
        os.unlink(tmp_path)
    return {**result, "original_stored": True, "file_path": original_path}


class TextIngest(BaseModel):
    text: str
    kind: str = "correspondence"          # whatsapp | correspondence | contract
    title: str = ""
    direction: str = "in"
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None
    keywords: list[str] = []
    user_id: int = 1


@router.post("/text")
async def ingest_text(payload: TextIngest):
    payload.scheme_id = _require_scheme(payload.scheme_id)
    if not payload.text.strip():
        raise HTTPException(400, "Empty text")
    original_path = _save_original(payload.text.encode(),
                                   f"{(payload.title or payload.kind)[:40]}.txt")
    common = dict(scheme_id=payload.scheme_id, package_id=payload.package_id,
                  user_id=payload.user_id, keywords=payload.keywords,
                  file_path=original_path)
    if payload.kind == "whatsapp":
        return ingest_whatsapp_export(payload.text,
                                      title=payload.title or "WhatsApp export", **common)
    if payload.kind == "contract":
        if not payload.title:
            raise HTTPException(400, "Contracts need a title")
        return ingest_contract(payload.text, title=payload.title, **common)
    return ingest_correspondence(payload.text, title=payload.title,
                                 direction=payload.direction, **common)


@router.get("/documents")
def list_documents(q: str = "", document_type: str = "", scheme_id: Optional[int] = None,
                   keyword: str = "", channel: str = "", limit: int = 50, offset: int = 0):
    conds = ["NOT d.is_deleted"]
    params: list = []
    if q:
        conds.append("(d.title ILIKE %s OR d.file_name ILIKE %s)")
        params += [f"%{q}%", f"%{q}%"]
    if document_type:
        conds.append("d.document_type::text = %s"); params.append(document_type)
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    if keyword:
        conds.append("EXISTS (SELECT 1 FROM unnest(d.keywords) kx WHERE kx ILIKE %s)")
        params.append(keyword)
    if channel:
        conds.append("d.ingest_channel = %s"); params.append(channel)
    params += [limit, offset]

    conn = _db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(f"""
        SELECT d.document_id, d.title, d.document_type::text, d.file_name,
               d.file_size_bytes, d.keywords, d.ingest_channel, d.scheme_id,
               sm.scheme_code, d.package_id, d.chunk_count, d.embedding_status,
               d.created_at,
               (SELECT count(*) FROM document_embeddings de
                JOIN document_chunks dc ON dc.chunk_id = de.chunk_id
                WHERE dc.document_id = d.document_id) AS embedded_chunks
        FROM documents d
        LEFT JOIN scheme_master sm ON sm.scheme_id = d.scheme_id
        WHERE {' AND '.join(conds)}
        ORDER BY d.created_at DESC
        LIMIT %s OFFSET %s
    """, tuple(params))
    rows = cur.fetchall()
    cur.execute(f"SELECT count(*) AS n FROM documents d WHERE {' AND '.join(conds[:len(conds)])}",
                tuple(params[:-2]))
    total = cur.fetchone()["n"]
    conn.close()
    return {"documents": rows, "total": total}


@router.get("/documents/{document_id}")
def document_detail(document_id: int):
    conn = _db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT d.*, d.document_type::text AS document_type, sm.scheme_code, sm.scheme_name
        FROM documents d LEFT JOIN scheme_master sm ON sm.scheme_id = d.scheme_id
        WHERE d.document_id=%s AND NOT d.is_deleted
    """, (document_id,))
    doc = cur.fetchone()
    if not doc:
        conn.close(); raise HTTPException(404, "Document not found")
    cur.execute("""
        SELECT dc.chunk_id, dc.chunk_no, left(dc.chunk_text, 400) AS preview,
               dc.chunk_tokens,
               EXISTS (SELECT 1 FROM document_embeddings de WHERE de.chunk_id=dc.chunk_id) AS embedded
        FROM document_chunks dc WHERE dc.document_id=%s ORDER BY dc.chunk_no LIMIT 50
    """, (document_id,))
    chunks = cur.fetchall()
    conn.close()
    return {"document": doc, "chunks": chunks}


@router.get("/documents/{document_id}/download")
def download_original(document_id: int):
    conn = _db()
    cur = conn.cursor()
    cur.execute("SELECT file_path, file_name, mime_type FROM documents WHERE document_id=%s AND NOT is_deleted",
                (document_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Document not found")
    path, name, mime = row
    if not path or not os.path.exists(path):
        raise HTTPException(410, "Original file not on disk (pre-vault document)")
    return FileResponse(path, filename=name, media_type=mime or "application/octet-stream")


class KeywordsPatch(BaseModel):
    keywords: list[str]


@router.patch("/documents/{document_id}/keywords")
def update_keywords(document_id: int, payload: KeywordsPatch):
    kw = [k.strip() for k in payload.keywords if k and k.strip()][:24]
    conn = _db()
    cur = conn.cursor()
    cur.execute("UPDATE documents SET keywords=%s WHERE document_id=%s AND NOT is_deleted RETURNING document_id",
                (kw, document_id))
    hit = cur.fetchone()
    conn.commit(); conn.close()
    if not hit:
        raise HTTPException(404, "Document not found")
    return {"document_id": document_id, "keywords": kw}


@router.delete("/documents/{document_id}")
def soft_delete(document_id: int):
    conn = _db()
    cur = conn.cursor()
    cur.execute("UPDATE documents SET is_deleted=TRUE WHERE document_id=%s RETURNING document_id",
                (document_id,))
    hit = cur.fetchone()
    conn.commit(); conn.close()
    if not hit:
        raise HTTPException(404, "Document not found")
    return {"deleted": document_id, "note": "Soft-deleted; original file retained on disk for audit."}


@router.get("/schemes")
def schemes_for_picker():
    conn = _db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT scheme_id, scheme_code, scheme_name FROM scheme_master
        WHERE NOT coalesce(is_deleted, false) ORDER BY scheme_code
    """)
    rows = cur.fetchall()
    conn.close()
    return rows


@router.get("/keywords")
def keyword_cloud(limit: int = 40):
    conn = _db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT kx AS keyword, count(*) AS n
        FROM documents d, unnest(d.keywords) kx
        WHERE NOT d.is_deleted
        GROUP BY kx ORDER BY n DESC, kx LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    conn.close()
    return rows
