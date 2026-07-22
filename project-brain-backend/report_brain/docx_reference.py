"""Parse approved DOCX reports into the same rough block shape as Report Brain.

The parser is deliberately conservative. It preserves what is easy to compare
well (headings, paragraphs, tables, and bullet groups) and leaves layout
fidelity to the original uploaded file.
"""
from __future__ import annotations

from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph


SECTION_HINTS = (
    ("present status", "present_status"),
    ("progress of the project", "present_status"),
    ("reasons", "issues"),
    ("issues", "issues"),
    ("constraints", "issues"),
    ("action taken", "actions"),
    ("actions", "actions"),
    ("manpower", "manpower"),
    ("milestone", "milestones"),
)


def _iter_blocks(doc: DocumentObject):
    body = doc.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, doc)
        elif isinstance(child, CT_Tbl):
            yield Table(child, doc)


def _paragraph_text(paragraph: Paragraph) -> str:
    return " ".join(paragraph.text.split())


def _looks_like_heading(paragraph: Paragraph) -> bool:
    text = _paragraph_text(paragraph)
    if not text:
        return False
    style = (paragraph.style.name or "").lower() if paragraph.style else ""
    if style.startswith("heading"):
        return True
    if len(text) <= 120 and any(run.bold or run.underline for run in paragraph.runs):
        return True
    letters = [c for c in text if c.isalpha()]
    return 8 <= len(text) <= 90 and letters and sum(c.isupper() for c in letters) / len(letters) > 0.75


def _is_bullet(paragraph: Paragraph) -> bool:
    style = (paragraph.style.name or "").lower() if paragraph.style else ""
    if "bullet" in style or "list" in style:
        return True
    ppr = paragraph._p.pPr
    return bool(ppr is not None and ppr.numPr is not None)


def _section_from_heading(text: str) -> str:
    low = text.lower()
    for needle, section in SECTION_HINTS:
        if needle in low:
            return section
    return "present_status"


def _table_to_block(table: Table, title: str = "") -> dict:
    grid = [
        [" ".join(cell.text.split()) for cell in row.cells]
        for row in table.rows
    ]
    if not grid:
        return {"kind": "table", "title": title, "columns": [], "rows": [], "source": "uploaded", "editable_cells": True}
    columns = grid[0]
    rows = grid[1:] if len(grid) > 1 else []
    return {
        "kind": "table",
        "title": title,
        "columns": columns,
        "rows": rows,
        "source": "uploaded",
        "editable_cells": True,
    }


def parse_docx_reference(path: str, *, family: str, project: str, month: str, title: str = "") -> dict:
    doc = Document(path)
    blocks: list[dict] = []
    current_heading = ""
    pending_bullets: list[dict] = []
    pending_table_title = ""

    def flush_bullets() -> None:
        nonlocal pending_bullets
        if not pending_bullets:
            return
        blocks.append({
            "kind": "narrative",
            "section": _section_from_heading(current_heading),
            "title": current_heading or "Narrative",
            "project": project,
            "style": f"{family}_uploaded",
            "bullets": pending_bullets,
        })
        pending_bullets = []

    for item in _iter_blocks(doc):
        if isinstance(item, Paragraph):
            text = _paragraph_text(item)
            if not text:
                continue
            if _is_bullet(item):
                pending_bullets.append({
                    "text": text,
                    "discipline": "",
                    "grounded": True,
                    "source_ref": "uploaded_final",
                })
                continue

            flush_bullets()
            if _looks_like_heading(item):
                current_heading = text
                blocks.append({"kind": "heading", "roman": "", "text": text})
                pending_table_title = text
            else:
                blocks.append({"kind": "para", "text": text, "editable": True})
                pending_table_title = text if len(text) <= 120 else ""
        elif isinstance(item, Table):
            flush_bullets()
            blocks.append(_table_to_block(item, pending_table_title))
            pending_table_title = ""

    flush_bullets()
    return {
        "family": family,
        "title": title or f"{family.upper()} Reference",
        "project": project,
        "month": month,
        "blocks": blocks,
    }
