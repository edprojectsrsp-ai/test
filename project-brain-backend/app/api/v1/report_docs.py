"""
Report Documents — upload, view, edit-in-place, export (Word/PDF).

Stores .docx files as HTML in `record_notes` (note_type='report_doc').
On upload: mammoth converts .docx → HTML → stored as `body`.
On edit:   PUT updates the `body` HTML.
On export: htmldocx converts HTML → .docx; reportlab for PDF.

No schema change needed — uses the existing record_notes table.

Mount at:  /api/v1/report-docs
Depends:   mammoth, python-docx, htmldocx, reportlab (all pip-installable)
"""

import io
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.database import get_db

router = APIRouter(tags=["Report Documents"])


# ============================================================================
# 1) POST /upload  →  upload a .docx, convert to HTML, store in DB
# ============================================================================
@router.post("/upload")
async def upload_report_doc(
    title: str = "Untitled Report",
    scheme_id: int = 74,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith((".docx", ".doc")):
        raise HTTPException(status_code=400, detail="Only .docx files accepted")

    raw = await file.read()

    # Convert .docx → HTML via mammoth
    try:
        import mammoth
        result = mammoth.convert_to_html(io.BytesIO(raw))
        html = result.value
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse .docx: {e}")

    # Store the original .docx bytes as base64 in extra_fields for re-export
    import base64
    docx_b64 = base64.b64encode(raw).decode("ascii")

    # Create a slug from the filename
    slug = file.filename.rsplit(".", 1)[0].lower().replace(" ", "-").replace("_", "-")

    # Upsert: if a doc with this slug already exists, update it
    existing = db.execute(text("""
        SELECT note_id FROM record_notes
        WHERE note_type='report_doc' AND extra_fields->>'doc_key' = :k AND is_deleted=FALSE
        LIMIT 1
    """), {"k": slug}).first()

    ef = json.dumps({
        "doc_key": slug,
        "original_filename": file.filename,
        "original_docx_b64": docx_b64,
    })

    if existing:
        db.execute(text("""
            UPDATE record_notes
            SET title = :t, body = :b, extra_fields = CAST(:ef AS jsonb),
                updated_at = CURRENT_TIMESTAMP
            WHERE note_id = :id
        """), {"t": title, "b": html, "ef": ef, "id": existing.note_id})
        note_id = existing.note_id
    else:
        note_id = db.execute(text("""
            INSERT INTO record_notes (
                scheme_id, note_type, title, body, extra_fields,
                is_deleted, created_by, created_at, updated_at
            ) VALUES (
                :sid, 'report_doc', :t, :b, CAST(:ef AS jsonb),
                FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            ) RETURNING note_id
        """), {"sid": scheme_id, "t": title, "b": html, "ef": ef}).scalar()

    db.commit()
    return {
        "ok": True,
        "note_id": note_id,
        "slug": slug,
        "title": title,
        "html_length": len(html),
    }


# ============================================================================
# 2) GET /list  →  all report docs
# ============================================================================
@router.get("/list")
def list_report_docs(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT note_id, title,
               extra_fields->>'doc_key' AS slug,
               extra_fields->>'original_filename' AS filename,
               created_at, updated_at
        FROM record_notes
        WHERE note_type = 'report_doc' AND is_deleted = FALSE
        ORDER BY updated_at DESC NULLS LAST
    """)).fetchall()
    return [{
        "note_id": r.note_id,
        "title": r.title,
        "slug": r.slug,
        "filename": r.filename,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    } for r in rows]


# ============================================================================
# 3) GET /{slug}  →  get one doc's HTML
# ============================================================================
@router.get("/{slug}")
def get_report_doc(slug: str, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT note_id, title, body, extra_fields, updated_at
        FROM record_notes
        WHERE note_type='report_doc' AND extra_fields->>'doc_key' = :k AND is_deleted=FALSE
        ORDER BY updated_at DESC NULLS LAST LIMIT 1
    """), {"k": slug}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    ef = row.extra_fields or {}
    return {
        "note_id": row.note_id,
        "title": row.title,
        "slug": slug,
        "html": row.body,
        "filename": ef.get("original_filename"),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ============================================================================
# 4) PUT /{slug}  →  save edited HTML
# ============================================================================
@router.put("/{slug}")
def save_report_doc(slug: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    html = payload.get("html", "")
    title = payload.get("title")
    if not html.strip():
        raise HTTPException(status_code=400, detail="Empty document")

    existing = db.execute(text("""
        SELECT note_id FROM record_notes
        WHERE note_type='report_doc' AND extra_fields->>'doc_key' = :k AND is_deleted=FALSE
        LIMIT 1
    """), {"k": slug}).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Document not found")

    sets = ["body = :b", "updated_at = CURRENT_TIMESTAMP"]
    params = {"b": html, "id": existing.note_id}
    if title:
        sets.append("title = :t")
        params["t"] = title

    db.execute(text(f"UPDATE record_notes SET {', '.join(sets)} WHERE note_id = :id"), params)
    db.commit()
    return {"ok": True, "updated_at": datetime.utcnow().isoformat()}


# ============================================================================
# 5) GET /{slug}/export?format=docx|pdf  →  download
# ============================================================================
@router.get("/{slug}/export")
def export_report_doc(slug: str, format: str = "docx", db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT title, body, extra_fields FROM record_notes
        WHERE note_type='report_doc' AND extra_fields->>'doc_key' = :k AND is_deleted=FALSE
        LIMIT 1
    """), {"k": slug}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    title = row.title or slug
    html = row.body or ""

    if format == "docx":
        return _export_docx(html, title)
    elif format == "pdf":
        return _export_pdf(html, title)
    else:
        raise HTTPException(status_code=400, detail="format must be 'docx' or 'pdf'")


def _export_docx(html: str, title: str):
    try:
        from docx import Document
        from htmldocx import HtmlToDocx
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"DOCX export dependency missing. Install: python-docx htmldocx ({e})",
        )

    doc = Document()
    # Set narrow margins for A4
    for section in doc.sections:
        section.top_margin = 914400     # 1 inch
        section.bottom_margin = 914400
        section.left_margin = 914400
        section.right_margin = 914400

    parser = HtmlToDocx()
    parser.add_html_to_document(html, doc)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)

    safe_name = title.replace(" ", "_")[:50] + ".docx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


def _export_pdf(html: str, title: str):
    """Simple PDF export via reportlab. For complex HTML, weasyprint is better
    but requires system-level install. This gives a clean basic PDF."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"PDF export dependency missing. Install: reportlab ({e})",
        )
    import re

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=18*mm, rightMargin=18*mm,
                            topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story = []

    # Strip HTML to paragraphs (simple approach — good for text-heavy docs)
    # For full HTML→PDF fidelity, install weasyprint
    text_content = re.sub(r'<br\s*/?>', '\n', html)
    text_content = re.sub(r'<[^>]+>', '', text_content)
    for line in text_content.split('\n'):
        line = line.strip()
        if line:
            story.append(Paragraph(line, styles['Normal']))
        else:
            story.append(Spacer(1, 4*mm))

    doc.build(story)
    buf.seek(0)
    safe_name = title.replace(" ", "_")[:50] + ".pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# ============================================================================
# 6) DELETE /{slug}  →  soft-delete
# ============================================================================
@router.delete("/{slug}")
def delete_report_doc(slug: str, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE record_notes SET is_deleted = TRUE
        WHERE note_type='report_doc' AND extra_fields->>'doc_key' = :k
    """), {"k": slug})
    db.commit()
    return {"ok": True}
