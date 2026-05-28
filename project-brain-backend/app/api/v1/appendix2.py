"""
Appendix-2 router — rewritten against the LIVE t5 schema (confirmed via
inspect_appendix2.py). Replaces the t3-era version that referenced
appendix2_documents / appendix2_activities / appendix2_monthly_plan
(none of which exist in t5).

t5 table mapping (old -> real):
  appendix2_documents          -> appendix2_revisions   (PK revision_id)
  appendix2_activities         -> appendix2_items        (PK item_id)
  appendix2_template_activities-> appendix2_template_items
  appendix2_monthly_plan       -> (does not exist; monthly lives in
                                   monthly_plan_entries AFTER sync-to-plan)

Key column mapping:
  appendix2_id        -> revision_id
  weightage           -> weight_pct
  activity_start_date -> schedule_start ;  activity_finish_date -> schedule_finish
  display_order       -> sort_order
  default_weightage   -> default_weight_pct  (template_items)
  is_approved         -> NOT IN t5. We use is_locked as the "finalised" gate.
  document_no / prepared_by_name / total_scope_value_cr / commencement_offset /
  is_milestone        -> NOT IN t5 columns; stored losslessly in extra_fields.

HIERARCHY / CASCADE:
  appendix2_items uses is_category (bool) + parent_item_id. A category row has
  is_category=true, parent_item_id=NULL. A leaf item has is_category=false and
  parent_item_id pointing at its category. This powers the category->item
  cascade in the UI. The DB CHECK (category_consistency) enforces this shape.

Response shapes are kept BACKWARD-COMPATIBLE with the existing frontend where
possible (it expects header/activities/monthly_cells, fields like weightage,
is_approved, activity_name). We expose t5 values under BOTH the new names and
the legacy aliases so the current page keeps working AND the new page can use
clean names. Legacy aliases are clearly marked.

Place at: project-brain-backend/app/api/v1/appendix2.py
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(tags=["Appendix-2"])


# ---------- helpers ----------------------------------------------------------
def _date(v):
    return v.isoformat() if v else None


def _num(v):
    return float(v) if v is not None else None


def _add_months(d: date, months):
    if d is None or months is None:
        return None
    m = d.month - 1 + int(months)
    y = d.year + m // 12
    m = m % 12 + 1
    from calendar import monthrange
    day = min(d.day, monthrange(y, m)[1])
    return date(y, m, day)


# ============================================================================
# 1) GET /templates   (+ optional ?scheme_type=)
# ============================================================================
@router.get("/templates")
def list_templates(scheme_type: str | None = None, db: Session = Depends(get_db)):
    sql = """
        SELECT template_id, template_name, description, target_scheme_type,
               is_global, is_active, usage_count
        FROM appendix2_templates
        WHERE is_active = TRUE
    """
    params = {}
    if scheme_type:
        sql += " AND (target_scheme_type = :st OR target_scheme_type IS NULL OR is_global = TRUE)"
        params["st"] = scheme_type
    sql += " ORDER BY usage_count DESC, template_name"
    rows = db.execute(text(sql), params).fetchall()
    return [{
        "template_id": r.template_id,
        "template_name": r.template_name,
        "description": r.description,
        "target_scheme_type": r.target_scheme_type,
        "is_global": r.is_global,
        "usage_count": r.usage_count,
    } for r in rows]


# ============================================================================
# 2) GET /templates/{template_id}  -> template items (hierarchical)
# ============================================================================
@router.get("/templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)):
    h = db.execute(text("""
        SELECT template_id, template_name, description, target_scheme_type
        FROM appendix2_templates WHERE template_id = :id
    """), {"id": template_id}).first()
    if not h:
        raise HTTPException(status_code=404, detail="Template not found")
    items = db.execute(text("""
        SELECT template_item_id, parent_template_item_id, is_category,
               category_label, item_label, default_commencement_months,
               default_completion_months, default_weight_pct, sort_order, notes
        FROM appendix2_template_items
        WHERE template_id = :id
        ORDER BY sort_order, template_item_id
    """), {"id": template_id}).fetchall()
    return {
        "template_id": h.template_id,
        "template_name": h.template_name,
        "items": [{
            "template_item_id": i.template_item_id,
            "parent_template_item_id": i.parent_template_item_id,
            "is_category": i.is_category,
            "category_label": i.category_label,
            "item_label": i.item_label,
            "default_commencement_months": _num(i.default_commencement_months),
            "default_completion_months": _num(i.default_completion_months),
            "default_weight_pct": _num(i.default_weight_pct),
            "sort_order": i.sort_order,
            "notes": i.notes,
        } for i in items],
    }


# ============================================================================
# 3) GET /scheme/{scheme_id}  -> list revisions ("documents") for a scheme
# ============================================================================
@router.get("/scheme/{scheme_id}")
def list_documents(scheme_id: int, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT r.revision_id, r.scheme_id, r.package_id, r.revision_no,
               r.revision_label, r.description, r.is_current, r.is_locked,
               r.source, r.source_template_id, r.extra_fields,
               t.template_name AS template_name,
               p.package_name AS package_name,
               COUNT(i.item_id) FILTER (WHERE i.is_category = FALSE) AS item_count
        FROM appendix2_revisions r
        LEFT JOIN appendix2_templates t ON t.template_id = r.source_template_id
        LEFT JOIN packages p ON p.package_id = r.package_id
        LEFT JOIN appendix2_items i ON i.revision_id = r.revision_id
        WHERE r.scheme_id = :sid AND r.is_deleted = FALSE
        GROUP BY r.revision_id, t.template_name, p.package_name
        ORDER BY r.is_current DESC, r.revision_no DESC, r.created_at DESC
    """), {"sid": scheme_id}).fetchall()

    out = []
    for r in rows:
        ef = r.extra_fields or {}
        out.append({
            "appendix2_id": r.revision_id,          # legacy alias
            "revision_id": r.revision_id,
            "scheme_id": r.scheme_id,
            "package_id": r.package_id,
            "package_name": r.package_name,
            "revision_no": r.revision_no,
            "revision_label": r.revision_label,
            "revision_reason": r.description,        # legacy alias (desc==reason)
            "description": r.description,
            "is_current": r.is_current,
            "is_locked": r.is_locked,
            "is_approved": r.is_locked,              # legacy alias: locked == finalised
            "source": r.source,
            "based_on_template_id": r.source_template_id,
            "template_name": r.template_name,
            # legacy header fields not in t5 -> from extra_fields
            "document_no": ef.get("document_no"),
            "document_date": ef.get("document_date"),
            "fy_baseline": ef.get("fy_baseline"),
            "scheduled_start_date": ef.get("scheduled_start_date"),
            "scheduled_finish_date": ef.get("scheduled_finish_date"),
            "total_scope_value_cr": ef.get("total_scope_value_cr"),
            "prepared_by_name": ef.get("prepared_by_name"),
            "approved_by_name": ef.get("approved_by_name"),
            "approval_date": ef.get("approval_date"),
            "activity_count": r.item_count or 0,
        })
    return out


# ============================================================================
# 4) POST /create  -> create a new revision (optionally from template)
# ============================================================================
@router.post("/create")
def create_document(data: dict, db: Session = Depends(get_db)):
    import json as _json
    scheme_id = data.get("scheme_id")
    if not scheme_id:
        raise HTTPException(status_code=400, detail="scheme_id required")
    package_id = data.get("package_id")

    try:
        # mark existing current revision (same scheme/package) as not current
        db.execute(text("""
            UPDATE appendix2_revisions SET is_current = FALSE
            WHERE scheme_id = :sid
              AND COALESCE(package_id,0) = COALESCE(:pid,0)
              AND is_current = TRUE AND is_deleted = FALSE
        """), {"sid": scheme_id, "pid": package_id})

        max_rev = db.execute(text("""
            SELECT COALESCE(MAX(revision_no), -1) FROM appendix2_revisions
            WHERE scheme_id = :sid AND COALESCE(package_id,0) = COALESCE(:pid,0)
        """), {"sid": scheme_id, "pid": package_id}).scalar()
        new_rev = int(max_rev) + 1
        rev_label = data.get("revision_label") or ("Initial" if new_rev == 0 else f"Rev-{chr(64 + new_rev)}")

        # extra_fields holds the legacy header fields t5 has no column for
        ef = {
            k: data.get(k) for k in (
                "document_no", "document_date", "fy_baseline",
                "scheduled_start_date", "scheduled_finish_date",
                "total_scope_value_cr", "prepared_by_name", "remarks",
            ) if data.get(k) is not None
        }

        new_id = db.execute(text("""
            INSERT INTO appendix2_revisions (
                scheme_id, package_id, revision_label, revision_no, is_current,
                is_locked, source, source_template_id, description,
                extra_fields, is_deleted, created_by, created_at, updated_at
            ) VALUES (
                :sid, :pid, :label, :rev, TRUE,
                FALSE, :src, :tmpl, :desc,
                CAST(:ef AS jsonb), FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING revision_id
        """), {
            "sid": scheme_id, "pid": package_id, "label": rev_label, "rev": new_rev,
            "src": "template" if data.get("template_id") else ("copy" if data.get("copy_from_revision_id") else "manual"),
            "tmpl": data.get("template_id"),
            "desc": data.get("revision_reason") or data.get("description"),
            "ef": _json.dumps(ef),
        }).scalar()

        items_created = 0

        # AUTO-FILL from template.
        # Template items may be either:
        #   (a) a FLAT phase skeleton: each row carries a category_label and
        #       (often) NULL item_label  -> we create one CATEGORY row per
        #       distinct category_label, and attach any row that DOES have an
        #       item_label as a leaf under its category.
        #   (b) an explicit hierarchy: rows already flagged is_category=true for
        #       phases + is_category=false leaves with item_label set.
        # Either way the result obeys the DB category_consistency check:
        # categories have parent NULL; leaves have a parent.
        if data.get("template_id"):
            tpl = db.execute(text("""
                SELECT template_item_id, parent_template_item_id, is_category,
                       category_label, item_label, default_commencement_months,
                       default_completion_months, default_weight_pct, sort_order, notes
                FROM appendix2_template_items
                WHERE template_id = :tid
                ORDER BY sort_order, template_item_id
            """), {"tid": data["template_id"]}).fetchall()

            def _insert_item(parent, is_cat, category, name, cm, comp, wt, order, note):
                return db.execute(text("""
                    INSERT INTO appendix2_items (
                        revision_id, parent_item_id, is_category, s_no, category,
                        item_name, commencement_months, completion_months,
                        weight_pct, sort_order, notes, source, extra_fields,
                        created_at, updated_at
                    ) VALUES (
                        :rev, :parent, :iscat, NULL, :cat,
                        :name, :cm, :comp,
                        :wt, :ord, :note, 'template', '{}'::jsonb,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    RETURNING item_id
                """), {
                    "rev": new_id, "parent": parent, "iscat": is_cat,
                    "cat": category, "name": name,
                    "cm": cm or 0, "comp": comp or 0, "wt": wt or 0,
                    "ord": order or 0, "note": note,
                }).scalar()

            # 1) ensure a category row exists for each distinct phase, in first
            #    appearance order.
            category_id_by_label = {}
            cat_order = 0
            for ti in tpl:
                phase = (ti.category_label or "Uncategorised").strip()
                if phase not in category_id_by_label:
                    cat_order += 10
                    category_id_by_label[phase] = _insert_item(
                        parent=None, is_cat=True, category=phase, name=phase,
                        cm=0, comp=0, wt=0, order=cat_order, note=None,
                    )

            # 2) attach leaves: any template row that names an actual item.
            leaf_order = 0
            for ti in tpl:
                phase = (ti.category_label or "Uncategorised").strip()
                # a leaf is a row with a real item_label, OR a row explicitly
                # flagged is_category=false AND carrying an item_label.
                item_name = (ti.item_label or "").strip()
                if not item_name:
                    # phase-only skeleton row -> no leaf to create (category
                    # already made above). Skip.
                    continue
                leaf_order += 10
                _insert_item(
                    parent=category_id_by_label[phase], is_cat=False,
                    category=phase, name=item_name,
                    cm=ti.default_commencement_months,
                    comp=ti.default_completion_months,
                    wt=ti.default_weight_pct, order=leaf_order, note=ti.notes,
                )
                items_created += 1

            db.execute(text("UPDATE appendix2_templates SET usage_count = usage_count + 1 WHERE template_id = :t"),
                       {"t": data["template_id"]})

        # COPY-FROM-PREVIOUS revision (preserve hierarchy)
        elif data.get("copy_from_revision_id"):
            prev = db.execute(text("""
                SELECT item_id, parent_item_id, is_category, s_no, category,
                       item_name, commencement_months, completion_months,
                       schedule_start, schedule_finish, weight_pct, sort_order,
                       notes, extra_fields
                FROM appendix2_items WHERE revision_id = :p
                ORDER BY sort_order, item_id
            """), {"p": data["copy_from_revision_id"]}).fetchall()
            id_map = {}
            for pa in prev:
                parent_new = id_map.get(pa.parent_item_id)
                ef_val = pa.extra_fields
                if isinstance(ef_val, dict):
                    ef_val = _json.dumps(ef_val)
                new_item = db.execute(text("""
                    INSERT INTO appendix2_items (
                        revision_id, parent_item_id, is_category, s_no, category,
                        item_name, commencement_months, completion_months,
                        schedule_start, schedule_finish, weight_pct, sort_order,
                        notes, source, extra_fields, created_at, updated_at
                    ) VALUES (
                        :rev, :parent, :iscat, :sno, :cat,
                        :name, :cm, :comp,
                        :ss, :sf, :wt, :ord,
                        :note, 'copy', CAST(:ef AS jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    RETURNING item_id
                """), {
                    "rev": new_id, "parent": parent_new, "iscat": pa.is_category,
                    "sno": pa.s_no, "cat": pa.category, "name": pa.item_name,
                    "cm": pa.commencement_months, "comp": pa.completion_months,
                    "ss": pa.schedule_start, "sf": pa.schedule_finish,
                    "wt": pa.weight_pct, "ord": pa.sort_order, "note": pa.notes,
                    "ef": ef_val or "{}",
                }).scalar()
                id_map[pa.item_id] = new_item
                if not pa.is_category:
                    items_created += 1

        db.commit()
        return {
            "appendix2_id": new_id,       # legacy alias
            "revision_id": new_id,
            "revision_no": new_rev,
            "revision_label": rev_label,
            "activities_created": items_created,   # legacy alias
            "items_created": items_created,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


# ============================================================================
# 5) GET /{revision_id}/full  -> header + items (hierarchical) + cascade map
# ============================================================================
@router.get("/{appendix2_id}/full")
def get_full_document(appendix2_id: int, db: Session = Depends(get_db)):
    h = db.execute(text("""
        SELECT r.*, t.template_name, p.package_name, sm.scheme_name
        FROM appendix2_revisions r
        LEFT JOIN appendix2_templates t ON t.template_id = r.source_template_id
        LEFT JOIN packages p ON p.package_id = r.package_id
        LEFT JOIN scheme_master sm ON sm.scheme_id = r.scheme_id
        WHERE r.revision_id = :id
    """), {"id": appendix2_id}).first()
    if not h:
        raise HTTPException(status_code=404, detail="Appendix-2 not found")

    items = db.execute(text("""
        SELECT item_id, parent_item_id, is_category, s_no, category, item_name,
               commencement_months, completion_months, schedule_start,
               schedule_finish, weight_pct, sort_order, notes, extra_fields
        FROM appendix2_items WHERE revision_id = :id
        ORDER BY sort_order, item_id
    """), {"id": appendix2_id}).fetchall()

    ef = h.extra_fields or {}

    # Build category->items cascade map (for the dropdown the UI needs)
    cascade = {}
    cat_name = {}
    for it in items:
        if it.is_category:
            cat_name[it.item_id] = it.category or it.item_name
            cascade.setdefault(it.item_id, [])
    for it in items:
        if not it.is_category and it.parent_item_id in cascade:
            cascade[it.parent_item_id].append({"item_id": it.item_id, "item_name": it.item_name})
    cascade_named = {cat_name.get(cid, str(cid)): lst for cid, lst in cascade.items()}

    def item_row(a):
        return {
            "appendix2_activity_id": a.item_id,   # legacy alias
            "item_id": a.item_id,
            "parent_item_id": a.parent_item_id,
            "is_category": a.is_category,
            "s_no": a.s_no,
            "category": a.category,
            "activity_name": a.item_name,         # legacy alias
            "item_name": a.item_name,
            "commencement_months": _num(a.commencement_months),
            "completion_months": _num(a.completion_months),
            "activity_start_date": _date(a.schedule_start),   # legacy alias
            "activity_finish_date": _date(a.schedule_finish),  # legacy alias
            "schedule_start": _date(a.schedule_start),
            "schedule_finish": _date(a.schedule_finish),
            "weightage": _num(a.weight_pct),       # legacy alias
            "weight_pct": _num(a.weight_pct),
            "sort_order": a.sort_order,
            "display_order": a.sort_order,         # legacy alias
            "notes": a.notes,
            "extra_fields": a.extra_fields or {},
        }

    return {
        "header": {
            "appendix2_id": h.revision_id,        # legacy alias
            "revision_id": h.revision_id,
            "scheme_id": h.scheme_id,
            "scheme_name": h.scheme_name,
            "package_id": h.package_id,
            "package_name": h.package_name,
            "revision_no": h.revision_no,
            "revision_label": h.revision_label,
            "revision_reason": h.description,     # legacy alias
            "description": h.description,
            "is_current": h.is_current,
            "is_locked": h.is_locked,
            "is_approved": h.is_locked,           # legacy alias
            "template_name": h.template_name,
            "based_on_template_id": h.source_template_id,
            "document_no": ef.get("document_no"),
            "document_date": ef.get("document_date"),
            "fy_baseline": ef.get("fy_baseline"),
            "scheduled_start_date": ef.get("scheduled_start_date"),
            "scheduled_finish_date": ef.get("scheduled_finish_date"),
            "total_scope_value_cr": ef.get("total_scope_value_cr"),
            "prepared_by_name": ef.get("prepared_by_name"),
            "approved_by_name": ef.get("approved_by_name"),
            "approval_date": ef.get("approval_date"),
            "extra_fields": ef,
        },
        "activities": [item_row(a) for a in items],   # legacy key
        "items": [item_row(a) for a in items],
        "cascade": cascade_named,                       # category -> [items]
        "monthly_cells": {},  # monthly distribution lives in plan after sync
    }


# ============================================================================
# 6) PUT /{revision_id}/header
# ============================================================================
@router.put("/{appendix2_id}/header")
def update_header(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    import json as _json
    try:
        # Real columns on appendix2_revisions:
        col_sets, params = [], {"id": appendix2_id}
        if "revision_label" in data:
            col_sets.append("revision_label = :revision_label")
            params["revision_label"] = data["revision_label"]
        if "revision_reason" in data or "description" in data:
            col_sets.append("description = :description")
            params["description"] = data.get("revision_reason") or data.get("description")

        # legacy/extra header fields -> merge into extra_fields
        extra_keys = ["document_no", "document_date", "fy_baseline",
                      "scheduled_start_date", "scheduled_finish_date",
                      "total_scope_value_cr", "prepared_by_name",
                      "approved_by_name", "approval_date", "remarks"]
        extra_updates = {k: data[k] for k in extra_keys if k in data}
        if extra_updates:
            col_sets.append("extra_fields = extra_fields || CAST(:ej AS jsonb)")
            params["ej"] = _json.dumps(extra_updates)

        if not col_sets:
            return {"ok": True, "noop": True}
        col_sets.append("updated_at = CURRENT_TIMESTAMP")
        db.execute(text(f"UPDATE appendix2_revisions SET {', '.join(col_sets)} WHERE revision_id = :id"), params)
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Header update failed: {e}")


# ============================================================================
# 7) POST /{revision_id}/activities  -> add an item (leaf or category)
# ============================================================================
@router.post("/{appendix2_id}/activities")
def add_activity(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        max_order = db.execute(
            text("SELECT COALESCE(MAX(sort_order),0) FROM appendix2_items WHERE revision_id = :id"),
            {"id": appendix2_id}).scalar()

        is_category = bool(data.get("is_category", False))
        parent_item_id = data.get("parent_item_id")
        # DB CHECK: category => parent NULL; leaf => parent NOT NULL
        if is_category:
            parent_item_id = None
        elif parent_item_id is None:
            raise HTTPException(status_code=400, detail="Leaf item requires parent_item_id (a category)")

        new_id = db.execute(text("""
            INSERT INTO appendix2_items (
                revision_id, parent_item_id, is_category, s_no, category,
                item_name, commencement_months, completion_months,
                schedule_start, schedule_finish, weight_pct, sort_order,
                notes, source, extra_fields, created_at, updated_at
            ) VALUES (
                :rev, :parent, :iscat, :sno, :cat,
                :name, :cm, :comp,
                :ss, :sf, :wt, :ord,
                :note, 'manual', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING item_id
        """), {
            "rev": appendix2_id, "parent": parent_item_id, "iscat": is_category,
            "sno": data.get("s_no"),
            "cat": data.get("category"),
            "name": data.get("item_name") or data.get("activity_name", "New Item"),
            "cm": data.get("commencement_months", 0),
            "comp": data.get("completion_months", 0),
            "ss": data.get("schedule_start") or data.get("activity_start_date"),
            "sf": data.get("schedule_finish") or data.get("activity_finish_date"),
            "wt": data.get("weight_pct", data.get("weightage", 0)),
            "ord": int(max_order or 0) + 10,
            "note": data.get("notes"),
        }).scalar()
        db.commit()
        return {"appendix2_activity_id": new_id, "item_id": new_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Add item failed: {e}")


# ============================================================================
# 8) PUT /activities/{item_id}
# ============================================================================
@router.put("/activities/{activity_id}")
def update_activity(activity_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        # accept both new + legacy field names
        field_map = {
            "s_no": "s_no", "category": "category",
            "item_name": "item_name", "activity_name": "item_name",
            "commencement_months": "commencement_months",
            "completion_months": "completion_months",
            "schedule_start": "schedule_start", "activity_start_date": "schedule_start",
            "schedule_finish": "schedule_finish", "activity_finish_date": "schedule_finish",
            "weight_pct": "weight_pct", "weightage": "weight_pct",
            "sort_order": "sort_order", "display_order": "sort_order",
            "notes": "notes",
        }
        sets, params = [], {"id": activity_id}
        seen = set()
        for incoming, col in field_map.items():
            if incoming in data and col not in seen:
                sets.append(f"{col} = :{col}")
                params[col] = data[incoming]
                seen.add(col)
        if not sets:
            return {"ok": True, "noop": True}
        sets.append("updated_at = CURRENT_TIMESTAMP")
        db.execute(text(f"UPDATE appendix2_items SET {', '.join(sets)} WHERE item_id = :id"), params)
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


# ============================================================================
# 9) DELETE /activities/{item_id}
# ============================================================================
@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    try:
        # also remove child leaves if a category is deleted
        db.execute(text("DELETE FROM appendix2_items WHERE item_id = :id OR parent_item_id = :id"),
                   {"id": activity_id})
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 10) POST /{revision_id}/approve  -> lock the revision (t5 has no is_approved)
#     Validates leaf weight_pct sums to 100.
# ============================================================================
@router.post("/{appendix2_id}/approve")
def approve_document(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    import json as _json
    try:
        total_wt = db.execute(text("""
            SELECT COALESCE(SUM(weight_pct),0) FROM appendix2_items
            WHERE revision_id = :id AND is_category = FALSE
        """), {"id": appendix2_id}).scalar()
        if abs(float(total_wt or 0) - 100.0) > 0.01:
            raise HTTPException(status_code=400,
                detail=f"Cannot approve: leaf weights sum to {total_wt}, must be 100")

        extra = {k: data[k] for k in ("approved_by_name", "approval_date", "board_meeting_ref") if k in data}
        if not extra.get("approval_date"):
            extra["approval_date"] = date.today().isoformat()

        db.execute(text("""
            UPDATE appendix2_revisions
            SET is_locked = TRUE,
                extra_fields = extra_fields || CAST(:ej AS jsonb),
                updated_at = CURRENT_TIMESTAMP
            WHERE revision_id = :id
        """), {"id": appendix2_id, "ej": _json.dumps(extra)})
        db.commit()
        return {"ok": True, "is_approved": True, "is_locked": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Approval failed: {e}")


# ============================================================================
# 11) POST /{revision_id}/sync-to-plan  -> create a progress_plan + activities
#     from this appendix-2 revision (leaf items become plan activities,
#     linked back via plan_activities.appendix2_item_id).
# ============================================================================
@router.post("/{appendix2_id}/sync-to-plan")
def sync_to_plan(appendix2_id: int, data: dict, db: Session = Depends(get_db)):
    rev = db.execute(text("""
        SELECT revision_id, scheme_id, package_id, is_locked, revision_label, extra_fields
        FROM appendix2_revisions WHERE revision_id = :id
    """), {"id": appendix2_id}).first()
    if not rev:
        raise HTTPException(status_code=404, detail="Appendix-2 not found")
    if not rev.is_locked:
        raise HTTPException(status_code=400, detail="Cannot sync — revision not locked/approved yet")

    package_id = rev.package_id
    if not package_id:
        package_id = db.execute(text("""
            SELECT package_id FROM packages
            WHERE scheme_id = :sid AND is_scheme_mirror = TRUE AND is_deleted = FALSE
            LIMIT 1
        """), {"sid": rev.scheme_id}).scalar()
    if not package_id:
        raise HTTPException(status_code=400, detail="No package to sync to")

    ef = rev.extra_fields or {}

    try:
        # de-current existing plans for this package
        db.execute(text("""
            UPDATE progress_plans SET is_current = FALSE
            WHERE package_id = :p AND is_current = TRUE AND is_deleted = FALSE
        """), {"p": package_id})

        new_plan_id = db.execute(text("""
            INSERT INTO progress_plans (
                package_id, plan_name, plan_type, financial_year, plan_version,
                is_current, is_locked, plan_start_date, plan_end_date,
                appendix2_revision_id, description, extra_fields, is_deleted,
                created_by, created_at, updated_at
            ) VALUES (
                :pkg, :name, 'execution', :fy, 'v1',
                TRUE, FALSE, :start, :end,
                :rev, :desc, '{}'::jsonb, FALSE,
                1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING plan_id
        """), {
            "pkg": package_id,
            "name": f"Plan from Appendix-2 ({rev.revision_label})",
            "fy": ef.get("fy_baseline"),
            "start": ef.get("scheduled_start_date"),
            "end": ef.get("scheduled_finish_date"),
            "rev": appendix2_id,
            "desc": f"Synced from appendix-2 revision {rev.revision_label}",
        }).scalar()

        # leaf items -> plan activities (linked via appendix2_item_id)
        leaves = db.execute(text("""
            SELECT item_id, item_name, category, weight_pct, schedule_start,
                   schedule_finish, sort_order
            FROM appendix2_items
            WHERE revision_id = :id AND is_category = FALSE
            ORDER BY sort_order, item_id
        """), {"id": appendix2_id}).fetchall()

        for a in leaves:
            db.execute(text("""
                INSERT INTO plan_activities (
                    plan_id, appendix2_item_id, activity_name, activity_category,
                    scope_qty, weight_pct, planned_start_date, planned_finish_date,
                    actuals_till_last_fy, sort_order, is_deleted, extra_fields,
                    created_at, updated_at
                ) VALUES (
                    :pid, :item, :name, :cat,
                    0, :wt, :start, :finish,
                    0, :ord, FALSE, '{}'::jsonb,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """), {
                "pid": new_plan_id, "item": a.item_id, "name": a.item_name,
                "cat": a.category, "wt": a.weight_pct or 0,
                "start": a.schedule_start, "finish": a.schedule_finish,
                "ord": a.sort_order or 0,
            })

        db.commit()
        return {
            "ok": True,
            "plan_id": new_plan_id,
            "progress_plan_id": new_plan_id,   # legacy alias
            "package_id": package_id,
            "activities_synced": len(leaves),
            "message": f"Synced {len(leaves)} activities into a new plan",
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")


# ============================================================================
# 12) DELETE /{revision_id}  -> soft-delete a revision (only if not locked)
# ============================================================================
@router.delete("/{appendix2_id}")
def delete_document(appendix2_id: int, db: Session = Depends(get_db)):
    try:
        locked = db.execute(text("SELECT is_locked FROM appendix2_revisions WHERE revision_id = :id"),
                            {"id": appendix2_id}).scalar()
        if locked:
            raise HTTPException(status_code=400, detail="Cannot delete a locked/approved revision")
        db.execute(text("UPDATE appendix2_revisions SET is_deleted = TRUE, is_current = FALSE WHERE revision_id = :id"),
                   {"id": appendix2_id})
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
