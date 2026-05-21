"""
Sprint 9A - e-NoteSheet (Digital File Noting)
Endpoints under /api/v1/notesheet
"""
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/api/v1/notesheet", tags=["notesheet"])


class NotesheetCreate(BaseModel):
    subject: str = Field(..., max_length=500)
    category: str = "general"
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
    initiated_by: int


class NoteCreate(BaseModel):
    note_text: str
    author_id: int


class ForwardAction(BaseModel):
    to_user_id: int
    remarks: Optional[str] = None
    actor_id: int


class DecisionAction(BaseModel):
    remarks: Optional[str] = None
    actor_id: int


@router.get("/workflows/templates")
def list_workflows(db: Session = Depends(get_db)):
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


@router.post("")
def create_notesheet(p: NotesheetCreate, db: Session = Depends(get_db)):
    initial_status = "in_circulation" if p.workflow_template_id else "draft"

    next_owner_id = p.initiated_by
    if p.workflow_template_id:
        first_step = db.execute(text("""
            SELECT user_id, role FROM workflow_steps
            WHERE template_id=:tid AND step_no=1 LIMIT 1
        """), {"tid": p.workflow_template_id}).mappings().first()
        if first_step and first_step.get("user_id"):
            next_owner_id = first_step["user_id"]
        elif first_step and first_step.get("role"):
            user = db.execute(text("""
                SELECT user_id FROM users WHERE role=:r AND is_active=TRUE LIMIT 1
            """), {"r": first_step["role"]}).mappings().first()
            if user:
                next_owner_id = user["user_id"]

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

    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'created'::notesheet_action_enum, :uid, 'Created notesheet')
    """), {"nid": row["notesheet_id"], "uid": p.initiated_by})

    db.commit()
    return {"notesheet_id": row["notesheet_id"], "notesheet_no": row["notesheet_no"]}


@router.get("")
def list_notesheets(status: Optional[str] = None, limit: int = 50, db: Session = Depends(get_db)):
    where = "WHERE NOT ns.is_deleted"
    params = {"limit": limit}
    if status:
        where += " AND ns.status = :status::notesheet_status_enum"
        params["status"] = status
    rows = db.execute(text(f"""
        SELECT ns.notesheet_id, ns.notesheet_no, ns.subject,
               ns.status::text AS status, ns.priority::text AS priority,
               ns.category::text AS category, ns.initiated_at, ns.current_owner_id
        FROM notesheets ns
        {where}
        ORDER BY ns.initiated_at DESC
        LIMIT :limit
    """), params).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/{notesheet_id}")
def get_notesheet(notesheet_id: int, db: Session = Depends(get_db)):
    ns = db.execute(text("""
        SELECT * FROM notesheets
        WHERE notesheet_id=:id AND NOT is_deleted
    """), {"id": notesheet_id}).mappings().first()
    if not ns:
        raise HTTPException(404, "Not found")
    notes = db.execute(text("""
        SELECT * FROM notesheet_notes WHERE notesheet_id=:id ORDER BY created_at ASC
    """), {"id": notesheet_id}).mappings().all()
    track = db.execute(text("""
        SELECT * FROM notesheet_track WHERE notesheet_id=:id ORDER BY created_at ASC
    """), {"id": notesheet_id}).mappings().all()
    return {"notesheet": dict(ns), "notes": [dict(n) for n in notes], "track": [dict(t) for t in track]}


@router.post("/{notesheet_id}/note")
def add_note(notesheet_id: int, p: NoteCreate, db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO notesheet_notes(notesheet_id, note_text, author_id)
        VALUES (:nid, :t, :uid) RETURNING note_id
    """), {"nid": notesheet_id, "t": p.note_text, "uid": p.author_id}).mappings().first()
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'noted'::notesheet_action_enum, :uid, 'Added note')
    """), {"nid": notesheet_id, "uid": p.author_id})
    db.commit()
    return {"note_id": row["note_id"]}


@router.post("/{notesheet_id}/forward")
def forward_notesheet(notesheet_id: int, p: ForwardAction, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE notesheets SET current_owner_id=:to, status='in_circulation'::notesheet_status_enum
        WHERE notesheet_id=:id
    """), {"to": p.to_user_id, "id": notesheet_id})
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, to_user_id, remarks)
        VALUES (:nid, 'forwarded'::notesheet_action_enum, :uid, :to, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "to": p.to_user_id, "r": p.remarks})
    db.commit()
    return {"ok": True}


@router.post("/{notesheet_id}/approve")
def approve_notesheet(notesheet_id: int, p: DecisionAction, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE notesheets SET status='approved'::notesheet_status_enum,
            final_decision='approved', decision_date=CURRENT_DATE, closed_at=CURRENT_TIMESTAMP
        WHERE notesheet_id=:id
    """), {"id": notesheet_id})
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'approved'::notesheet_action_enum, :uid, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "r": p.remarks})
    db.commit()
    return {"ok": True}


@router.post("/{notesheet_id}/reject")
def reject_notesheet(notesheet_id: int, p: DecisionAction, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE notesheets SET status='rejected'::notesheet_status_enum,
            final_decision='rejected', decision_date=CURRENT_DATE, closed_at=CURRENT_TIMESTAMP
        WHERE notesheet_id=:id
    """), {"id": notesheet_id})
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, remarks)
        VALUES (:nid, 'rejected'::notesheet_action_enum, :uid, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "r": p.remarks})
    db.commit()
    return {"ok": True}


@router.post("/{notesheet_id}/return")
def return_notesheet(notesheet_id: int, p: DecisionAction, db: Session = Depends(get_db)):
    init = db.execute(text("""
        SELECT initiated_by FROM notesheets WHERE notesheet_id=:id
    """), {"id": notesheet_id}).mappings().first()
    db.execute(text("""
        UPDATE notesheets SET status='returned'::notesheet_status_enum,
            current_owner_id=:init
        WHERE notesheet_id=:id
    """), {"init": init["initiated_by"], "id": notesheet_id})
    db.execute(text("""
        INSERT INTO notesheet_track(notesheet_id, action, actor_id, to_user_id, remarks)
        VALUES (:nid, 'returned'::notesheet_action_enum, :uid, :init, :r)
    """), {"nid": notesheet_id, "uid": p.actor_id, "init": init["initiated_by"], "r": p.remarks})
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
    import hashlib, os
    upload_dir = os.environ.get("UPLOAD_DIR", "uploads")
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
    return {"attachment_id": row["attachment_id"], "file_path": f"/uploads/{fname}"}

