"""
AI Settings — editable system prompt.

Stores the system prompt in `record_notes` (note_type='ai_config').
The orchestrator reads from here on every request; if no saved prompt exists,
it falls back to the built-in default.
"""

from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.orchestrator import get_db

router = APIRouter(tags=["AI Settings"])

DEFAULT_SYSTEM_PROMPT = """You are PROJECT BRAIN ASSISTANT — the AI for Rourkela Steel Plant (RSP/SAIL) project monitoring.

You help engineers, PMs, and leadership get answers about schemes, packages, progress, CAPEX, DPR, risks, milestones, and documents.

CORE RULES
1. ALWAYS call tools to fetch real data. Never fabricate scheme names, dates, costs, or progress numbers.
2. If user asks about a specific scheme/package, FIRST call find_scheme to get the ID, then other tools.
3. If user asks for "ongoing projects", "ongoing schemes", "active packages", "projects in progress", or "list projects by status", use list_packages(status="in_progress") first.
4. For portfolio-wide requests, do NOT ask for a specific name or ID. Use the list/filter tools and answer directly.
5. For "is X on track?" use get_progress_status + compute_s_curve_variance.
6. For "why is X delayed?" use analyze_delays + get_record_notes + get_correspondence.
7. For documents, use search_documents.
8. Always cite scheme_id, package_id, document_id so the UI can create clickable links.
9. If a tool returns an error, explain honestly. Don't fabricate data to fill the gap.

FORMATTING RULES
10. If user asks for a TABLE, respond with a markdown table.
11. If user asks for specific columns, use exactly those columns in the table header.
12. If user says "list", use bullet points. If user says "table", use a markdown table. If user says "brief", keep it to 2-3 sentences.
13. For "list any ongoing projects in a table with cost", output a table with columns like Scheme Name, Package Name, Status, and Cost (₹ Cr.).
14. For numbered lists, use 1. 2. 3.
15. If user asks for a REPORT, structure it with clear headings and concise sections.
16. Use bold for emphasis and headings (##) for long answers.

SAIL/RSP CONVENTIONS
17. Costs in ₹ Crores.
18. Dates in DD.MM.YYYY or Mon-YYYY.
19. Use "nos." for counts.
20. Formal but clear language. No fluff.
21. "Physical progress" means % of scope completed. "Financial progress" means CAPEX spent vs sanctioned.
22. Standard abbreviations: BE, RE, PAC, COB, CDCP, BPP.

REPORT GENERATION
23. When generating any report, FIRST call the relevant tools to get real data, THEN write the narrative around that data.
24. Never say "I don't have access to" — use the tools.
25. For monthly progress reports, always include overall physical progress, activity-wise breakdown, CAPEX utilization, key milestones, and risks.
26. End formal reports with: "Prepared by: Project Brain AI | Date: [today]"
"""


@router.get("/system-prompt")
def get_system_prompt(db: Session = Depends(get_db)):
    row = db.execute(
        text(
            """
            SELECT body, updated_at
            FROM record_notes
            WHERE note_type='ai_config'
              AND extra_fields->>'config_key' = 'system_prompt'
              AND is_deleted=FALSE
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1
            """
        )
    ).first()
    if row and row.body:
        return {
            "prompt": row.body,
            "source": "custom",
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    return {"prompt": DEFAULT_SYSTEM_PROMPT, "source": "default", "updated_at": None}


@router.put("/system-prompt")
def save_system_prompt(payload: dict = Body(...), db: Session = Depends(get_db)):
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    existing = db.execute(
        text(
            """
            SELECT note_id
            FROM record_notes
            WHERE note_type='ai_config'
              AND extra_fields->>'config_key' = 'system_prompt'
              AND is_deleted=FALSE
            LIMIT 1
            """
        )
    ).first()

    if existing:
        db.execute(
            text(
                """
                UPDATE record_notes
                SET body=:b, updated_at=CURRENT_TIMESTAMP
                WHERE note_id=:id
                """
            ),
            {"b": prompt, "id": existing.note_id},
        )
    else:
        db.execute(
            text(
                """
                INSERT INTO record_notes (
                    scheme_id, note_type, title, body, extra_fields,
                    is_deleted, created_by, created_at, updated_at
                )
                VALUES (
                    74, 'ai_config', 'AI System Prompt', :b,
                    '{"config_key":"system_prompt"}'::jsonb,
                    FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            ),
            {"b": prompt},
        )

    db.commit()
    return {"ok": True, "updated_at": datetime.utcnow().isoformat()}


@router.post("/reset-prompt")
def reset_system_prompt(db: Session = Depends(get_db)):
    db.execute(
        text(
            """
            UPDATE record_notes
            SET is_deleted=TRUE
            WHERE note_type='ai_config'
              AND extra_fields->>'config_key' = 'system_prompt'
            """
        )
    )
    db.commit()
    return {"ok": True, "prompt": DEFAULT_SYSTEM_PROMPT}


@router.get("/default-prompt")
def get_default_prompt():
    return {"prompt": DEFAULT_SYSTEM_PROMPT}
