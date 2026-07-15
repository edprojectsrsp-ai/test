"""
Sprint 9A — e-NoteSheet (Digital File Noting)
Endpoints under /api/v1/notesheet

Operations:
  POST /api/v1/notesheet                - create new notesheet
  GET  /api/v1/notesheet                - list (with filters)
  GET  /api/v1/notesheet/{id}           - full details with notes & track
  POST /api/v1/notesheet/{id}/note      - add a note (immutable once submitted)
  POST /api/v1/notesheet/{id}/forward   - forward to another user
  POST /api/v1/notesheet/{id}/approve   - approve (final or intermediate)
  POST /api/v1/notesheet/{id}/reject    - reject
  POST /api/v1/notesheet/{id}/return    - send back for clarification
  POST /api/v1/notesheet/{id}/attach    - attach a file
  GET  /api/v1/notesheet/pending/me     - my action queue
  GET  /api/v1/notesheet/search         - full-text search
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.database import get_db
# from app.security.auth import require_user  # uncomment when RBAC wired

# main.py includes this router with prefix="/api/v1"
router = APIRouter(prefix="/notesheet", tags=["notesheet"])


# ============================================================================
# SCHEMAS
# ============================================================================

class NotesheetCreate(BaseModel):
    subject: str = Field(..., max_length=500)
    category: str = "general"  # see notesheet_category_enum
    priority: str = "routine"
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None
    tender_cycle_id: Optional[int] = None
    cost_implication_cr: Optional[float] = None
    time_implication_days: Optional[int] = None
    background: Optional[str] = None
    proposal: str
    justification: Optional[str] = None
    references_text: Optional[str] = None
    workflow_template_id: Optional[int] = None
    cc_user_ids: Optional[list[int]] = None
    is_confidential: bool = False
    confidential_user_ids: Optional[list[int]] = None
    initiated_by: int  # TODO: pull from auth


class NoteCreate(BaseModel):
    note_text: str
    author_id: int  # TODO: pull from auth


class ForwardAction(BaseModel):
    to_user_id: int
    remarks: Optional[str] = None
    actor_id: int  # TODO: from auth


class DecisionAction(BaseModel):
    remarks: Optional[str] = None
    actor_id: int  # TODO: from auth


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("")
def create_notesheet(p: NotesheetCreate, db: Session = Depends(get_db)):
    """Create a new notesheet. Starts in draft or in_circulation depending on workflow."""
    initial_status = "in_circulation" if p.workflow_template_id else "draft"

    # Determine first owner from workflow
    next_owner_id = p.initiated_by
    if p.workflow_template_id:
        first_step = db.execute(text("""
            SELECT user_id, role FROM workflow_steps
            WHERE template_id=:tid AND step_no=1 LIMIT 1
        """), {"tid": p.workflow_template_id}).mappings().first()
        if first_step and first_step['user_id']:
            next_owner_id = first_step['user_id']
        elif first_step and first_step['role']:
            user = db.execute(text("""
                SELECT user_id FROM users WHERE role=:r AND is_active=TRUE LIMIT 1
            """), {"r": first_step['role']}).mappings().first()
            if user:
                next_owner_id = user['user_id']

    row = db.execute(text("""
        INSERT INTO notesheets(
            subject, category, priority, scheme_id, package_id, tender_cycle_id,
            cost_implication_cr, time_implication_days,
            background, proposal, justification, references_text,
            workflow_template_id, current_step_no, current_owner_id, cc_user_ids,
            is_confidential, confidential_user_ids,
            initiated_by, status
        ) VALUES (
            :subject, :cat::notesheet_category_enum, :pri::notesheet_priority_enum,
            :sid, :pid, :tcid, :cost, :time,
            :bg, :prop, :just, :ref,
            :wid, 1, :owner, :cc,
            :conf, :conf_users,
            :init, :stat::notesheet_status_enum
        ) RETURNING notesheet_id, notesheet_no
    """), {
        "subject": p.subject, "cat": p.category, "pri": p.priority,
        "sid": p.scheme_id, "pid": p.package_id, "tcid": p.tender_cycle_id,
        "cost": p.cost_implication_cr, "time": p.time_implication_days,
        "bg": p.background, "prop": p.proposal, "just": p.justification, "ref": p.references_text,
        "wid": p.workflow_template_id, "owner": next_owner_id, "cc": p.cc_user_ids,
        "conf": p.is_confidential, "conf_users": p.confidential_user_ids,
        "init": p.initiated_by, "stat": initial_status,
    }).mappings().first()

    # Log first track entry
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, to_user_id, remarks)
        VALUES (:nid, 'noted'::notesheet_action_enum, :init, :owner,
                'Notesheet initiated')
    """), {"nid": row['notesheet_id'], "init": p.initiated_by, "owner": next_owner_id})

    db.commit()
    return {"notesheet_id": row['notesheet_id'], "notesheet_no": row['notesheet_no'],
            "current_owner_id": next_owner_id, "status": initial_status}


@router.get("")
def list_notesheets(
    status: Optional[str] = None,
    category: Optional[str] = None,
    scheme_id: Optional[int] = None,
    package_id: Optional[int] = None,
    current_owner_id: Optional[int] = None,
    initiated_by: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    conds = ["NOT ns.is_deleted"]
    params: dict = {"limit": limit}
    if status:
        conds.append("ns.status = :status::notesheet_status_enum")
        params["status"] = status
    if category:
        conds.append("ns.category = :cat::notesheet_category_enum")
        params["cat"] = category
    if scheme_id:
        conds.append("ns.scheme_id = :sid"); params["sid"] = scheme_id
    if package_id:
        conds.append("ns.package_id = :pid"); params["pid"] = package_id
    if current_owner_id:
        conds.append("ns.current_owner_id = :owner"); params["owner"] = current_owner_id
    if initiated_by:
        conds.append("ns.initiated_by = :init"); params["init"] = initiated_by

    sql = f"""
        SELECT ns.notesheet_id, ns.notesheet_no, ns.subject, ns.category::text AS category,
               ns.priority::text AS priority, ns.status::text AS status,
               ns.scheme_id, sm.scheme_name, ns.package_id, p.package_name,
               ns.cost_implication_cr, ns.time_implication_days,
               ns.current_owner_id, u_own.full_name AS current_owner_name,
               ns.initiated_by, u_init.full_name AS initiated_by_name,
               ns.initiated_at, ns.last_action_at,
               CURRENT_DATE - DATE(ns.last_action_at) AS days_pending
        FROM notesheets ns
        LEFT JOIN scheme_master sm ON sm.scheme_id = ns.scheme_id
        LEFT JOIN packages p ON p.package_id = ns.package_id
        LEFT JOIN users u_own ON u_own.user_id = ns.current_owner_id
        LEFT JOIN users u_init ON u_init.user_id = ns.initiated_by
        WHERE {' AND '.join(conds)}
        ORDER BY
            CASE ns.priority WHEN 'immediate' THEN 1 WHEN 'most_urgent' THEN 2
                 WHEN 'urgent' THEN 3 ELSE 4 END,
            ns.last_action_at DESC
        LIMIT :limit
    """
    rows = db.execute(text(sql), params).mappings().all()
    return {"notesheets": [dict(r) for r in rows]}


@router.get("/pending/me")
def my_pending(user_id: int, db: Session = Depends(get_db)):
    """Return notesheets currently with me for action."""
    rows = db.execute(text("""
        SELECT * FROM v_my_pending_notesheets
        WHERE current_owner_id = :uid
        ORDER BY days_pending DESC
    """), {"uid": user_id}).mappings().all()
    return {"pending": [dict(r) for r in rows]}


# Sprint 7 mailbox (must be registered BEFORE /{notesheet_id})
_MAIL_SELECT = """
    SELECT ns.notesheet_id, ns.notesheet_no, ns.subject, ns.category::text AS category,
           ns.priority::text AS priority, ns.status::text AS status,
           ns.scheme_id, sm.scheme_name, ns.package_id, p.package_name,
           ns.cost_implication_cr, ns.time_implication_days,
           ns.current_owner_id, u_own.full_name AS current_owner_name,
           ns.initiated_by, u_init.full_name AS initiated_by_name,
           ns.initiated_at, ns.last_action_at,
           CURRENT_DATE - DATE(ns.last_action_at) AS days_pending,
           ns.is_deleted
    FROM notesheets ns
    LEFT JOIN scheme_master sm ON sm.scheme_id = ns.scheme_id
    LEFT JOIN packages p ON p.package_id = ns.package_id
    LEFT JOIN users u_own ON u_own.user_id = ns.current_owner_id
    LEFT JOIN users u_init ON u_init.user_id = ns.initiated_by
"""


@router.get("/mailbox/{box}")
def mailbox(box: str, user_id: int, limit: int = 50, db: Session = Depends(get_db)):
    """Inbox = pending with me · Outbox = initiated by me · Trash = soft-deleted."""
    key = (box or "").strip().lower()
    params: dict = {"uid": user_id, "limit": limit}
    if key == "inbox":
        where = "NOT ns.is_deleted AND ns.current_owner_id = :uid AND ns.status IN ('in_circulation','pending_approval','returned')"
    elif key == "outbox":
        where = "NOT ns.is_deleted AND ns.initiated_by = :uid"
    elif key == "trash":
        where = "ns.is_deleted AND (ns.initiated_by = :uid OR ns.current_owner_id = :uid)"
    else:
        raise HTTPException(400, "box must be inbox | outbox | trash")
    rows = db.execute(text(f"""
        {_MAIL_SELECT}
        WHERE {where}
        ORDER BY ns.last_action_at DESC NULLS LAST
        LIMIT :limit
    """), params).mappings().all()
    return {"box": key, "notesheets": [dict(r) for r in rows]}


@router.get("/{notesheet_id}")
def get_notesheet(notesheet_id: int, db: Session = Depends(get_db)):
    """Full notesheet details: notes, track, attachments."""
    ns = db.execute(text("""
        SELECT ns.*, sm.scheme_name, sm.scheme_code, p.package_name,
               u_own.full_name AS current_owner_name, u_own.designation AS current_owner_designation,
               u_init.full_name AS initiated_by_name,
               wt.template_name AS workflow_name
        FROM notesheets ns
        LEFT JOIN scheme_master sm ON sm.scheme_id = ns.scheme_id
        LEFT JOIN packages p ON p.package_id = ns.package_id
        LEFT JOIN users u_own ON u_own.user_id = ns.current_owner_id
        LEFT JOIN users u_init ON u_init.user_id = ns.initiated_by
        LEFT JOIN workflow_templates wt ON wt.template_id = ns.workflow_template_id
        WHERE ns.notesheet_id = :id AND NOT ns.is_deleted
    """), {"id": notesheet_id}).mappings().first()
    if not ns:
        raise HTTPException(404, "Notesheet not found")

    notes = db.execute(text("""
        SELECT nn.*, u.full_name AS author_name
        FROM notesheet_notes nn
        JOIN users u ON u.user_id = nn.author_id
        WHERE nn.notesheet_id = :id
        ORDER BY nn.note_no
    """), {"id": notesheet_id}).mappings().all()

    track = db.execute(text("""
        SELECT t.*, u_act.full_name AS actor_name,
               u_from.full_name AS from_user_name,
               u_to.full_name AS to_user_name
        FROM notesheet_track t
        LEFT JOIN users u_act ON u_act.user_id = t.actor_id
        LEFT JOIN users u_from ON u_from.user_id = t.from_user_id
        LEFT JOIN users u_to ON u_to.user_id = t.to_user_id
        WHERE t.notesheet_id = :id
        ORDER BY t.seq_no
    """), {"id": notesheet_id}).mappings().all()

    attachments = db.execute(text("""
        SELECT a.*, u.full_name AS attached_by_name
        FROM notesheet_attachments a
        LEFT JOIN users u ON u.user_id = a.attached_by
        WHERE a.notesheet_id = :id
        ORDER BY a.attached_at
    """), {"id": notesheet_id}).mappings().all()

    return {
        "notesheet": dict(ns),
        "notes": [dict(n) for n in notes],
        "track": [dict(t) for t in track],
        "attachments": [dict(a) for a in attachments],
    }


@router.post("/{notesheet_id}/note")
def add_note(notesheet_id: int, p: NoteCreate, db: Session = Depends(get_db)):
    """Add a note. Author and designation are snapshotted; note becomes immutable."""
    user = db.execute(text("""
        SELECT full_name, designation, department FROM users
        WHERE user_id = :uid AND is_active = TRUE
    """), {"uid": p.author_id}).mappings().first()
    if not user:
        raise HTTPException(404, "User not found")

    row = db.execute(text("""
        INSERT INTO notesheet_notes(notesheet_id, note_text, author_id,
                                     author_designation, author_department)
        VALUES (:nid, :txt, :uid, :des, :dept)
        RETURNING note_id, note_no
    """), {"nid": notesheet_id, "txt": p.note_text, "uid": p.author_id,
           "des": user['designation'], "dept": user['department']}).mappings().first()

    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, note_id, remarks)
        VALUES (:nid, 'commented'::notesheet_action_enum, :uid, :nid_note, :rem)
    """), {"nid": notesheet_id, "uid": p.author_id, "nid_note": row['note_id'],
           "rem": "Added note #" + str(row['note_no'])})

    db.commit()
    return {"note_id": row['note_id'], "note_no": row['note_no']}


@router.post("/{notesheet_id}/forward")
def forward_notesheet(notesheet_id: int, p: ForwardAction, db: Session = Depends(get_db)):
    """Forward to another user. Updates current_owner_id; logs in track."""
    cur = db.execute(text("""
        SELECT current_owner_id FROM notesheets WHERE notesheet_id = :id
    """), {"id": notesheet_id}).mappings().first()
    if not cur:
        raise HTTPException(404, "Notesheet not found")

    db.execute(text("""
        UPDATE notesheets SET current_owner_id = :to, status = 'in_circulation'::notesheet_status_enum
        WHERE notesheet_id = :id
    """), {"to": p.to_user_id, "id": notesheet_id})

    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, from_user_id, to_user_id, remarks)
        VALUES (:nid, 'forwarded'::notesheet_action_enum, :actor, :frm, :to, :rem)
    """), {"nid": notesheet_id, "actor": p.actor_id, "frm": cur['current_owner_id'],
           "to": p.to_user_id, "rem": p.remarks})

    db.commit()
    return {"ok": True, "current_owner_id": p.to_user_id}


@router.post("/{notesheet_id}/approve")
def approve_notesheet(notesheet_id: int, p: DecisionAction, db: Session = Depends(get_db)):
    """Approve. Advances workflow OR closes (if last step)."""
    ns = db.execute(text("""
        SELECT n.*, COUNT(ws.step_id) FILTER (WHERE ws.step_no > n.current_step_no) AS next_steps
        FROM notesheets n
        LEFT JOIN workflow_steps ws ON ws.template_id = n.workflow_template_id
        WHERE n.notesheet_id = :id
        GROUP BY n.notesheet_id
    """), {"id": notesheet_id}).mappings().first()
    if not ns:
        raise HTTPException(404, "Not found")

    if ns['next_steps'] and ns['next_steps'] > 0:
        # Advance to next step
        next_step = db.execute(text("""
            SELECT ws.user_id, ws.role,
                   COALESCE(ws.user_id, (SELECT user_id FROM users WHERE role = ws.role AND is_active LIMIT 1)) AS resolved_uid
            FROM workflow_steps ws
            WHERE ws.template_id = :tid AND ws.step_no = :sn
        """), {"tid": ns['workflow_template_id'], "sn": ns['current_step_no'] + 1}).mappings().first()

        next_owner = next_step['resolved_uid'] if next_step else None
        db.execute(text("""
            UPDATE notesheets SET current_step_no = current_step_no + 1,
                current_owner_id = :no, status = 'pending_approval'::notesheet_status_enum
            WHERE notesheet_id = :id
        """), {"no": next_owner, "id": notesheet_id})
    else:
        # Final approval
        db.execute(text("""
            UPDATE notesheets SET status = 'approved'::notesheet_status_enum,
                final_decision = 'approved', decision_date = CURRENT_DATE,
                closed_at = CURRENT_TIMESTAMP
            WHERE notesheet_id = :id
        """), {"id": notesheet_id})

    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'approved'::notesheet_action_enum, :uid, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "r": p.remarks})

    db.commit()
    return {"ok": True, "final": ns['next_steps'] == 0}


@router.post("/{notesheet_id}/reject")
def reject_notesheet(notesheet_id: int, p: DecisionAction, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE notesheets SET status = 'rejected'::notesheet_status_enum,
            final_decision = 'rejected', decision_date = CURRENT_DATE,
            closed_at = CURRENT_TIMESTAMP
        WHERE notesheet_id = :id
    """), {"id": notesheet_id})
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'rejected'::notesheet_action_enum, :uid, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "r": p.remarks})
    db.commit()
    return {"ok": True}


@router.post("/{notesheet_id}/return")
def return_notesheet(notesheet_id: int, p: DecisionAction, db: Session = Depends(get_db)):
    """Return to initiator for clarification."""
    init = db.execute(text("""
        SELECT initiated_by FROM notesheets WHERE notesheet_id = :id
    """), {"id": notesheet_id}).mappings().first()
    db.execute(text("""
        UPDATE notesheets SET status = 'returned'::notesheet_status_enum,
            current_owner_id = :init
        WHERE notesheet_id = :id
    """), {"init": init['initiated_by'], "id": notesheet_id})
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, to_user_id, remarks)
        VALUES (:nid, 'returned'::notesheet_action_enum, :uid, :init, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "init": init['initiated_by'], "r": p.remarks})
    db.commit()
    return {"ok": True}


@router.post("/{notesheet_id}/attach")
async def attach_file(
    notesheet_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    user_id: int = Form(...),
    db: Session = Depends(get_db),
):
    """Upload an attachment to a notesheet."""
    import os, hashlib
    upload_dir = os.environ.get("UPLOAD_DIR", "/var/lib/project_brain/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    data = await file.read()
    h = hashlib.sha256(data).hexdigest()[:16]
    fname = f"ns_{notesheet_id}_{h}_{file.filename}"
    fpath = os.path.join(upload_dir, fname)
    with open(fpath, "wb") as f:
        f.write(data)

    row = db.execute(text("""
        INSERT INTO notesheet_attachments(notesheet_id, file_path, file_name,
            file_size_bytes, mime_type, attached_by, description)
        VALUES (:nid, :fp, :fn, :sz, :mt, :uid, :desc)
        RETURNING attachment_id
    """), {"nid": notesheet_id, "fp": fpath, "fn": file.filename,
           "sz": len(data), "mt": file.content_type, "uid": user_id, "desc": description}).mappings().first()

    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'noted'::notesheet_action_enum, :uid, :r)
    """), {"nid": notesheet_id, "uid": user_id, "r": f"Attached file: {file.filename}"})

    db.commit()
    return {"attachment_id": row['attachment_id'], "file_path": f"/uploads/{fname}"}


@router.get("/search/text")
def search_notesheets(q: str, limit: int = 20, db: Session = Depends(get_db)):
    """Full-text search across notesheet subject/proposal/background."""
    rows = db.execute(text("""
        SELECT ns.notesheet_id, ns.notesheet_no, ns.subject, ns.status::text AS status,
               ns.category::text AS category, ns.initiated_at,
               ts_rank(ns.full_text_search, plainto_tsquery('english', :q)) AS rank
        FROM notesheets ns
        WHERE NOT ns.is_deleted
          AND ns.full_text_search @@ plainto_tsquery('english', :q)
        ORDER BY rank DESC
        LIMIT :limit
    """), {"q": q, "limit": limit}).mappings().all()
    return {"matches": [dict(r) for r in rows]}


@router.get("/workflows/templates")
def list_workflows(db: Session = Depends(get_db)):
    """List available workflow templates."""
    rows = db.execute(text("""
        SELECT wt.template_id, wt.template_code, wt.template_name, wt.description,
               wt.workflow_type::text AS workflow_type,
               wt.applies_to_category::text AS category,
               wt.min_cost_cr, wt.max_cost_cr,
               (SELECT COUNT(*) FROM workflow_steps WHERE template_id=wt.template_id) AS step_count
        FROM workflow_templates wt
        WHERE wt.is_active AND NOT wt.is_deleted
        ORDER BY wt.template_name
    """)).mappings().all()
    return {"templates": [dict(r) for r in rows]}


@router.post("/{notesheet_id}/trash")
def trash_notesheet(notesheet_id: int, user_id: int, db: Session = Depends(get_db)):
    """Soft-delete into Trash (friend parity)."""
    ns = db.execute(text(
        "SELECT notesheet_id, is_deleted FROM notesheets WHERE notesheet_id=:id"
    ), {"id": notesheet_id}).mappings().first()
    if not ns:
        raise HTTPException(404, "Notesheet not found")
    db.execute(text("""
        UPDATE notesheets SET is_deleted = TRUE, last_action_at = CURRENT_TIMESTAMP
        WHERE notesheet_id = :id
    """), {"id": notesheet_id})
    try:
        db.execute(text("""
            INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
            VALUES (:nid, 'noted'::notesheet_action_enum, :uid, 'Moved to Trash')
        """), {"nid": notesheet_id, "uid": user_id})
    except Exception:
        pass
    db.commit()
    return {"ok": True, "notesheet_id": notesheet_id, "status": "trashed"}


@router.post("/{notesheet_id}/restore")
def restore_notesheet(notesheet_id: int, user_id: int, db: Session = Depends(get_db)):
    """Restore from Trash back to active mailbox."""
    ns = db.execute(text(
        "SELECT notesheet_id FROM notesheets WHERE notesheet_id=:id"
    ), {"id": notesheet_id}).mappings().first()
    if not ns:
        raise HTTPException(404, "Notesheet not found")
    db.execute(text("""
        UPDATE notesheets SET is_deleted = FALSE, last_action_at = CURRENT_TIMESTAMP
        WHERE notesheet_id = :id
    """), {"id": notesheet_id})
    try:
        db.execute(text("""
            INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
            VALUES (:nid, 'noted'::notesheet_action_enum, :uid, 'Restored from Trash')
        """), {"nid": notesheet_id, "uid": user_id})
    except Exception:
        pass
    db.commit()
    return {"ok": True, "notesheet_id": notesheet_id, "status": "restored"}
