"""
ingest_v2.py — universal project-document ingestion for Project Brain RAG.

Channels:
  ingest_whatsapp_export(path|text, ...)  — WhatsApp chat .txt export.
      Two-pass parse (learn senders from full history, then window), message-
      window chunking so each chunk is a coherent slice of conversation.
  ingest_correspondence(text, ...)         — letters / emails / DO letters.
      Paragraph chunking; subject line pulled into the title if present.
  ingest_contract(path|text, ...)          — clause-aware chunking: splits on
      numbered clauses (1., 1.1, ARTICLE IV, Clause 12) so retrieval returns
      whole clauses, not arbitrary word windows.
  ingest_file(path, ...)                   — anything else: PDF/DOCX/TXT via
      the existing extractors, paragraph chunking.

All writes stamp embeddings with embedding_model + embedding_dim (the columns
already exist in the live schema — v1 code never populated embedding_model,
which is what made mixed-model similarity meaningless). One model per
deployment, enforced at query time by filtering on the stamp.
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime
from typing import Callable, Optional

import psycopg2

EMBED_MODEL_NAME = os.environ.get("EMBED_MODEL", "all-mpnet-base-v2")
EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))


def _rw():
    dsn = (
        os.environ.get("PROJECT_BRAIN_DB_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain"
    )
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    return conn


# ---------------------------------------------------------------------------
# WhatsApp export parsing (two-pass, format-tolerant)
# ---------------------------------------------------------------------------

# Matches both "12/07/26, 10:41 - Name: msg" and "[12/07/2026, 10:41:03] Name: msg"
_WA_LINE = re.compile(
    r"^\[?(\d{1,2}/\d{1,2}/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*[-–]?\s*"
    r"(?:([^:]{1,60}?):\s)?(.*)$"
)
_WA_SYSTEM_HINTS = ("Messages and calls are end-to-end encrypted",
                    "created group", "added you", "changed the subject",
                    "<Media omitted>", "This message was deleted")


def parse_whatsapp(text: str) -> list[dict]:
    """Two-pass: pass 1 learns the sender set from the whole file; pass 2
    emits messages, folding continuation lines and inline-numbered lines into
    the previous message (the gold-pair fix from the Monthly Report Brain)."""
    lines = text.splitlines()
    senders: set[str] = set()
    for ln in lines:  # pass 1
        m = _WA_LINE.match(ln)
        if m and m.group(3):
            senders.add(m.group(3).strip())

    msgs: list[dict] = []
    for ln in lines:  # pass 2
        m = _WA_LINE.match(ln)
        if m:
            sender = (m.group(3) or "").strip()
            body = m.group(4).strip()
            if any(h in body for h in _WA_SYSTEM_HINTS):
                continue
            if sender and sender in senders:
                msgs.append({"date": m.group(1), "time": m.group(2),
                             "sender": sender, "text": body})
                continue
            # timestamped line without a known sender → continuation
            if msgs:
                msgs[-1]["text"] += "\n" + ln.strip()
            continue
        if msgs and ln.strip():  # plain continuation (incl. inline numbering "2. ...")
            msgs[-1]["text"] += "\n" + ln.strip()
    return msgs


def chunk_whatsapp(msgs: list[dict], window: int = 25, overlap: int = 5) -> list[str]:
    chunks = []
    i = 0
    while i < len(msgs):
        win = msgs[i:i + window]
        lines = [f"[{m['date']} {m['time']}] {m['sender']}: {m['text']}" for m in win]
        chunks.append("\n".join(lines))
        if i + window >= len(msgs):
            break
        i += window - overlap
    return chunks


# ---------------------------------------------------------------------------
# Contract clause-aware chunking
# ---------------------------------------------------------------------------

_CLAUSE_HEAD = re.compile(
    r"(?m)^(?=\s*(?:ARTICLE\s+[IVXLC0-9]+|CLAUSE\s+\d+|SECTION\s+\d+|\d{1,2}\.(?:\d{1,2}\.?)?\s+[A-Z]))"
)


def chunk_contract(text: str, max_words: int = 450, min_words: int = 40) -> list[str]:
    """One chunk per clause (retrieval returns whole clauses). Tiny clauses
    (< min_words, e.g. definition one-liners) merge forward; oversized clauses
    fall back to paragraph splitting."""
    parts = [p.strip() for p in _CLAUSE_HEAD.split(text) if p and p.strip()]
    if len(parts) <= 1:
        return chunk_paragraphs(text, max_words)
    out: list[str] = []
    buf: list[str] = []
    n = 0
    for p in parts:
        w = len(p.split())
        if w > max_words:
            if buf:
                out.append("\n\n".join(buf)); buf, n = [], 0
            out.extend(chunk_paragraphs(p, max_words))
            continue
        buf.append(p); n += w
        if n >= min_words:
            out.append("\n\n".join(buf)); buf, n = [], 0
    if buf:
        out.append("\n\n".join(buf))
    return out


def chunk_paragraphs(text: str, max_words: int = 400, overlap_words: int = 40) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    buf: list[str] = []
    n = 0
    for p in paras:
        w = len(p.split())
        if n + w > max_words and buf:
            out.append("\n\n".join(buf))
            tail = " ".join(" ".join(buf).split()[-overlap_words:])
            buf, n = [tail], len(tail.split())
        buf.append(p); n += w
    if buf:
        out.append("\n\n".join(buf))
    if not out and text.strip():
        words = text.split()
        for i in range(0, len(words), max_words):
            out.append(" ".join(words[i:i + max_words]))
    return out


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _store_document(cur, *, title: str, document_type: str, channel: str,
                    file_name: str, raw: bytes, scheme_id: Optional[int],
                    package_id: Optional[int], user_id: int, mime: str,
                    keywords: Optional[list[str]] = None,
                    file_path: Optional[str] = None) -> int:
    h = hashlib.sha256(raw).hexdigest()
    cur.execute("""
        INSERT INTO documents (scheme_id, package_id, document_type, title,
                               file_name, file_path, file_size_bytes, file_hash, mime_type,
                               extraction_status, embedding_status, uploaded_by, ingest_channel,
                               keywords)
        VALUES (%s, %s, %s::document_type_enum, %s, %s, %s, %s, %s, %s,
                'completed', 'pending', %s, %s, %s)
        RETURNING document_id
    """, (scheme_id, package_id, document_type, title, file_name,
          file_path or f"ingest_v2/{h[:16]}_{file_name}", len(raw), h, mime,
          user_id, channel, keywords or None))
    return cur.fetchone()[0]


def _auto_keywords(text: str, title: str, manual: Optional[list[str]]) -> list[str]:
    """Auto-label + merge manual + resolved entity codes. Never raises."""
    try:
        from app.ingestion.keywords import extract_keywords, merge_keywords
        auto = extract_keywords(text, title)
        entity_codes: list[str] = []
        try:
            from app.services.retrieval import resolve_entities
            res = resolve_entities(f"{title} {text[:2000]}")
            entity_codes = [c["canonical"].split(" — ")[0]
                            for c in res.get("resolved", [])][:4]
        except Exception:
            pass
        return merge_keywords(auto, manual, entity_codes)
    except Exception:
        return manual or []


def _store_chunks(cur, document_id: int, chunks: list[str]) -> list[int]:
    ids = []
    for no, text in enumerate(chunks):
        cur.execute("""
            INSERT INTO document_chunks (document_id, chunk_no, chunk_text, chunk_tokens)
            VALUES (%s, %s, %s, %s) RETURNING chunk_id
        """, (document_id, no, text, len(text.split())))
        ids.append(cur.fetchone()[0])
    cur.execute("UPDATE documents SET chunk_count=%s WHERE document_id=%s",
                (len(ids), document_id))
    return ids


def embed_and_store(chunk_ids: list[int],
                    embedder: Optional[Callable[[str], Optional[list[float]]]] = None,
                    model_name: str = EMBED_MODEL_NAME) -> dict:
    """Embed chunks and store WITH the model stamp. If no embedder is
    available, mark documents text-search-only — hybrid search still works
    on its FTS + trigram arms."""
    if embedder is None:
        try:
            from app.services.embeddings_service import embed_text as embedder  # type: ignore
        except Exception:
            embedder = None

    conn = _rw()
    done, skipped = 0, 0
    try:
        cur = conn.cursor()
        for cid in chunk_ids:
            cur.execute("SELECT chunk_text FROM document_chunks WHERE chunk_id=%s", (cid,))
            row = cur.fetchone()
            if not row:
                continue
            vec = embedder(row[0]) if embedder else None
            if vec is None:
                skipped += 1
                continue
            cur.execute("""
                INSERT INTO document_embeddings (chunk_id, embedding_model, embedding_dim, embedding)
                VALUES (%s, %s, %s, %s::vector)
                ON CONFLICT (chunk_id, embedding_model) DO UPDATE SET
                    embedding_dim = EXCLUDED.embedding_dim,
                    embedding = EXCLUDED.embedding,
                    created_at = now()
            """, (cid, model_name, len(vec), str(vec)))
            done += 1
        cur.execute("""
            UPDATE documents SET embedding_status = CASE WHEN %s > 0 THEN 'completed' ELSE 'skipped' END
            WHERE document_id IN (SELECT DISTINCT document_id FROM document_chunks WHERE chunk_id = ANY(%s))
        """, (done, chunk_ids))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"embedded": done, "skipped": skipped, "model": model_name}


# ---------------------------------------------------------------------------
# Public channel ingesters
# ---------------------------------------------------------------------------

def ingest_whatsapp_export(text: str, *, title: str, scheme_id: int = None,
                           package_id: int = None, user_id: int = 1,
                           embedder=None, keywords: list = None,
                           file_path: str = None) -> dict:
    msgs = parse_whatsapp(text)
    chunks = chunk_whatsapp(msgs)
    kw = _auto_keywords(text, title, keywords)
    conn = _rw()
    try:
        cur = conn.cursor()
        doc_id = _store_document(cur, title=title, document_type="correspondence_in",
                                 channel="whatsapp", file_name=f"{title}.txt",
                                 raw=text.encode(), scheme_id=scheme_id,
                                 package_id=package_id, user_id=user_id, mime="text/plain",
                                 keywords=kw, file_path=file_path)
        chunk_ids = _store_chunks(cur, doc_id, chunks)
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()
    emb = embed_and_store(chunk_ids, embedder)
    return {"document_id": doc_id, "messages": len(msgs), "chunks": len(chunk_ids), **emb}


def ingest_correspondence(text: str, *, title: str = "", direction: str = "in",
                          scheme_id: int = None, package_id: int = None,
                          user_id: int = 1, embedder=None, keywords: list = None,
                          file_path: str = None) -> dict:
    if not title:
        m = re.search(r"(?im)^sub(?:ject)?\s*[:\-]\s*(.+)$", text)
        title = (m.group(1).strip()[:200] if m else "Correspondence " + datetime.now().strftime("%d-%m-%Y"))
    chunks = chunk_paragraphs(text)
    kw = _auto_keywords(text, title, keywords)
    dt = "correspondence_in" if direction == "in" else "correspondence_out"
    conn = _rw()
    try:
        cur = conn.cursor()
        doc_id = _store_document(cur, title=title, document_type=dt, channel="email",
                                 file_name=f"{title[:40]}.txt", raw=text.encode(),
                                 scheme_id=scheme_id, package_id=package_id,
                                 user_id=user_id, mime="text/plain",
                                 keywords=kw, file_path=file_path)
        chunk_ids = _store_chunks(cur, doc_id, chunks)
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()
    emb = embed_and_store(chunk_ids, embedder)
    return {"document_id": doc_id, "chunks": len(chunk_ids), "title": title, **emb}


def ingest_contract(text: str, *, title: str, scheme_id: int = None,
                    package_id: int = None, user_id: int = 1, embedder=None,
                    keywords: list = None, file_path: str = None,
                    file_name: str = None, raw: bytes = None,
                    mime: str = "text/plain") -> dict:
    chunks = chunk_contract(text)
    kw = _auto_keywords(text, title, keywords)
    conn = _rw()
    try:
        cur = conn.cursor()
        doc_id = _store_document(cur, title=title, document_type="contract",
                                 channel="upload",
                                 file_name=file_name or f"{title[:40]}.txt",
                                 raw=raw if raw is not None else text.encode(),
                                 scheme_id=scheme_id,
                                 package_id=package_id, user_id=user_id, mime=mime,
                                 keywords=kw, file_path=file_path)
        chunk_ids = _store_chunks(cur, doc_id, chunks)
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()
    emb = embed_and_store(chunk_ids, embedder)
    return {"document_id": doc_id, "chunks": len(chunk_ids), **emb}


def ingest_file(path: str, *, title: str = "", document_type: str = "other",
                scheme_id: int = None, package_id: int = None,
                user_id: int = 1, embedder=None, keywords: list = None,
                file_path: str = None, channel: str = "upload") -> dict:
    """Generic file: reuse the existing extractors from processor.py."""
    from app.ingestion.processor import extract_text
    text, _pages, _needs_ocr = extract_text(path)
    title = title or os.path.basename(path)
    with open(path, "rb") as f:
        raw = f.read()
    if document_type == "contract":
        return ingest_contract(text, title=title, scheme_id=scheme_id,
                               package_id=package_id, user_id=user_id, embedder=embedder,
                               keywords=keywords, file_path=file_path,
                               file_name=os.path.basename(path), raw=raw,
                               mime="application/octet-stream")
    chunks = chunk_paragraphs(text)
    kw = _auto_keywords(text, title, keywords)
    conn = _rw()
    try:
        cur = conn.cursor()
        doc_id = _store_document(cur, title=title, document_type=document_type,
                                 channel=channel, file_name=os.path.basename(path),
                                 raw=raw, scheme_id=scheme_id, package_id=package_id,
                                 user_id=user_id, mime="application/octet-stream",
                                 keywords=kw, file_path=file_path)
        chunk_ids = _store_chunks(cur, doc_id, chunks)
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()
    emb = embed_and_store(chunk_ids, embedder)
    return {"document_id": doc_id, "chunks": len(chunk_ids), **emb}
