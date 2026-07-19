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


# ───────────────────────────────────────────── datasets (spec §5.1–5.2)

class DatasetIn(BaseModel):
    dataset_key: str
    name: str
    description: Optional[str] = None
    base_sql: str
    id_field: str = "scheme_id"
    name_field: str = "scheme_name"
    fields: list[dict]
    derived: list[dict] = []


def _ensure_config_tables(db: Session) -> None:
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_datasets ("
        " dataset_key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,"
        " base_sql TEXT NOT NULL, id_field TEXT NOT NULL DEFAULT 'scheme_id',"
        " name_field TEXT NOT NULL DEFAULT 'scheme_name', fields JSONB NOT NULL,"
        " derived JSONB NOT NULL DEFAULT '[]'::jsonb,"
        " is_active BOOLEAN NOT NULL DEFAULT TRUE,"
        " updated_by VARCHAR(100), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_measures ("
        " measure_key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,"
        " kind TEXT NOT NULL DEFAULT 'agg', field TEXT, agg TEXT,"
        " weight_field TEXT, expr TEXT, unit TEXT, decimals INTEGER DEFAULT 2,"
        " is_active BOOLEAN NOT NULL DEFAULT TRUE,"
        " updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.commit()


def _validate_dataset(db: Session, payload: DatasetIn, report_date: date) -> None:
    sql = payload.base_sql.strip().rstrip(";")
    if ";" in sql or not sql.lower().lstrip().startswith(("select", "with")):
        raise HTTPException(400, "base_sql must be a single SELECT/WITH statement")
    payload.base_sql = sql
    ctx = ME.period_context(report_date)
    try:
        rows = db.execute(text(f"SELECT * FROM ({sql}) q LIMIT 5"),
                          {"fy": ctx["fy"], "prev_fy": ctx["prev_fy"],
                           "report_date": report_date}).mappings().all()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"base_sql failed: {str(e)[:300]}")
    got = set(rows[0].keys()) if rows else None
    for f in payload.fields:
        if got is not None and f["key"] not in got:
            raise HTTPException(400, f"Field '{f['key']}' not returned by base_sql")
    # validate derived formulas against a sample record (spec §5.3)
    from app.services.formula_engine import validate_formula
    sample = {**ctx, **(dict(rows[0]) if rows else {f["key"]: None for f in payload.fields})}
    for f in payload.derived:
        err = validate_formula(f["expr"], sample)
        if err:
            raise HTTPException(400, f"Derived field '{f['key']}': {err}")
        sample[f["key"]] = None


@router.get("/datasets")
def list_datasets(db: Session = Depends(get_db)):
    _ensure_config_tables(db)
    rows = db.execute(text(
        "SELECT dataset_key, name, description, id_field, name_field, fields, "
        "derived, updated_at FROM rs_datasets WHERE is_active ORDER BY dataset_key"
    )).mappings().all()
    return {"datasets": [{**dict(r), "fields": _jload(r["fields"]),
                          "derived": _jload(r["derived"])} for r in rows]}


@router.post("/datasets")
def upsert_dataset(payload: DatasetIn, report_date: Optional[date] = None,
                   db: Session = Depends(get_db)):
    _ensure_config_tables(db)
    _validate_dataset(db, payload, report_date or date.today())
    db.execute(text("""
        INSERT INTO rs_datasets (dataset_key, name, description, base_sql,
                                 id_field, name_field, fields, derived)
        VALUES (:k, :n, :d, :sql, :idf, :nf, CAST(:f AS jsonb), CAST(:dv AS jsonb))
        ON CONFLICT (dataset_key) DO UPDATE SET
          name=EXCLUDED.name, description=EXCLUDED.description,
          base_sql=EXCLUDED.base_sql, id_field=EXCLUDED.id_field,
          name_field=EXCLUDED.name_field, fields=EXCLUDED.fields,
          derived=EXCLUDED.derived, is_active=TRUE, updated_at=now()
    """), {"k": payload.dataset_key, "n": payload.name, "d": payload.description,
           "sql": payload.base_sql, "idf": payload.id_field, "nf": payload.name_field,
           "f": json.dumps(payload.fields), "dv": json.dumps(payload.derived)})
    db.commit()
    return {"dataset_key": payload.dataset_key}


# ───────────────────────────────────────────── measures (spec §5.6)

class MeasureIn(BaseModel):
    measure_key: str
    name: str
    description: Optional[str] = None
    kind: str = "agg"                      # agg | formula
    field: Optional[str] = None
    agg: Optional[str] = None
    weight_field: Optional[str] = None
    expr: Optional[str] = None
    unit: Optional[str] = None
    decimals: int = 2


@router.get("/measures")
def list_measures(db: Session = Depends(get_db)):
    _ensure_config_tables(db)
    rows = db.execute(text(
        "SELECT * FROM rs_measures WHERE is_active ORDER BY measure_key")).mappings().all()
    return {"measures": [dict(r) for r in rows]}


@router.post("/measures")
def upsert_measure(payload: MeasureIn, db: Session = Depends(get_db)):
    _ensure_config_tables(db)
    if payload.kind == "agg":
        if not payload.field or not payload.agg:
            raise HTTPException(400, "agg measures need field and agg")
        if payload.agg == "weighted_avg" and not payload.weight_field:
            raise HTTPException(400, "weighted_avg needs weight_field")
    elif payload.kind == "formula":
        if not payload.expr:
            raise HTTPException(400, "formula measures need expr")
        from app.services.formula_engine import compile_formula, FormulaError
        try:
            compile_formula(payload.expr)   # syntax check; identifiers bind at run
        except FormulaError as e:
            raise HTTPException(400, f"Formula: {e}")
    else:
        raise HTTPException(400, "kind must be agg or formula")
    db.execute(text("""
        INSERT INTO rs_measures (measure_key, name, description, kind, field, agg,
                                 weight_field, expr, unit, decimals)
        VALUES (:k, :n, :d, :kind, :f, :a, :w, :e, :u, :dec)
        ON CONFLICT (measure_key) DO UPDATE SET
          name=EXCLUDED.name, description=EXCLUDED.description, kind=EXCLUDED.kind,
          field=EXCLUDED.field, agg=EXCLUDED.agg, weight_field=EXCLUDED.weight_field,
          expr=EXCLUDED.expr, unit=EXCLUDED.unit, decimals=EXCLUDED.decimals,
          is_active=TRUE, updated_at=now()
    """), {"k": payload.measure_key, "n": payload.name, "d": payload.description,
           "kind": payload.kind, "f": payload.field, "a": payload.agg,
           "w": payload.weight_field, "e": payload.expr, "u": payload.unit,
           "dec": payload.decimals})
    db.commit()
    return {"measure_key": payload.measure_key}


@router.delete("/measures/{measure_key}")
def delete_measure(measure_key: str, db: Session = Depends(get_db)):
    _ensure_config_tables(db)
    db.execute(text("UPDATE rs_measures SET is_active = FALSE WHERE measure_key=:k"),
               {"k": measure_key})
    db.commit()
    return {"ok": True}


# ───────────────────────────────────────────── Excel export (spec §14)

@router.post("/export/xlsx")
def export_xlsx(payload: RunIn, include_details: bool = True,
                db: Session = Depends(get_db)):
    from io import BytesIO
    from fastapi.responses import StreamingResponse
    from app.services.matrix_export import build_workbook
    _ensure_tables(db)
    definition = _definition_for(db, payload)
    name = "Matrix Report"
    if payload.report_id:
        name = db.execute(text("SELECT name FROM rs_matrix_reports WHERE report_id=:r"),
                          {"r": payload.report_id}).scalar() or name
    try:
        result = ME.run_report(db, definition, payload.report_date)
        pop = ME.fetch_population(db, payload.report_date,
                                  definition.get("dataset")) if include_details else None
    except ValueError as e:
        raise HTTPException(400, str(e))
    wb = build_workbook(result, name, pop)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"{name.replace(' ', '_')}_{payload.report_date.isoformat()}.xlsx"
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})
