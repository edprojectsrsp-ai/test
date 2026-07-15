"""memory_tools.py — the continual-learning layer for Project Brain AI.

Adds three capabilities the stack was missing:
  1. TAUGHT FACTS (cross-session memory + correction loop)
       User: "The MECON contract order date is 16.03.2026 — use that, not the DB field."
       -> remember_fact(authority=True). Every future conversation recalls it and
          the orchestrator injects authoritative facts into grounding, so the
          same mistake is never repeated. This IS practical continual learning —
          no fine-tuning, fully auditable, instantly correctable.
  2. FEEDBACK LOG (thumbs + corrections per answer, mined for facts)
  3. MINISTRY FORMAT TEMPLATES
       Ministry sends a table format ("orders placed in last 3 years" with THEIR
       column headings). Save it once by name; any future ask like
       "fill the MoS order-history format for COB-7" retrieves the exact column
       spec + notes and hands it to the custom_report safe-SQL engine so output
       lands in THEIR format, exportable via report_export (xlsx/docx/pdf).

Self-registering via the standard @register_tool decorator — importing this
module is the whole integration (plus one optional grounding hook, see bottom).
All writes go through a dedicated writable connection; the read-only tool
connection is untouched. DDL is idempotent and runs lazily on first use.
"""
from __future__ import annotations

import json
import os
import re
from typing import Optional

import psycopg2
import psycopg2.extras

from app.tools.db_tools import register_tool, query

# ---------------------------------------------------------------------------
# Writable connection (taught facts / feedback / templates are the ONLY writes)
# ---------------------------------------------------------------------------

def _rw_conn():
    dsn = (
        os.environ.get("PROJECT_BRAIN_DB_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain"
    )
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn


def _exec(sql: str, params: tuple = ()) -> None:
    conn = _rw_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
    finally:
        conn.close()


_DDL_DONE = False

def _ensure_ddl() -> None:
    global _DDL_DONE
    if _DDL_DONE:
        return
    _exec("""
    CREATE TABLE IF NOT EXISTS ai_taught_facts (
        id           serial PRIMARY KEY,
        subject      text NOT NULL,
        fact         text NOT NULL,
        authority    boolean NOT NULL DEFAULT true,
        scheme_id    integer,
        taught_by    text,
        source_conversation_id integer,
        created_at   timestamptz NOT NULL DEFAULT now(),
        expires_at   timestamptz,
        is_deleted   boolean NOT NULL DEFAULT false,
        tsv          tsvector GENERATED ALWAYS AS
                     (to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(fact,''))) STORED
    );
    CREATE INDEX IF NOT EXISTS ai_taught_facts_tsv_idx ON ai_taught_facts USING gin(tsv);

    CREATE TABLE IF NOT EXISTS ai_feedback (
        id              serial PRIMARY KEY,
        conversation_id integer,
        message_id      integer,
        verdict         text NOT NULL,            -- 'up' | 'down' | 'correction'
        correction_text text,
        created_at      timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ai_format_templates (
        id           serial PRIMARY KEY,
        name         text UNIQUE NOT NULL,
        description  text,
        columns      jsonb NOT NULL,              -- [{"heading": "...", "meaning": "...", "example": "..."}]
        row_grain    text,                        -- what one row represents
        filters_note text,                        -- e.g. "last 3 financial years"
        file_kind    text DEFAULT 'xlsx',
        created_by   text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        is_deleted   boolean NOT NULL DEFAULT false
    );
    """)
    _DDL_DONE = True


# ---------------------------------------------------------------------------
# 1) TAUGHT FACTS — cross-session memory + corrections
# ---------------------------------------------------------------------------

@register_tool(
    name="remember_fact",
    description=(
        "Persist a user-taught fact or correction so ALL future conversations use it. "
        "Use when the user teaches ground truth (e.g. 'use 16.03.2026 as the MECON order "
        "placement date', 'COB-7 heating-up is 90 days, not 60'). authority=true means it "
        "OVERRIDES conflicting database/document values in answers."
    ),
    parameters={
        "type": "object",
        "properties": {
            "subject": {"type": "string", "description": "Short key, e.g. 'MECON contract order date'"},
            "fact": {"type": "string", "description": "The fact exactly as taught"},
            "authority": {"type": "boolean", "description": "Override conflicting data (default true)", "default": True},
            "scheme_id": {"type": "integer", "description": "Optional scheme this fact belongs to"},
            "taught_by": {"type": "string", "description": "Who taught it (username), optional"},
        },
        "required": ["subject", "fact"],
    },
)
def remember_fact(subject: str, fact: str, authority: bool = True,
                  scheme_id: Optional[int] = None, taught_by: Optional[str] = None):
    _ensure_ddl()
    # supersede older facts on the same subject (case-insensitive)
    _exec("UPDATE ai_taught_facts SET is_deleted = true WHERE lower(subject) = lower(%s) AND NOT is_deleted",
          (subject,))
    _exec("""INSERT INTO ai_taught_facts (subject, fact, authority, scheme_id, taught_by)
             VALUES (%s, %s, %s, %s, %s)""",
          (subject.strip(), fact.strip(), bool(authority), scheme_id, taught_by))
    return {"remembered": True, "subject": subject,
            "note": "This fact now applies to all future conversations" + (" and overrides conflicting data." if authority else ".")}


@register_tool(
    name="recall_facts",
    description=(
        "Retrieve user-taught facts/corrections relevant to a topic. Call this BEFORE "
        "answering questions about dates, costs, or project specifics that a user may "
        "have corrected earlier. Authoritative facts MUST be preferred over DB values."
    ),
    parameters={
        "type": "object",
        "properties": {
            "topic": {"type": "string", "description": "What the question is about"},
            "scheme_id": {"type": "integer", "description": "Optional scheme filter"},
            "limit": {"type": "integer", "default": 8},
        },
        "required": ["topic"],
    },
)
def recall_facts(topic: str, scheme_id: Optional[int] = None, limit: int = 8):
    _ensure_ddl()
    rows = query("""
        SELECT id, subject, fact, authority, scheme_id, taught_by, created_at::text AS created_at,
               ts_rank(tsv, plainto_tsquery('english', %s)) AS rank
        FROM ai_taught_facts
        WHERE NOT is_deleted
          AND (expires_at IS NULL OR expires_at > now())
          AND (%s::int IS NULL OR scheme_id IS NULL OR scheme_id = %s)
          AND (tsv @@ plainto_tsquery('english', %s) OR subject ILIKE '%%' || %s || '%%')
        ORDER BY authority DESC, rank DESC NULLS LAST, created_at DESC
        LIMIT %s
    """, (topic, scheme_id, scheme_id, topic, topic, limit))
    return {"facts": rows, "count": len(rows),
            "instruction": "Facts with authority=true override conflicting database or document values."}


@register_tool(
    name="forget_fact",
    description="Soft-delete a taught fact by id or by exact subject (user asked to forget/undo a correction).",
    parameters={
        "type": "object",
        "properties": {
            "fact_id": {"type": "integer"},
            "subject": {"type": "string"},
        },
        "required": [],
    },
)
def forget_fact(fact_id: Optional[int] = None, subject: Optional[str] = None):
    _ensure_ddl()
    if fact_id is None and not subject:
        return {"error": "Provide fact_id or subject."}
    if fact_id is not None:
        _exec("UPDATE ai_taught_facts SET is_deleted = true WHERE id = %s", (fact_id,))
    else:
        _exec("UPDATE ai_taught_facts SET is_deleted = true WHERE lower(subject) = lower(%s)", (subject,))
    return {"forgotten": True}


# ---------------------------------------------------------------------------
# 2) FEEDBACK — thumbs + corrections, mined into facts
# ---------------------------------------------------------------------------

_TEACH_PATTERNS = [
    re.compile(r"\buse\s+(.+?)\s+as\s+(?:the\s+)?(.+)", re.I),      # "use X as the Y"
    re.compile(r"\b(?:the\s+)?(.+?)\s+is\s+actually\s+(.+)", re.I), # "Y is actually X"
    re.compile(r"\bcorrect\s+(.+?)\s+to\s+(.+)", re.I),             # "correct Y to X"
]

@register_tool(
    name="log_feedback",
    description=(
        "Record user feedback on an answer ('up' | 'down' | 'correction'). If the feedback "
        "contains a factual correction (e.g. 'wrong — use 16.03.2026 as the order date'), "
        "it is ALSO auto-persisted as an authoritative taught fact."
    ),
    parameters={
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["up", "down", "correction"]},
            "correction_text": {"type": "string", "description": "The user's correction, verbatim"},
            "conversation_id": {"type": "integer"},
            "message_id": {"type": "integer"},
        },
        "required": ["verdict"],
    },
)
def log_feedback(verdict: str, correction_text: Optional[str] = None,
                 conversation_id: Optional[int] = None, message_id: Optional[int] = None):
    _ensure_ddl()
    _exec("""INSERT INTO ai_feedback (conversation_id, message_id, verdict, correction_text)
             VALUES (%s, %s, %s, %s)""",
          (conversation_id, message_id, verdict, correction_text))
    mined = None
    if correction_text:
        for pat in _TEACH_PATTERNS:
            m = pat.search(correction_text)
            if m:
                value, subject = (m.group(1), m.group(2)) if pat is _TEACH_PATTERNS[0] else (m.group(2), m.group(1))
                subject = subject.strip(" .").rstrip("?!")
                remember_fact(subject=subject[:120], fact=f"{subject} = {value.strip(' .')}",
                              authority=True)
                mined = {"subject": subject[:120], "value": value.strip(" .")}
                break
    return {"logged": True, "mined_fact": mined}


# ---------------------------------------------------------------------------
# 3) MINISTRY FORMAT TEMPLATES — output in THEIR table, not ours
# ---------------------------------------------------------------------------

@register_tool(
    name="save_format_template",
    description=(
        "Save a report/table format (e.g. a ministry-supplied format like 'orders placed in "
        "last 3 years') so future questions can be answered IN THAT EXACT FORMAT. Capture "
        "every column heading in order plus what each column means."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Template name, e.g. 'MoS Order History 3Y'"},
            "description": {"type": "string"},
            "columns": {
                "type": "array",
                "description": "Ordered columns: heading + meaning (+ example)",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "meaning": {"type": "string"},
                        "example": {"type": "string"},
                    },
                    "required": ["heading"],
                },
            },
            "row_grain": {"type": "string", "description": "What one row represents, e.g. 'one purchase order'"},
            "filters_note": {"type": "string", "description": "Standing filters, e.g. 'orders in last 3 financial years'"},
            "file_kind": {"type": "string", "enum": ["xlsx", "docx", "pdf"], "default": "xlsx"},
        },
        "required": ["name", "columns"],
    },
)
def save_format_template(name: str, columns: list, description: Optional[str] = None,
                         row_grain: Optional[str] = None, filters_note: Optional[str] = None,
                         file_kind: str = "xlsx"):
    _ensure_ddl()
    _exec("""
        INSERT INTO ai_format_templates (name, description, columns, row_grain, filters_note, file_kind)
        VALUES (%s, %s, %s::jsonb, %s, %s, %s)
        ON CONFLICT (name) DO UPDATE
        SET description = EXCLUDED.description, columns = EXCLUDED.columns,
            row_grain = EXCLUDED.row_grain, filters_note = EXCLUDED.filters_note,
            file_kind = EXCLUDED.file_kind, updated_at = now(), is_deleted = false
    """, (name.strip(), description, json.dumps(columns), row_grain, filters_note, file_kind))
    return {"saved": True, "name": name, "columns": len(columns),
            "usage": f"Ask e.g. 'fill the {name} format for <scheme>' any time."}


@register_tool(
    name="get_format_template",
    description=(
        "Fetch a saved report format by (fuzzy) name. Use whenever the user references a "
        "named/ministry format ('fill the MoS order-history format'). Then answer/generate "
        "the report using EXACTLY these column headings in this order — pass the column spec "
        "to the custom_report engine so the SQL SELECT aliases match the headings."
    ),
    parameters={
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
    },
)
def get_format_template(name: str):
    _ensure_ddl()
    rows = query("""
        SELECT id, name, description, columns, row_grain, filters_note, file_kind,
               updated_at::text AS updated_at
        FROM ai_format_templates
        WHERE NOT is_deleted AND (name ILIKE '%%' || %s || '%%' OR similarity(name, %s) > 0.25)
        ORDER BY similarity(name, %s) DESC NULLS LAST, updated_at DESC
        LIMIT 3
    """, (name, name, name))
    if not rows:
        return {"found": False, "hint": "No template by that name. Offer to save one via save_format_template."}
    best = rows[0]
    return {"found": True, "template": best, "alternates": rows[1:],
            "instruction": ("Produce the output table with EXACTLY these headings in this order. "
                            "Respect filters_note and row_grain. If exporting, use file_kind via report_export.")}


@register_tool(
    name="list_format_templates",
    description="List all saved report/table formats (name + description + column count).",
    parameters={"type": "object", "properties": {}, "required": []},
)
def list_format_templates():
    _ensure_ddl()
    rows = query("""
        SELECT name, description, jsonb_array_length(columns) AS columns, file_kind,
               updated_at::text AS updated_at
        FROM ai_format_templates WHERE NOT is_deleted ORDER BY updated_at DESC LIMIT 50
    """)
    return {"templates": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# Orchestrator grounding hook (optional but recommended, 2-line integration):
#
#   from app.tools.memory_tools import taught_context
#   ...inside grounded_ask(), before building the system prompt:
#   facts_block = taught_context(user_question)
#   if facts_block: system_prompt += "\n\n" + facts_block
# ---------------------------------------------------------------------------

def taught_context(question: str, scheme_id: Optional[int] = None, limit: int = 6) -> str:
    """Return a system-prompt block of authoritative taught facts relevant to the question."""
    try:
        res = recall_facts(topic=question[:200], scheme_id=scheme_id, limit=limit)
    except Exception:
        return ""
    facts = [f for f in res.get("facts", []) if f.get("authority")]
    if not facts:
        return ""
    lines = "\n".join(f"- {f['subject']}: {f['fact']}" for f in facts)
    return ("USER-TAUGHT GROUND TRUTH (overrides conflicting DB/document values — "
            "state when you rely on one):\n" + lines)
