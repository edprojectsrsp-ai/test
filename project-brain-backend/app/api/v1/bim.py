"""4D BIM API — 3D model store + element↔activity links + time-phased status.

  POST   /bim/models                        upload IFC/GLB model for a scheme
  GET    /bim/models?scheme_id=             list models
  GET    /bim/models/{model_id}/file        serve the raw model file
  DELETE /bim/models/{model_id}             hard-delete model + links + disk file
  DELETE /bim/schemes/{scheme_id}/data      clear all BIM uploads/links for a scheme
  GET    /bim/models/{model_id}/links       list element↔activity links
  POST   /bim/models/{model_id}/links       create link(s) {element_key, activity_id}
  DELETE /bim/links/{link_id}               remove a link
  GET    /bim/models/{model_id}/activities  current-plan activities of the model's scheme
  GET    /bim/models/{model_id}/4d          timeline payload: activities + dates + linked element keys
"""

from __future__ import annotations

import os
import re
import shutil
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user

router = APIRouter(
    prefix="/bim",
    tags=["4D BIM"],
    dependencies=[Depends(require_user)],
)

BIM_UPLOAD_DIR = os.path.join("uploads", "bim")
os.makedirs(BIM_UPLOAD_DIR, exist_ok=True)

ALLOWED_EXT = {".ifc": "ifc", ".glb": "glb", ".gltf": "gltf"}
MEDIA_TYPES = {
    "ifc": "application/x-step",
    "glb": "model/gltf-binary",
    "gltf": "model/gltf+json",
}


def _model_row(db: Session, model_id: int):
    row = db.execute(
        text("SELECT * FROM bim_models WHERE model_id = :m AND is_active"),
        {"m": model_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="BIM model not found")
    return row


# ---------------------------------------------------------------- models CRUD

@router.post("/models")
async def upload_model(
    scheme_id: int = Form(...),
    model_name: str = Form(...),
    package_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Only .ifc, .glb, .gltf files allowed")

    exists = db.execute(
        text("SELECT 1 FROM scheme_master WHERE scheme_id = :s"), {"s": scheme_id}
    ).first()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Scheme {scheme_id} not found")

    safe = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename)
    file_path = os.path.join(BIM_UPLOAD_DIR, f"scheme{scheme_id}_{safe}")
    with open(file_path, "wb") as fh:
        shutil.copyfileobj(file.file, fh)
    size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 2)

    model_id = db.execute(
        text("""
            INSERT INTO bim_models
                (scheme_id, package_id, model_name, file_name, file_path, file_format, file_size_mb)
            VALUES (:s, :p, :n, :fn, :fp, :fmt, :sz)
            RETURNING model_id
        """),
        {"s": scheme_id, "p": package_id, "n": model_name, "fn": safe,
         "fp": file_path, "fmt": ALLOWED_EXT[ext], "sz": size_mb},
    ).scalar()
    db.commit()
    return {"model_id": model_id, "file_format": ALLOWED_EXT[ext], "file_size_mb": size_mb}


@router.get("/models")
def list_models(scheme_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT m.model_id, m.scheme_id, sm.scheme_name, m.package_id,
                   m.model_name, m.file_name, m.file_format, m.file_size_mb, m.uploaded_at,
                   (SELECT COUNT(*) FROM bim_element_links l WHERE l.model_id = m.model_id) AS link_count
            FROM bim_models m
            JOIN scheme_master sm ON sm.scheme_id = m.scheme_id
            WHERE m.is_active AND (:s IS NULL OR m.scheme_id = CAST(:s AS integer))
            ORDER BY m.uploaded_at DESC
        """),
        {"s": scheme_id},
    ).mappings().all()
    return {"models": [dict(r) for r in rows]}


@router.get("/models/{model_id}/file")
def get_model_file(model_id: int, db: Session = Depends(get_db)):
    row = _model_row(db, model_id)
    if not os.path.exists(row["file_path"]):
        raise HTTPException(status_code=410, detail="Model file missing on disk")
    return FileResponse(
        row["file_path"],
        media_type=MEDIA_TYPES.get(row["file_format"], "application/octet-stream"),
        filename=row["file_name"],
    )


def _purge_model_files(file_path: Optional[str]) -> bool:
    """Best-effort remove of an uploaded model file from disk."""
    if not file_path:
        return False
    try:
        if os.path.isfile(file_path):
            os.remove(file_path)
            return True
    except OSError:
        pass
    return False


def _hard_delete_model(db: Session, model_id: int, file_path: Optional[str] = None) -> dict:
    """Remove element links + model row + optional disk file for one model."""
    links_res = db.execute(
        text("DELETE FROM bim_element_links WHERE model_id = :m"),
        {"m": model_id},
    )
    models_res = db.execute(
        text("DELETE FROM bim_models WHERE model_id = :m"),
        {"m": model_id},
    )
    # Also clear soft-deleted leftovers if schema still uses is_active
    if models_res.rowcount == 0:
        db.execute(
            text("UPDATE bim_models SET is_active = FALSE WHERE model_id = :m"),
            {"m": model_id},
        )
    removed_file = _purge_model_files(file_path)
    return {
        "model_id": model_id,
        "links_deleted": int(links_res.rowcount or 0),
        "file_removed": removed_file,
    }


@router.delete("/models/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    """Hard-delete one uploaded BIM model: DB row, element links, and disk file."""
    row = _model_row(db, model_id)
    result = _hard_delete_model(db, model_id, row.get("file_path"))
    db.commit()
    return {"ok": True, **result}


@router.delete("/schemes/{scheme_id}/data")
def clear_scheme_bim_data(scheme_id: int, db: Session = Depends(get_db)):
    """Clear all 4D BIM uploads for a scheme (models + element links + files).

    Plan activities / schedule data are left untouched — only BIM model store.
    """
    exists = db.execute(
        text("SELECT 1 FROM scheme_master WHERE scheme_id = :s"), {"s": scheme_id}
    ).first()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Scheme {scheme_id} not found")

    rows = db.execute(
        text("""
            SELECT model_id, file_path
            FROM bim_models
            WHERE scheme_id = :s
        """),
        {"s": scheme_id},
    ).mappings().all()

    deleted = []
    for r in rows:
        deleted.append(_hard_delete_model(db, int(r["model_id"]), r.get("file_path")))

    # Safety net: remove any orphan links for this scheme's former models
    db.execute(
        text("""
            DELETE FROM bim_element_links
            WHERE model_id NOT IN (SELECT model_id FROM bim_models)
        """),
    )
    db.commit()
    return {
        "ok": True,
        "scheme_id": scheme_id,
        "models_deleted": len(deleted),
        "links_deleted": sum(d["links_deleted"] for d in deleted),
        "files_removed": sum(1 for d in deleted if d["file_removed"]),
        "details": deleted,
    }


# ---------------------------------------------------------------------- links

class LinkIn(BaseModel):
    element_key: str
    activity_id: int
    element_name: Optional[str] = None


@router.get("/models/{model_id}/links")
def list_links(model_id: int, db: Session = Depends(get_db)):
    _model_row(db, model_id)
    rows = db.execute(
        text("""
            SELECT l.link_id, l.element_key, l.element_name, l.activity_id,
                   pa.activity_name, pa.activity_category
            FROM bim_element_links l
            JOIN plan_activities pa ON pa.activity_id = l.activity_id
            WHERE l.model_id = :m
            ORDER BY l.link_id
        """),
        {"m": model_id},
    ).mappings().all()
    return {"links": [dict(r) for r in rows]}


@router.post("/models/{model_id}/links")
def create_links(model_id: int, links: List[LinkIn], db: Session = Depends(get_db)):
    _model_row(db, model_id)
    created = 0
    for lk in links:
        act = db.execute(
            text("SELECT 1 FROM plan_activities WHERE activity_id = :a AND NOT is_deleted"),
            {"a": lk.activity_id},
        ).first()
        if not act:
            raise HTTPException(status_code=404, detail=f"Activity {lk.activity_id} not found")
        db.execute(
            text("""
                INSERT INTO bim_element_links (model_id, element_key, element_name, activity_id)
                VALUES (:m, :k, :n, :a)
                ON CONFLICT (model_id, element_key, activity_id) DO NOTHING
            """),
            {"m": model_id, "k": lk.element_key, "n": lk.element_name, "a": lk.activity_id},
        )
        created += 1
    db.commit()
    return {"ok": True, "created": created}


@router.delete("/links/{link_id}")
def delete_link(link_id: int, db: Session = Depends(get_db)):
    res = db.execute(text("DELETE FROM bim_element_links WHERE link_id = :l"), {"l": link_id})
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"ok": True}


# ------------------------------------------------------------- 4D timeline

_ACTIVITIES_SQL = """
    SELECT pa.activity_id, pa.activity_name, pa.activity_category,
           pa.scope_qty, pa.actuals_till_last_fy,
           pa.planned_start_date, pa.planned_finish_date,
           pa.actual_start_date, pa.actual_finish_date, pa.expected_finish_date,
           pa.weight_pct, pp.plan_id, pp.plan_name, pk.package_id, pk.package_name,
           COALESCE(CAST(pk.extra_fields->>'scheme_rollup_weight' AS float),
                    CAST(pk.package_value_cr AS float),
                    CAST(pk.package_estimate_cr AS float)) AS pkg_weight
    FROM plan_activities pa
    JOIN progress_plans pp ON pp.plan_id = pa.plan_id
    JOIN packages pk ON pk.package_id = pp.package_id
    WHERE pk.scheme_id = :s
      AND pp.is_current AND NOT pp.is_deleted AND NOT pa.is_deleted
    ORDER BY pk.package_id, pa.sort_order NULLS LAST, pa.activity_id
"""


# Monthly-bucketed actual quantities (daily_actuals.actual_qty), per activity,
# for the same current-plan scope. The client accumulates these up to the
# scrubbed date and divides by scope_qty (+ actuals_till_last_fy carry-forward)
# — the same actual-% convention as the S-curve.
_ACTUALS_SQL = """
    SELECT da.activity_id,
           CAST(date_trunc('month', da.actual_date) AS date) AS month_date,
           SUM(da.actual_qty) AS qty
    FROM daily_actuals da
    JOIN plan_activities pa ON pa.activity_id = da.activity_id
    JOIN progress_plans pp ON pp.plan_id = pa.plan_id
    JOIN packages pk ON pk.package_id = pp.package_id
    WHERE pk.scheme_id = :s
      AND pp.is_current AND NOT pp.is_deleted AND NOT pa.is_deleted
    GROUP BY da.activity_id, CAST(date_trunc('month', da.actual_date) AS date)
    ORDER BY da.activity_id, month_date
"""


def _activities_with_actuals(db: Session, scheme_id: int) -> list[dict]:
    acts = [dict(r) for r in db.execute(text(_ACTIVITIES_SQL), {"s": scheme_id}).mappings().all()]
    monthly: dict[int, list[dict]] = {}
    for aid, month_date, qty in db.execute(text(_ACTUALS_SQL), {"s": scheme_id}).all():
        monthly.setdefault(aid, []).append({"month_date": month_date.isoformat(), "qty": float(qty or 0)})
    for a in acts:
        a["actual_monthly"] = monthly.get(a["activity_id"], [])
    return acts


@router.get("/schemes/{scheme_id}/activities")
def scheme_activities(scheme_id: int, db: Session = Depends(get_db)):
    return {"scheme_id": scheme_id, "activities": _activities_with_actuals(db, scheme_id)}


@router.get("/models/{model_id}/activities")
def model_activities(model_id: int, db: Session = Depends(get_db)):
    row = _model_row(db, model_id)
    return {"scheme_id": row["scheme_id"], "activities": _activities_with_actuals(db, row["scheme_id"])}


@router.get("/models/{model_id}/4d")
def model_4d(model_id: int, db: Session = Depends(get_db)):
    """Everything the 4D viewer needs in one call: activities with dates and
    the element keys linked to each activity, plus the overall date window."""
    row = _model_row(db, model_id)
    acts = _activities_with_actuals(db, row["scheme_id"])
    links = db.execute(
        text("SELECT activity_id, element_key FROM bim_element_links WHERE model_id = :m"),
        {"m": model_id},
    ).all()
    by_act: dict[int, list[str]] = {}
    for aid, key in links:
        by_act.setdefault(aid, []).append(key)

    out, dates = [], []
    for a in acts:
        d = dict(a)
        d["element_keys"] = by_act.get(a["activity_id"], [])
        out.append(d)
        for f in ("planned_start_date", "planned_finish_date", "actual_start_date",
                  "actual_finish_date", "expected_finish_date"):
            if a[f]:
                dates.append(a[f])

    return {
        "model": {"model_id": row["model_id"], "model_name": row["model_name"],
                  "file_format": row["file_format"], "scheme_id": row["scheme_id"]},
        "timeline": {
            "min_date": min(dates).isoformat() if dates else None,
            "max_date": max(dates).isoformat() if dates else None,
        },
        "activities": out,
    }
