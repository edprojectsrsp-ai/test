"""Matrix Engine API — metadata-driven reports (Report Studio spec core).

  /report-studio/matrix/fields                    semantic layer
  /report-studio/matrix/rules            CRUD     reusable versioned rules
  /report-studio/matrix/rules/preview    POST     matching count + sample (spec §5.5)
  /report-studio/matrix/reports          CRUD     report definitions
  /report-studio/matrix/run              POST     calculate grid + reconciliation
  /report-studio/matrix/cell             POST     drill-down: contributing schemes (§5.9)
  /report-studio/matrix/snapshots        POST/GET freeze approved runs (§9)
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import matrix_engine as ME

router = APIRouter(prefix="/report-studio/matrix", tags=["Matrix Engine"],
                   dependencies=[Depends(require_user)])


def _ensure_tables(db: Session) -> None:
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_rules ("
        " rule_id SERIAL PRIMARY KEY, rule_key TEXT NOT NULL UNIQUE,"
        " rule_name TEXT NOT NULL, description TEXT, condition JSONB NOT NULL,"
        " version INTEGER NOT NULL DEFAULT 1, is_published BOOLEAN NOT NULL DEFAULT TRUE,"
        " updated_by VARCHAR(100), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_rule_versions ("
        " id SERIAL PRIMARY KEY, rule_key TEXT NOT NULL, version INTEGER NOT NULL,"
        " condition JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_matrix_reports ("
        " report_id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT,"
        " definition JSONB NOT NULL, updated_by VARCHAR(100),"
        " updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_matrix_snapshots ("
        " snapshot_id SERIAL PRIMARY KEY,"
        " report_id INTEGER REFERENCES rs_matrix_reports(report_id) ON DELETE CASCADE,"
        " report_date DATE NOT NULL, fy TEXT,"
        " status TEXT NOT NULL DEFAULT 'approved', result JSONB NOT NULL,"
        " definition JSONB NOT NULL, rules_used JSONB NOT NULL,"
        " frozen_by VARCHAR(100), created_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.commit()


def _jload(v):
    return json.loads(v) if isinstance(v, str) else v


# ───────────────────────────────────────────── semantic layer

@router.get("/fields")
def fields():
    return {"fields": [{"key": k, **v} for k, v in ME.SEMANTIC_FIELDS.items()],
            "period_tokens": ["report_date", "fy_start", "fy_end",
                              "prev_fy_start", "prev_fy_end", "one_year_before_report"],
            "operators": {
                "text": ["=", "!=", "contains", "not_contains", "starts_with",
                         "ends_with", "in", "not_in", "is_null", "not_null"],
                "number": ["=", "!=", ">", ">=", "<", "<=", "between",
                           "in", "not_in", "is_null", "not_null"],
                "date": ["=", "!=", ">", ">=", "<", "<=", "between",
                         "is_null", "not_null"],
            }}


# ───────────────────────────────────────────── rules

class RuleIn(BaseModel):
    rule_key: str
    rule_name: str
    description: Optional[str] = None
    condition: dict


class PreviewIn(BaseModel):
    condition: dict
    report_date: date


def _validate_condition(db: Session, condition: dict, report_date: date,
                        self_key: Optional[str] = None) -> int:
    """Dry-run the condition over the live population; returns matching count.
    Raises HTTP 400 with the engine's message on any invalid field/op/reference."""
    rules = ME.load_rules(db)
    if self_key:
        rules.pop(self_key, None)  # a rule must not (yet) reference itself
    ctx = ME.period_context(report_date)
    try:
        pop = ME.fetch_population(db, report_date)
        return sum(1 for r in pop if ME.eval_group(r, condition, ctx, rules))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/rules")
def list_rules(db: Session = Depends(get_db)):
    _ensure_tables(db)
    rows = db.execute(text(
        "SELECT rule_key, rule_name, description, condition, version, updated_at "
        "FROM rs_rules WHERE is_published ORDER BY rule_key")).mappings().all()
    return {"rules": [{**dict(r), "condition": _jload(r["condition"])} for r in rows]}


@router.post("/rules")
def upsert_rule(payload: RuleIn, report_date: Optional[date] = None,
                db: Session = Depends(get_db)):
    _ensure_tables(db)
    _validate_condition(db, payload.condition, report_date or date.today(),
                        self_key=payload.rule_key)
    existing = db.execute(text(
        "SELECT version FROM rs_rules WHERE rule_key = :k"),
        {"k": payload.rule_key}).scalar()
    if existing is not None:
        db.execute(text(
            "INSERT INTO rs_rule_versions (rule_key, version, condition) "
            "SELECT rule_key, version, condition FROM rs_rules WHERE rule_key = :k"),
            {"k": payload.rule_key})
        db.execute(text(
            "UPDATE rs_rules SET rule_name=:n, description=:d, "
            "condition=CAST(:c AS jsonb), version=version+1, updated_at=now() "
            "WHERE rule_key=:k"),
            {"k": payload.rule_key, "n": payload.rule_name,
             "d": payload.description, "c": json.dumps(payload.condition)})
    else:
        db.execute(text(
            "INSERT INTO rs_rules (rule_key, rule_name, description, condition) "
            "VALUES (:k, :n, :d, CAST(:c AS jsonb))"),
            {"k": payload.rule_key, "n": payload.rule_name,
             "d": payload.description, "c": json.dumps(payload.condition)})
    db.commit()
    v = db.execute(text("SELECT version FROM rs_rules WHERE rule_key=:k"),
                   {"k": payload.rule_key}).scalar()
    return {"rule_key": payload.rule_key, "version": v}


@router.delete("/rules/{rule_key}")
def delete_rule(rule_key: str, db: Session = Depends(get_db)):
    _ensure_tables(db)
    db.execute(text("DELETE FROM rs_rules WHERE rule_key=:k"), {"k": rule_key})
    db.commit()
    return {"ok": True}


@router.post("/rules/preview")
def preview_rule(payload: PreviewIn, db: Session = Depends(get_db)):
    """Spec §5.5 — matching count + a sample of matching schemes."""
    _ensure_tables(db)
    rules = ME.load_rules(db)
    ctx = ME.period_context(payload.report_date)
    try:
        pop = ME.fetch_population(db, payload.report_date)
        matched = [r for r in pop if ME.eval_group(r, payload.condition, ctx, rules)]
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"matching_count": len(matched), "population": len(pop),
            "sample": [{"scheme_id": r["scheme_id"], "scheme_name": r["scheme_name"],
                        "scheme_type": r["scheme_type"], "status": r["current_status"],
                        "delay_days": r["delay_days"]}
                       for r in matched[:25]]}


# ───────────────────────────────────────────── reports

class ReportIn(BaseModel):
    name: str
    description: Optional[str] = None
    definition: dict


class RunIn(BaseModel):
    report_id: Optional[int] = None
    definition: Optional[dict] = None      # ad-hoc run without saving
    report_date: date


class CellIn(RunIn):
    row_id: str
    column_key: str


def _definition_for(db: Session, payload: RunIn) -> dict:
    if payload.definition is not None:
        return payload.definition
    if payload.report_id is None:
        raise HTTPException(400, "Provide report_id or definition")
    d = db.execute(text("SELECT definition FROM rs_matrix_reports WHERE report_id=:r"),
                   {"r": payload.report_id}).scalar()
    if d is None:
        raise HTTPException(404, "Report not found")
    return _jload(d)


@router.get("/reports")
def list_reports(db: Session = Depends(get_db)):
    _ensure_tables(db)
    rows = db.execute(text(
        "SELECT report_id, name, description, updated_at FROM rs_matrix_reports "
        "ORDER BY updated_at DESC")).mappings().all()
    return {"reports": [dict(r) for r in rows]}


@router.get("/reports/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_db)):
    _ensure_tables(db)
    r = db.execute(text("SELECT * FROM rs_matrix_reports WHERE report_id=:r"),
                   {"r": report_id}).mappings().first()
    if not r:
        raise HTTPException(404, "Report not found")
    return {**dict(r), "definition": _jload(r["definition"])}


@router.post("/reports")
def save_report(payload: ReportIn, report_id: Optional[int] = None,
                db: Session = Depends(get_db)):
    _ensure_tables(db)
    if report_id:
        db.execute(text(
            "UPDATE rs_matrix_reports SET name=:n, description=:d, "
            "definition=CAST(:def AS jsonb), updated_at=now() WHERE report_id=:r"),
            {"r": report_id, "n": payload.name, "d": payload.description,
             "def": json.dumps(payload.definition)})
        db.commit()
        return {"report_id": report_id}
    rid = db.execute(text(
        "INSERT INTO rs_matrix_reports (name, description, definition) "
        "VALUES (:n, :d, CAST(:def AS jsonb)) RETURNING report_id"),
        {"n": payload.name, "d": payload.description,
         "def": json.dumps(payload.definition)}).scalar()
    db.commit()
    return {"report_id": rid}


@router.delete("/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)):
    _ensure_tables(db)
    db.execute(text("DELETE FROM rs_matrix_reports WHERE report_id=:r"), {"r": report_id})
    db.commit()
    return {"ok": True}


@router.post("/run")
def run(payload: RunIn, db: Session = Depends(get_db)):
    _ensure_tables(db)
    definition = _definition_for(db, payload)
    try:
        return ME.run_report(db, definition, payload.report_date)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/cell")
def cell(payload: CellIn, db: Session = Depends(get_db)):
    _ensure_tables(db)
    definition = _definition_for(db, payload)
    try:
        return ME.cell_drilldown(db, definition, payload.report_date,
                                 payload.row_id, payload.column_key)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ───────────────────────────────────────────── snapshots (spec §9)

class SnapshotIn(RunIn):
    status: str = "approved"


@router.post("/snapshots")
def freeze(payload: SnapshotIn, db: Session = Depends(get_db)):
    _ensure_tables(db)
    definition = _definition_for(db, payload)
    try:
        result = ME.run_report(db, definition, payload.report_date)
    except ValueError as e:
        raise HTTPException(400, str(e))
    rules = ME.load_rules(db)
    sid = db.execute(text(
        "INSERT INTO rs_matrix_snapshots (report_id, report_date, fy, status, "
        " result, definition, rules_used) "
        "VALUES (:r, :d, :fy, :st, CAST(:res AS jsonb), CAST(:def AS jsonb), "
        " CAST(:ru AS jsonb)) RETURNING snapshot_id"),
        {"r": payload.report_id, "d": payload.report_date, "fy": result["fy"],
         "st": payload.status, "res": json.dumps(result),
         "def": json.dumps(definition), "ru": json.dumps(rules)}).scalar()
    db.commit()
    return {"snapshot_id": sid, "fy": result["fy"]}


@router.get("/snapshots")
def list_snapshots(report_id: Optional[int] = None, db: Session = Depends(get_db)):
    _ensure_tables(db)
    where = "WHERE report_id = :r" if report_id else ""
    rows = db.execute(text(
        f"SELECT snapshot_id, report_id, report_date, fy, status, created_at "
        f"FROM rs_matrix_snapshots {where} ORDER BY created_at DESC LIMIT 100"),
        {"r": report_id} if report_id else {}).mappings().all()
    return {"snapshots": [dict(r) for r in rows]}


@router.get("/snapshots/{snapshot_id}")
def get_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    _ensure_tables(db)
    r = db.execute(text("SELECT * FROM rs_matrix_snapshots WHERE snapshot_id=:s"),
                   {"s": snapshot_id}).mappings().first()
    if not r:
        raise HTTPException(404, "Snapshot not found")
    return {**dict(r), "result": _jload(r["result"]),
            "definition": _jload(r["definition"]), "rules_used": _jload(r["rules_used"])}
