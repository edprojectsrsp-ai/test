"""
Project Brain — Appendix-2 Engine API Router (GOD MODE v2.1)
Sprint 3: Better than friend's appendix-2

Handles:
  - Template library browsing
  - Document creation with auto-fill from template
  - Activity rows CRUD
  - Monthly distribution (baseline curve)
  - Revision management
  - Approval workflow
  - Auto-seed plan_engine activities when appendix-2 is approved

Place at: project-brain-backend/app/api/v1/appendix2.py
"""

from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter()


# ============================================================================
# Helpers
# ============================================================================
def _date(d):
    return d.isoformat() if d else None


def _num(n):
    return float(n) if n is not None else None


def _add_months(start: date, months: int) -> date:
    """Date addition by months."""
    if not start:
        return None
    m = start.month - 1 + months
    y = start.year + m // 12
    m = m % 12 + 1
    return date(y, m, 1)


# ============================================================================
# 1) GET /templates  → browse the template library
# ============================================================================
@router.get("/templates")
def list_templates(scheme_type: Optional[str] = None, db: Session = Depends(get_db)):
    """List available appendix-2 templates, optionally filtered by scheme type."""
    sql = """
        SELECT t.template_id, t.template_name, t.template_category,
               t.applicable_scheme_type, t.applicable_for_tags, t.description,
               t.is_default_for_type,
               COUNT(ta.template_activity_id) AS activity_count,
               COALESCE(SUM(ta.default_weightage), 0) AS total_weightage
        FROM appendix2_templates t
        LEFT JOIN appendix2_template_activities ta ON ta.template_id = t.template_id
        WHERE t.is_active = TRUE
    """
    params = {}
    if scheme_type:
        sql += " AND (t.applicable_scheme_type = :t OR t.applicable_scheme_type = 'both')"
        params["t"] = scheme_type
    sql += " GROUP BY t.template_id ORDER BY t.is_default_for_type DESC, t.template_id"

    rows = db.execute(text(sql), params).fetchall()
    return [{
        "template_id": r.template_id,
        "template_name": r.template_name,
        "template_category": r.template_category,
        "applicable_scheme_type": r.applicable_scheme_type,
        "applicable_for_tags": r.applicable_for_tags or [],
        "description": r.description,
        "is_default_for_type": r.is_default_for_type,
        "activity_count": r.activity_count,
        "total_weightage": float(r.total_weightage or 0),
    } for r in rows]


# ============================================================================
# 2) GET /templates/{tid}  → see what activities a template contains
# ============================================================================
@router.get("/templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)):
    t = db.execute(text("""
        SELECT template_id, template_name, template_category,
               applicable_scheme_type, description
        FROM appendix2_templates WHERE template_id = :tid
    """), {"tid": template_id}).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    acts = db.execute(text("""
        SELECT template_activity_id, s_no, activity_name, default_uom,
               default_weightage, typical_duration_months,
               typical_start_offset_months, category, notes, display_order
        FROM appendix2_template_activities
        WHERE template_id = :tid
        ORDER BY display_order
    """), {"tid": template_id}).fetchall()

    return {
        "template_id": t.template_id,
        "template_name": t.template_name,
        "template_category": t.template_category,
        "applicable_scheme_type": t.applicable_scheme_type,
        "description": t.description,
        "activities": [{
            "template_activity_id": a.template_activity_id,
            "s_no": a.s_no,
            "activity_name": a.activity_name,
            "default_uom": a.default_uom,
            "default_weightage": float(a.default_weightage or 0),
            "typical_duration_months": a.typical_duration_months,
            "typical_start_offset_months": a.typical_start_offset_months,
            "category": a.category,
            "notes": a.notes,
            "display_order": a.display_order,
        } for a in acts]
    }


# ============================================================================
# 3) GET /scheme/{scheme_id}  → list all appendix-2 documents for a scheme
# ============================================================================
@router.get("/scheme/{scheme_id}")
def list_documents(scheme_id: int, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT d.appendix2_id, d.scheme_id, d.package_id, d.revision_no, d.revision_label,
               d.revision_reason, d.is_current, d.is_approved, d.document_no,
               d.document_date, d.fy_baseline, d.scheduled_start_date, d.scheduled_finish_date,
               d.total_scope_value_cr, d.prepared_by_name, d.approved_by_name,
               d.approval_date, d.board_meeting_ref, d.based_on_template_id,
               t.template_name AS template_name,
               p.package_name AS package_name,
               COUNT(a.appendix2_activity_id) AS activity_count
        FROM appendix2_documents d
        LEFT JOIN appendix2_templates t ON t.template_id = d.based_on_template_id
        LEFT JOIN packages p ON p.package_id = d.package_id
        LEFT JOIN appendix2_activities a ON a.appendix2_id = d.appendix2_id
        WHERE d.scheme_id = :sid
        GROUP BY d.appendix2_id, t.template_name, p.package_name
        ORDER BY d.is_current DESC, d.revision_no DESC, d.created_at DESC
    """), {"sid": scheme_id}).fetchall()

    return [{
        "appendix2_id": r.appendix2_id,
        "scheme_id": r.scheme_id,
        "package_id": r.package_id,
        "package_name": r.package_name,
        "revision_no": r.revision_no,
        "revision_label": r.revision_label,
        "revision_reason": r.revision_reason,
        "is_current": r.is_current,
        "is_approved": r.is_approved,
        "document_no": r.document_no,
        "document_date": _date(r.document_date),
        "fy_baseline": r.fy_baseline,
        "scheduled_start_date": _date(r.scheduled_start_date),
        "scheduled_finish_date": _date(r.scheduled_finish_date),
        "total_scope_value_cr": _num(r.total_scope_value_cr),
        "prepared_by_name": r.prepared_by_name,
        "approved_by_name": r.approved_by_name,
        "approval_date": _date(r.approval_date),
        "board_meeting_ref": r.board_meeting_ref,
        "based_on_template_id": r.based_on_template_id,
        "template_name": r.template_name,
        "activity_count": r.activity_count or 0,
    } for r in rows]


# ============================================================================
# 4) POST /create  → create a new Appendix-2 document (with optional auto-fill)
# ============================================================================
@router.post("/create")
def create_document(data: dict, db: Session = Depends(get_db)):
    """
    Create new Appendix-2.
    If `template_id` provided, auto-fill activities from the template.
    If `is_revision_of` provided, copies activities from previous revision.
    """
    scheme_id = data.get("scheme_id")
    if not scheme_id:
        raise HTTPException(status_code=400, detail="scheme_id required")

    try:
        # Mark any existing current doc for same scheme/package as not-current
        db.execute(text("""
            UPDATE appendix2_documents
            SET is_current = FALSE
            WHERE scheme_id = :sid
              AND COALESCE(package_id, 0) = COALESCE(:pid, 0)
              AND is_current = TRUE
        """), {"sid": scheme_id, "pid": data.get("package_id")})

        # Auto-increment revision_no
        max_rev = db.execute(text("""
            SELECT COALESCE(MAX(revision_no), -1)
            FROM appendix2_documents
            WHERE scheme_id = :sid
              AND COALESCE(package_id, 0) = COALESCE(:pid, 0)
        """), {"sid": scheme_id, "pid": data.get("package_id")}).scalar()

        new_rev = int(max_rev) + 1
        rev_label = data.get("revision_label") or ("Initial" if new_rev == 0 else f"Rev-{chr(64 + new_rev)}")

        # Insert document
        new_id = db.execute(text("""
            INSERT INTO appendix2_documents (
                scheme_id, package_id, revision_no, revision_label, revision_reason,
                is_current, document_no, document_date, fy_baseline,
                based_on_template_id, scheduled_start_date, scheduled_finish_date,
                total_scope_value_cr, prepared_by_name, remarks,
                created_by, created_at
            ) VALUES (
                :sid, :pid, :rev, :label, :reason,
                TRUE, :doc_no, :doc_dt, :fy,
                :tmpl_id, :start, :finish, :value,
                :prep, :rmk, 1, CURRENT_TIMESTAMP
            )
            RETURNING appendix2_id
        """), {
            "sid": scheme_id,
            "pid": data.get("package_id"),
            "rev": new_rev,
            "label": rev_label,
            "reason": data.get("revision_reason"),
            "doc_no": data.get("document_no"),
            "doc_dt": data.get("document_date") or date.today().isoformat(),
            "fy": data.get("fy_baseline"),
            "tmpl_id": data.get("template_id"),
            "start": data.get("scheduled_start_date"),
            "finish": data.get("scheduled_finish_date"),
            "value": data.get("total_scope_value_cr"),
            "prep": data.get("prepared_by_name"),
            "rmk": data.get("remarks"),
        }).scalar()

        activities_created = 0

        # AUTO-FILL from template
        if data.get("template_id"):
            tpl_acts = db.execute(text("""
                SELECT s_no, activity_name, default_uom, default_weightage,
                       typical_duration_months, typical_start_offset_months,
                       category, notes, display_order
                FROM appendix2_template_activities
                WHERE template_id = :tid
                ORDER BY display_order
            """), {"tid": data["template_id"]}).fetchall()

            start_date = None
            if data.get("scheduled_start_date"):
                start_date = date.fromisoformat(data["scheduled_start_date"])

            for ta in tpl_acts:
                a_start = _add_months(start_date, ta.typical_start_offset_months or 0) if start_date else None
                a_finish = _add_months(start_date, (ta.typical_start_offset_months or 0) + (ta.typical_duration_months or 1)) if start_date else None

                db.execute(text("""
                    INSERT INTO appendix2_activities (
                        appendix2_id, s_no, activity_name, uom, scope_qty, weightage,
                        commencement_offset_months, completion_offset_months,
                        activity_start_date, activity_finish_date,
                        category, notes, display_order
                    ) VALUES (
                        :doc, :sno, :name, :uom, 0, :wt,
                        :cm_off, :end_off,
                        :start, :finish,
                        :cat, :note, :ord
                    )
                """), {
                    "doc": new_id,
                    "sno": ta.s_no,
                    "name": ta.activity_name,
                    "uom": ta.default_uom,
                    "wt": ta.default_weightage,
                    "cm_off": ta.typical_start_offset_months,
                    "end_off": (ta.typical_start_offset_months or 0) + (ta.typical_duration_months or 1),
                    "start": a_start,
                    "finish": a_finish,
                    "cat": ta.category,
                    "note": ta.notes,
                    "ord": ta.display_order,
                })
                activities_created += 1

        # COPY-FROM-PREVIOUS revision
        elif data.get("copy_from_revision_id"):
            prev_acts = db.execute(text("""
                SELECT s_no, activity_name, uom, scope_qty, weightage,
                       commencement_offset_months, completion_offset_months,
                       activity_start_date, activity_finish_date,
                       category, is_milestone, notes, display_order, extra_fields
                FROM appendix2_activities
                WHERE appendix2_id = :prev
                ORDER BY display_order
            """), {"prev": data["copy_from_revision_id"]}).fetchall()

            import json as _json
            for pa in prev_acts:
                ef_val = pa.extra_fields
                if isinstance(ef_val, dict):
                    ef_val = _json.dumps(ef_val)
                db.execute(text("""
                    INSERT INTO appendix2_activities (
                        appendix2_id, s_no, activity_name, uom, scope_qty, weightage,
                        commencement_offset_months, completion_offset_months,
                        activity_start_date, activity_finish_date,
                        category, is_milestone, notes, display_order, extra_fields
                    ) VALUES (
                        :doc, :sno, :name, :uom, :qty, :wt,
                        :cm_off, :end_off,
                        :start, :finish,
                        :cat, :ms, :note, :ord, CAST(:ef AS jsonb)
                    )
                """), {
                    "doc": new_id, "sno": pa.s_no, "name": pa.activity_name,
                    "uom": pa.uom, "qty": pa.scope_qty, "wt": pa.weightage,
                    "cm_off": pa.commencement_offset_months, "end_off": pa.completion_offset_months,
                    "start": pa.activity_start_date, "finish": pa.activity_finish_date,
                    "cat": pa.category, "ms": pa.is_milestone, "note": pa.notes,
                    "ord": pa.display_order, "ef": ef_val or '{}',
                })
                activities_created += 1

        db.commit()
        return {
            "appendix2_id": new_id,
            "revision_no": new_rev,
            "revision_label": rev_label,
            "activities_created": activities_created,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


# ============================================================================
# 5) GET /{appendix2_id}/full  → full document with activities + monthly
# ============================================================================
@router.get("/{appendix2_id}/full")
def get_full_document(appendix2_id: int, db: Session = Depends(get_db)):
    """Return complete Appendix-2 document with all rows and monthly distribution."""
    h = db.execute(text("""
        SELECT d.*, t.template_name, p.package_name, sm.scheme_name
        FROM appendix2_documents d
        LEFT JOIN appendix2_templates t ON t.template_id = d.based_on_template_id
        LEFT JOIN packages p ON p.package_id = d.package_id
        LEFT JOIN scheme_master sm ON sm.scheme_id = d.scheme_id
        WHERE d.appendix2_id = :id
    """), {"id": appendix2_id}).first()
    if not h:
        raise HTTPException(status_code=404, detail="Appendix-2 not found")

    acts = db.execute(text("""
        SELECT * FROM appendix2_activities
        WHERE appendix2_id = :id ORDER BY display_order
    """), {"id": appendix2_id}).fetchall()

    monthly = db.execute(text("""
        SELECT appendix2_activity_id, plan_month, planned_qty, cumulative_pct
        FROM appendix2_monthly_plan
        WHERE appendix2_id = :id
    """), {"id": appendix2_id}).fetchall()

    monthly_cells = {}
    for m in monthly:
        key = f"{m.appendix2_activity_id}|{m.plan_month.isoformat()}"
        monthly_cells[key] = {
            "planned_qty": float(m.planned_qty or 0),
            "cumulative_pct": float(m.cumulative_pct or 0),
        }

    return {
        "header": {
            "appendix2_id": h.appendix2_id,
            "scheme_id": h.scheme_id,
            "scheme_name": h.scheme_name,
            "package_id": h.package_id,
            "package_name": h.package_name,
            "revision_no": h.revision_no,
            "revision_label": h.revision_label,
            "revision_reason": h.revision_reason,
            "is_current": h.is_current,
            "is_approved": h.is_approved,
            "document_no": h.document_no,
            "document_date": _date(h.document_date),
            "fy_baseline": h.fy_baseline,
            "based_on_template_id": h.based_on_template_id,
            "template_name": h.template_name,
            "scheduled_start_date": _date(h.scheduled_start_date),
            "scheduled_finish_date": _date(h.scheduled_finish_date),
            "total_scope_value_cr": _num(h.total_scope_value_cr),
            "prepared_by_name": h.prepared_by_name,
            "reviewed_by_name": h.reviewed_by_name,
            "approved_by_name": h.approved_by_name,
            "approval_date": _date(h.approval_date),
            "board_meeting_ref": h.board_meeting_ref,
            "remarks": h.remarks,
            "extra_fields": h.extra_fields or {},
        },
        "activities": [{
            "appendix2_activity_id": a.appendix2_activity_id,
            "s_no": a.s_no,
            "activity_name": a.activity_name,
            "uom": a.uom,
            "scope_qty": _num(a.scope_qty),
            "weightage": _num(a.weightage),
            "commencement_offset_months": a.commencement_offset_months,
            "completion_offset_months": a.completion_offset_months,
            "activity_start_date": _date(a.activity_start_date),
            "activity_finish_date": _date(a.activity_finish_date),
            "category": a.category,
            "is_milestone": a.is_milestone,
            "notes": a.notes,
            "display_order": a.display_order,
            "extra_fields": a.extra_fields or {},
        } for a in acts],
        "monthly_cells": monthly_cells,
    }


# ============================================================================
# 6) PUT /{appendix2_id}/header  → update header fields
# ============================================================================
@router.put("/{appendix2_id}/header")
def update_header(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        updatable = [
            "document_no", "document_date", "fy_baseline",
            "scheduled_start_date", "scheduled_finish_date", "total_scope_value_cr",
            "prepared_by_name", "reviewed_by_name", "approved_by_name",
            "approval_date", "board_meeting_ref", "remarks", "revision_reason",
        ]
        sets = []
        params = {"id": appendix2_id}
        for k in updatable:
            if k in data:
                sets.append(f"{k} = :{k}")
                params[k] = data[k]
        if not sets:
            return {"ok": True, "noop": True}
        sets.append("updated_at = CURRENT_TIMESTAMP")

        db.execute(text(f"UPDATE appendix2_documents SET {', '.join(sets)} WHERE appendix2_id = :id"), params)
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Header update failed: {e}")


# ============================================================================
# 7) POST /{appendix2_id}/activities  → add a row
# ============================================================================
@router.post("/{appendix2_id}/activities")
def add_activity(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        max_order = db.execute(
            text("SELECT COALESCE(MAX(display_order), 0) FROM appendix2_activities WHERE appendix2_id = :id"),
            {"id": appendix2_id}
        ).scalar()

        new_id = db.execute(text("""
            INSERT INTO appendix2_activities (
                appendix2_id, s_no, activity_name, uom, scope_qty, weightage,
                commencement_offset_months, completion_offset_months,
                activity_start_date, activity_finish_date,
                category, is_milestone, notes, display_order
            ) VALUES (
                :doc, :sno, :name, :uom, :qty, :wt,
                :cm_off, :end_off,
                :start, :finish,
                :cat, :ms, :note, :ord
            )
            RETURNING appendix2_activity_id
        """), {
            "doc": appendix2_id,
            "sno": data.get("s_no"),
            "name": data.get("activity_name", "New Activity"),
            "uom": data.get("uom"),
            "qty": data.get("scope_qty", 0),
            "wt": data.get("weightage", 0),
            "cm_off": data.get("commencement_offset_months"),
            "end_off": data.get("completion_offset_months"),
            "start": data.get("activity_start_date"),
            "finish": data.get("activity_finish_date"),
            "cat": data.get("category"),
            "ms": data.get("is_milestone", False),
            "note": data.get("notes"),
            "ord": int(max_order or 0) + 10,
        }).scalar()
        db.commit()
        return {"appendix2_activity_id": new_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Add activity failed: {e}")


# ============================================================================
# 8) PUT /activities/{aid}  → update a row
# ============================================================================
@router.put("/activities/{activity_id}")
def update_activity(activity_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        updatable = [
            "s_no", "activity_name", "uom", "scope_qty", "weightage",
            "commencement_offset_months", "completion_offset_months",
            "activity_start_date", "activity_finish_date",
            "category", "is_milestone", "notes", "display_order",
        ]
        sets = []
        params = {"id": activity_id}
        for k in updatable:
            if k in data:
                sets.append(f"{k} = :{k}")
                params[k] = data[k]
        if not sets:
            return {"ok": True, "noop": True}
        sets.append("updated_at = CURRENT_TIMESTAMP")

        db.execute(text(f"UPDATE appendix2_activities SET {', '.join(sets)} WHERE appendix2_activity_id = :id"), params)
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


# ============================================================================
# 9) DELETE /activities/{aid}
# ============================================================================
@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    try:
        db.execute(text("DELETE FROM appendix2_activities WHERE appendix2_activity_id = :id"), {"id": activity_id})
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 10) POST /{appendix2_id}/approve  → mark as approved
# ============================================================================
@router.post("/{appendix2_id}/approve")
def approve_document(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    """Approve the document. Validates weightage sum = 100."""
    try:
        total_wt = db.execute(text("""
            SELECT COALESCE(SUM(weightage), 0)
            FROM appendix2_activities WHERE appendix2_id = :id
        """), {"id": appendix2_id}).scalar()

        if abs(float(total_wt or 0) - 100.0) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve: weightages sum to {total_wt}, must be 100"
            )

        db.execute(text("""
            UPDATE appendix2_documents
            SET is_approved = TRUE,
                approved_by_name = :name,
                approval_date = :dt,
                board_meeting_ref = :ref,
                updated_at = CURRENT_TIMESTAMP
            WHERE appendix2_id = :id
        """), {
            "id": appendix2_id,
            "name": data.get("approved_by_name"),
            "dt": data.get("approval_date") or date.today().isoformat(),
            "ref": data.get("board_meeting_ref"),
        })
        db.commit()
        return {"ok": True, "is_approved": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Approval failed: {e}")


# ============================================================================
# 11) POST /{appendix2_id}/sync-to-plan  → seed plan_activities from appendix-2
# ============================================================================
@router.post("/{appendix2_id}/sync-to-plan")
def sync_to_plan(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    """
    SMART FEATURE: Take an approved appendix-2 and create a progress_plan from it.
    Copies all activities + month-wise distribution.
    """
    doc = db.execute(text("""
        SELECT scheme_id, package_id, is_approved,
               scheduled_start_date, scheduled_finish_date, fy_baseline,
               revision_label
        FROM appendix2_documents WHERE appendix2_id = :id
    """), {"id": appendix2_id}).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Appendix-2 not found")
    if not doc.is_approved:
        raise HTTPException(status_code=400, detail="Cannot sync — document not yet approved")

    package_id = doc.package_id
    if not package_id:
        # Use scheme's mirror package
        package_id = db.execute(text("""
            SELECT package_id FROM packages
            WHERE scheme_id = :sid AND is_scheme_mirror = TRUE
            LIMIT 1
        """), {"sid": doc.scheme_id}).scalar()

    if not package_id:
        raise HTTPException(status_code=400, detail="No package to sync to")

    try:
        # Get max plan version
        max_v = db.execute(text("""
            SELECT COALESCE(MAX(plan_version), 0) FROM progress_plans WHERE package_id = :p
        """), {"p": package_id}).scalar()

        # Create new plan from appendix-2
        new_plan_id = db.execute(text("""
            INSERT INTO progress_plans (
                package_id, plan_name, plan_version, financial_year, plan_status,
                contract_start_month, expected_completion_month, effective_month,
                created_by, created_at
            ) VALUES (
                :pkg, :name, :ver, :fy, 'draft',
                :start, :finish, :start, 1, CURRENT_TIMESTAMP
            )
            RETURNING progress_plan_id
        """), {
            "pkg": package_id,
            "name": f"Plan from Appendix-2 ({doc.revision_label})",
            "ver": int(max_v) + 1,
            "fy": doc.fy_baseline,
            "start": doc.scheduled_start_date,
            "finish": doc.scheduled_finish_date,
        }).scalar()

        # Copy activities
        acts = db.execute(text("""
            SELECT activity_name, uom, scope_qty, weightage,
                   activity_start_date, activity_finish_date, display_order
            FROM appendix2_activities WHERE appendix2_id = :id ORDER BY display_order
        """), {"id": appendix2_id}).fetchall()

        for a in acts:
            db.execute(text("""
                INSERT INTO plan_activities (
                    progress_plan_id, package_id, activity_name, uom, scope_qty,
                    weightage, activity_start_date, activity_finish_date, display_order
                ) VALUES (
                    :pid, :pkg, :name, :uom, :qty, :wt, :start, :finish, :ord
                )
            """), {
                "pid": new_plan_id, "pkg": package_id,
                "name": a.activity_name, "uom": a.uom,
                "qty": a.scope_qty or 0, "wt": a.weightage,
                "start": a.activity_start_date, "finish": a.activity_finish_date,
                "ord": a.display_order,
            })

        db.commit()
        return {
            "ok": True,
            "progress_plan_id": new_plan_id,
            "package_id": package_id,
            "activities_synced": len(acts),
            "message": f"Synced {len(acts)} activities into new plan v{int(max_v) + 1}",
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")


# ============================================================================
# 12) DELETE /{appendix2_id}  → delete a revision (only if not approved)
# ============================================================================
@router.delete("/{appendix2_id}")
def delete_document(appendix2_id: int, db: Session = Depends(get_db)):
    try:
        approved = db.execute(
            text("SELECT is_approved FROM appendix2_documents WHERE appendix2_id = :id"),
            {"id": appendix2_id}
        ).scalar()
        if approved:
            raise HTTPException(status_code=403, detail="Cannot delete approved document. Create a new revision instead.")

        db.execute(text("DELETE FROM appendix2_documents WHERE appendix2_id = :id"), {"id": appendix2_id})
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))