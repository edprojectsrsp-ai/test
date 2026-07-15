"""Report Studio API — self-service KPI / metric builder.

  GET    /report-studio/datasets            curated dataset registry (fields + measures)
  POST   /report-studio/query               run an ad-hoc structured query
  GET    /report-studio/metrics             list saved metrics
  POST   /report-studio/metrics             save a metric (query spec + viz)
  GET    /report-studio/metrics/{id}        fetch one
  PUT    /report-studio/metrics/{id}        update
  DELETE /report-studio/metrics/{id}        delete
  POST   /report-studio/metrics/{id}/run    execute a saved metric

All queries are compiled to safe parameterized SQL against the dataset registry
(app/services/report_studio.py). No raw user SQL is accepted or executed.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import report_studio as RS

router = APIRouter(
    prefix="/report-studio",
    tags=["Report Studio"],
    dependencies=[Depends(require_user)],
)


def _run_query(db: Session, q: RS.QueryIn) -> dict[str, Any]:
    try:
        sql, params, columns = RS.compile_query(q)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        rows = db.execute(text(sql), params).mappings().all()
    except Exception as e:  # surface SQL errors as 400 (bad query), not 500
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)[:300]}")
    # jsonify (dates, Decimals) — mappings() already gives dict-likes; coerce values
    out_rows = []
    for r in rows:
        row = {}
        for k, v in dict(r).items():
            if hasattr(v, "isoformat"):
                row[k] = v.isoformat()
            elif isinstance(v, (int, float, str, bool)) or v is None:
                row[k] = v
            else:
                row[k] = float(v)  # Decimal
        out_rows.append(row)
    return {"columns": columns, "rows": out_rows, "sql": sql, "row_count": len(out_rows)}


@router.get("/datasets")
def datasets():
    return {"datasets": RS.registry_public()}


@router.post("/query")
def run_query(q: RS.QueryIn, db: Session = Depends(get_db)):
    return _run_query(db, q)


# ---------------------------------------------------------------- saved metrics

class MetricIn(BaseModel):
    name: str
    description: Optional[str] = None
    dataset: str
    spec: RS.QueryIn
    viz: str = "kpi"
    folder: Optional[str] = None
    is_pinned: bool = False


def _metric_row(db: Session, metric_id: int) -> dict:
    row = db.execute(
        text("SELECT * FROM rs_metrics WHERE metric_id = :m"), {"m": metric_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Metric not found")
    return dict(row)


@router.get("/metrics")
def list_metrics(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT metric_id, name, description, dataset, viz, folder, is_pinned, updated_at "
        "FROM rs_metrics ORDER BY is_pinned DESC, updated_at DESC"
    )).mappings().all()
    return {"metrics": [dict(r) for r in rows]}


@router.post("/metrics")
def create_metric(payload: MetricIn, db: Session = Depends(get_db)):
    if payload.dataset not in RS.DATASETS:
        raise HTTPException(status_code=400, detail=f"Unknown dataset '{payload.dataset}'")
    # validate the spec compiles before saving
    try:
        RS.compile_query(payload.spec)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=f"Invalid metric spec: {e}")
    mid = db.execute(text(
        "INSERT INTO rs_metrics (name, description, dataset, spec, viz, folder, is_pinned) "
        "VALUES (:n, :d, :ds, CAST(:spec AS jsonb), :viz, :folder, :pin) RETURNING metric_id"
    ), {
        "n": payload.name, "d": payload.description, "ds": payload.dataset,
        "spec": payload.spec.model_dump_json(), "viz": payload.viz,
        "folder": payload.folder, "pin": payload.is_pinned,
    }).scalar()
    db.commit()
    return {"metric_id": mid}


@router.get("/metrics/{metric_id}")
def get_metric(metric_id: int, db: Session = Depends(get_db)):
    row = _metric_row(db, metric_id)
    if isinstance(row.get("spec"), str):
        row["spec"] = json.loads(row["spec"])
    return row


@router.put("/metrics/{metric_id}")
def update_metric(metric_id: int, payload: MetricIn, db: Session = Depends(get_db)):
    _metric_row(db, metric_id)
    try:
        RS.compile_query(payload.spec)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=f"Invalid metric spec: {e}")
    db.execute(text(
        "UPDATE rs_metrics SET name=:n, description=:d, dataset=:ds, spec=CAST(:spec AS jsonb), "
        "viz=:viz, folder=:folder, is_pinned=:pin, updated_at=now() WHERE metric_id=:m"
    ), {
        "n": payload.name, "d": payload.description, "ds": payload.dataset,
        "spec": payload.spec.model_dump_json(), "viz": payload.viz,
        "folder": payload.folder, "pin": payload.is_pinned, "m": metric_id,
    })
    db.commit()
    return {"ok": True}


@router.delete("/metrics/{metric_id}")
def delete_metric(metric_id: int, db: Session = Depends(get_db)):
    _metric_row(db, metric_id)
    db.execute(text("DELETE FROM rs_metrics WHERE metric_id = :m"), {"m": metric_id})
    db.commit()
    return {"ok": True}


@router.post("/metrics/{metric_id}/run")
def run_metric(metric_id: int, db: Session = Depends(get_db)):
    row = _metric_row(db, metric_id)
    spec = row["spec"]
    if isinstance(spec, str):
        spec = json.loads(spec)
    q = RS.QueryIn(**spec)
    result = _run_query(db, q)
    result["metric"] = {"metric_id": metric_id, "name": row["name"], "viz": row["viz"]}
    return result
