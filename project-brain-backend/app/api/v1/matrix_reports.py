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
    v = db.execute(text("SELECT version FROM rs_rules WHERE rule_key=:k"),
                   {"k": payload.rule_key}).scalar()
    _ensure_gov_tables(db)
    _audit(db, "rule", payload.rule_key, "update" if existing is not None else "create",
           None, {"version": v, "condition": payload.condition})
    db.commit()
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
    _ensure_gov_tables(db)
    _audit(db, "snapshot", sid, "create", None,
           {"report_id": payload.report_id, "report_date": str(payload.report_date),
            "status": payload.status})
    db.commit()
    return {"snapshot_id": sid, "fy": result["fy"], "status": payload.status}


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


# ═════════════════════════════════════════════ M1 — Governance

_WORKFLOW = {  # legal transitions (spec §9)
    ("draft", "submit"): "submitted",
    ("submitted", "approve"): "approved",
    ("submitted", "reject"): "draft",
    ("approved", "lock"): "locked",
}
_MUTABLE_STATUSES = {"draft", "submitted"}   # adjustments allowed until approved


def _ensure_gov_tables(db: Session) -> None:
    for col, typ in (("submitted_by", "VARCHAR(100)"), ("submitted_at", "TIMESTAMPTZ"),
                     ("approved_by", "VARCHAR(100)"), ("approved_at", "TIMESTAMPTZ"),
                     ("locked_at", "TIMESTAMPTZ"), ("reject_reason", "TEXT")):
        db.execute(text(f"ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS {col} {typ}"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_adjustments ("
        " adjustment_id SERIAL PRIMARY KEY,"
        " snapshot_id INTEGER NOT NULL REFERENCES rs_matrix_snapshots(snapshot_id) ON DELETE CASCADE,"
        " row_id TEXT NOT NULL, column_key TEXT NOT NULL,"
        " calculated NUMERIC, adjustment NUMERIC NOT NULL, reason TEXT NOT NULL,"
        " attachment_ref TEXT, adjusted_by VARCHAR(100),"
        " status TEXT NOT NULL DEFAULT 'proposed',"
        " decided_by VARCHAR(100), decided_at TIMESTAMPTZ,"
        " created_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_audit_log ("
        " audit_id BIGSERIAL PRIMARY KEY, entity TEXT NOT NULL, entity_key TEXT NOT NULL,"
        " action TEXT NOT NULL, old_value JSONB, new_value JSONB, reason TEXT,"
        " actor VARCHAR(100), at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.commit()


def _audit(db: Session, entity: str, entity_key: str, action: str,
           old: Any = None, new: Any = None, reason: Optional[str] = None,
           actor: Optional[str] = None) -> None:
    db.execute(text(
        "INSERT INTO rs_audit_log (entity, entity_key, action, old_value, new_value, reason, actor) "
        "VALUES (:e, :k, :a, CAST(:o AS jsonb), CAST(:n AS jsonb), :r, :ac)"),
        {"e": entity, "k": str(entity_key), "a": action,
         "o": json.dumps(old, default=str) if old is not None else None,
         "n": json.dumps(new, default=str) if new is not None else None,
         "r": reason, "ac": actor})


class TransitionIn(BaseModel):
    action: str                              # submit|approve|reject|lock
    actor: Optional[str] = None
    reason: Optional[str] = None             # required for reject


@router.post("/snapshots/{snapshot_id}/transition")
def transition_snapshot(snapshot_id: int, payload: TransitionIn,
                        db: Session = Depends(get_db)):
    _ensure_tables(db)
    _ensure_gov_tables(db)
    cur = db.execute(text("SELECT status FROM rs_matrix_snapshots WHERE snapshot_id=:s"),
                     {"s": snapshot_id}).scalar()
    if cur is None:
        raise HTTPException(404, "Snapshot not found")
    nxt = _WORKFLOW.get((cur, payload.action))
    if nxt is None:
        legal = [a for (st, a) in _WORKFLOW if st == cur]
        raise HTTPException(400, f"Illegal transition '{payload.action}' from '{cur}'"
                                 f" (legal: {legal or 'none — terminal state'})")
    if payload.action == "reject" and not payload.reason:
        raise HTTPException(400, "Rejection requires a reason")
    stamp = {"submit": "submitted_by=:a, submitted_at=now()",
             "approve": "approved_by=:a, approved_at=now()",
             "reject": "reject_reason=:r",
             "lock": "locked_at=now()"}[payload.action]
    db.execute(text(f"UPDATE rs_matrix_snapshots SET status=:st, {stamp} WHERE snapshot_id=:s"),
               {"st": nxt, "s": snapshot_id, "a": payload.actor, "r": payload.reason})
    _audit(db, "snapshot", snapshot_id, payload.action, {"status": cur},
           {"status": nxt}, payload.reason, payload.actor)
    db.commit()
    return {"snapshot_id": snapshot_id, "status": nxt}


# ---- manual adjustments (§10): calculated value never overwritten ----

class AdjustmentIn(BaseModel):
    row_id: str
    column_key: str
    adjustment: float
    reason: str
    attachment_ref: Optional[str] = None
    adjusted_by: Optional[str] = None


class DecideIn(BaseModel):
    decision: str                            # approve|reject|reverse
    decided_by: Optional[str] = None


def _snapshot_cell(snap_result: dict, row_id: str, column_key: str):
    row = next((r for r in snap_result["rows"] if r["id"] == row_id), None)
    if row is None or column_key not in row["cells"]:
        raise HTTPException(400, f"Cell ('{row_id}', '{column_key}') not in snapshot")
    return row["cells"][column_key]


@router.post("/snapshots/{snapshot_id}/adjustments")
def propose_adjustment(snapshot_id: int, payload: AdjustmentIn,
                       db: Session = Depends(get_db)):
    _ensure_tables(db)
    _ensure_gov_tables(db)
    snap = db.execute(text(
        "SELECT status, result FROM rs_matrix_snapshots WHERE snapshot_id=:s"),
        {"s": snapshot_id}).mappings().first()
    if not snap:
        raise HTTPException(404, "Snapshot not found")
    if snap["status"] not in _MUTABLE_STATUSES:
        raise HTTPException(400, f"Snapshot is '{snap['status']}' — adjustments are "
                                 "only allowed while draft/submitted")
    if not payload.reason.strip():
        raise HTTPException(400, "Adjustment reason is mandatory")
    calc = _snapshot_cell(_jload(snap["result"]), payload.row_id, payload.column_key)
    aid = db.execute(text("""
        INSERT INTO rs_adjustments (snapshot_id, row_id, column_key, calculated,
                                    adjustment, reason, attachment_ref, adjusted_by)
        VALUES (:s, :r, :c, :calc, :adj, :re, :att, :by) RETURNING adjustment_id
    """), {"s": snapshot_id, "r": payload.row_id, "c": payload.column_key,
           "calc": calc, "adj": payload.adjustment, "re": payload.reason,
           "att": payload.attachment_ref, "by": payload.adjusted_by}).scalar()
    _audit(db, "adjustment", aid, "adjust", None,
           {"snapshot_id": snapshot_id, "cell": [payload.row_id, payload.column_key],
            "calculated": calc, "adjustment": payload.adjustment},
           payload.reason, payload.adjusted_by)
    db.commit()
    return {"adjustment_id": aid, "calculated": calc,
            "final_if_approved": (calc or 0) + payload.adjustment}


@router.post("/adjustments/{adjustment_id}/decide")
def decide_adjustment(adjustment_id: int, payload: DecideIn,
                      db: Session = Depends(get_db)):
    _ensure_gov_tables(db)
    row = db.execute(text("SELECT status FROM rs_adjustments WHERE adjustment_id=:a"),
                     {"a": adjustment_id}).scalar()
    if row is None:
        raise HTTPException(404, "Adjustment not found")
    legal = {"proposed": {"approve": "approved", "reject": "rejected"},
             "approved": {"reverse": "reversed"}}
    nxt = legal.get(row, {}).get(payload.decision)
    if nxt is None:
        raise HTTPException(400, f"Illegal decision '{payload.decision}' from '{row}'")
    db.execute(text(
        "UPDATE rs_adjustments SET status=:st, decided_by=:by, decided_at=now() "
        "WHERE adjustment_id=:a"),
        {"st": nxt, "by": payload.decided_by, "a": adjustment_id})
    _audit(db, "adjustment", adjustment_id, payload.decision,
           {"status": row}, {"status": nxt}, None, payload.decided_by)
    db.commit()
    return {"adjustment_id": adjustment_id, "status": nxt}


@router.get("/snapshots/{snapshot_id}/final")
def snapshot_final(snapshot_id: int, db: Session = Depends(get_db)):
    """Grid with Calculated / Adjustment / Final per adjusted cell —
    the calculated value is never overwritten (spec §10 display rule)."""
    _ensure_tables(db)
    _ensure_gov_tables(db)
    snap = db.execute(text(
        "SELECT status, result FROM rs_matrix_snapshots WHERE snapshot_id=:s"),
        {"s": snapshot_id}).mappings().first()
    if not snap:
        raise HTTPException(404, "Snapshot not found")
    result = _jload(snap["result"])
    adjs = db.execute(text(
        "SELECT * FROM rs_adjustments WHERE snapshot_id=:s AND status='approved'"),
        {"s": snapshot_id}).mappings().all()
    by_cell: dict[tuple, dict] = {}
    for a in adjs:
        by_cell[(a["row_id"], a["column_key"])] = dict(a)
    out_rows = []
    for r in result["rows"]:
        cells = {}
        for k, calc in r["cells"].items():
            a = by_cell.get((r["id"], k))
            if a:
                adj = float(a["adjustment"])
                cells[k] = {"calculated": calc, "adjustment": adj,
                            "final": (calc or 0) + adj, "reason": a["reason"],
                            "adjusted_by": a["adjusted_by"]}
            else:
                cells[k] = {"calculated": calc, "adjustment": None, "final": calc}
        out_rows.append({**r, "cells": cells})
    return {"snapshot_id": snapshot_id, "status": snap["status"],
            "report_date": result["report_date"], "fy": result["fy"],
            "columns": result["columns"], "rows": out_rows,
            "adjustment_count": len(adjs)}


@router.get("/audit")
def audit_log(entity: Optional[str] = None, entity_key: Optional[str] = None,
              limit: int = 100, db: Session = Depends(get_db)):
    _ensure_gov_tables(db)
    where, params = [], {"lim": min(limit, 500)}
    if entity:
        where.append("entity = :e"); params["e"] = entity
    if entity_key:
        where.append("entity_key = :k"); params["k"] = entity_key
    w = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(text(
        f"SELECT * FROM rs_audit_log {w} ORDER BY at DESC LIMIT :lim"), params).mappings().all()
    return {"audit": [{**dict(r), "old_value": _jload(r["old_value"]),
                       "new_value": _jload(r["new_value"])} for r in rows]}


# ═════════════════════════════════════════════ M2 — Trust

from app.services import matrix_trust as MT


@router.get("/dq")
def data_quality(report_date: date, dataset_key: Optional[str] = None,
                 db: Session = Depends(get_db)):
    """Spec §11 pre-flight: every active check with drillable violations."""
    _ensure_tables(db)
    try:
        return MT.run_dq(db, report_date, dataset_key)
    except ValueError as e:
        raise HTTPException(400, str(e))


class DQCheckIn(BaseModel):
    check_key: str
    name: str
    description: Optional[str] = None
    dataset_key: str = "schemes"
    severity: str = "warning"
    expr: str


@router.post("/dq/checks")
def upsert_dq_check(payload: DQCheckIn, report_date: Optional[date] = None,
                    db: Session = Depends(get_db)):
    _ensure_tables(db)
    if payload.severity not in ("warning", "error"):
        raise HTTPException(400, "severity must be warning or error")
    # validate the expression against a sample record before saving (spec §5.3)
    pop = ME.fetch_population(db, report_date or date.today(), payload.dataset_key)
    from app.services.formula_engine import validate_formula
    sample = {**ME.period_context(report_date or date.today()),
              **(pop[0] if pop else {})}
    err = validate_formula(payload.expr, sample)
    if err:
        raise HTTPException(400, f"Check expression: {err}")
    db.execute(text("""
        INSERT INTO rs_dq_checks (check_key, name, description, dataset_key, severity, expr)
        VALUES (:k, :n, :d, :ds, :s, :e)
        ON CONFLICT (check_key) DO UPDATE SET name=EXCLUDED.name,
          description=EXCLUDED.description, dataset_key=EXCLUDED.dataset_key,
          severity=EXCLUDED.severity, expr=EXCLUDED.expr, is_active=TRUE,
          updated_at=now()
    """), {"k": payload.check_key, "n": payload.name, "d": payload.description,
           "ds": payload.dataset_key, "s": payload.severity, "e": payload.expr})
    _ensure_gov_tables(db)
    _audit(db, "dq_check", payload.check_key, "update", None,
           {"severity": payload.severity, "expr": payload.expr})
    db.commit()
    return {"check_key": payload.check_key}


# freeze now gates on error-severity DQ violations (override audited)

class SnapshotIn2(SnapshotIn):
    override_dq: bool = False
    override_reason: Optional[str] = None
    actor: Optional[str] = None


@router.post("/snapshots/gated")
def freeze_gated(payload: SnapshotIn2, db: Session = Depends(get_db)):
    """DQ-gated freeze: error violations block unless explicitly (and
    auditably) overridden. Snapshots store per-row scheme_ids for compare."""
    _ensure_tables(db)
    _ensure_gov_tables(db)
    definition = _definition_for(db, payload)
    dq = MT.run_dq(db, payload.report_date, definition.get("dataset"))
    if not dq["freeze_allowed"] and not payload.override_dq:
        raise HTTPException(409, f"{dq['error_violations']} error-severity data-quality "
                                 "violation(s) — fix them or freeze with override_dq=true "
                                 "and an override_reason")
    if not dq["freeze_allowed"] and payload.override_dq and not payload.override_reason:
        raise HTTPException(400, "override_reason is mandatory when overriding DQ errors")
    try:
        result = ME.run_report(db, definition, payload.report_date, include_ids=True)
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
    _audit(db, "snapshot", sid, "create",
           None, {"report_id": payload.report_id, "status": payload.status,
                  "dq_errors": dq["error_violations"],
                  "dq_overridden": bool(payload.override_dq and not dq["freeze_allowed"])},
           payload.override_reason, payload.actor)
    db.commit()
    return {"snapshot_id": sid, "fy": result["fy"], "status": payload.status,
            "dq": {"errors": dq["error_violations"], "warnings": dq["warning_violations"],
                   "overridden": bool(payload.override_dq and not dq["freeze_allowed"])}}


class CompareIn(BaseModel):
    snapshot_id: int
    against_snapshot_id: Optional[int] = None   # None = live at the same position date


@router.post("/compare")
def compare_snapshots(payload: CompareIn, db: Session = Depends(get_db)):
    """Snapshot vs live (same position date) or vs another snapshot — cell
    deltas, which records entered/left each row, and rule-version changes."""
    _ensure_tables(db)
    base = db.execute(text(
        "SELECT report_date, result, definition, rules_used FROM rs_matrix_snapshots "
        "WHERE snapshot_id=:s"), {"s": payload.snapshot_id}).mappings().first()
    if not base:
        raise HTTPException(404, "Snapshot not found")
    base_result = _jload(base["result"])
    base_rules = _jload(base["rules_used"])
    if payload.against_snapshot_id:
        other = db.execute(text(
            "SELECT result, rules_used FROM rs_matrix_snapshots WHERE snapshot_id=:s"),
            {"s": payload.against_snapshot_id}).mappings().first()
        if not other:
            raise HTTPException(404, "Comparison snapshot not found")
        other_result, other_rules = _jload(other["result"]), _jload(other["rules_used"])
        other_label = f"snapshot #{payload.against_snapshot_id}"
    else:
        try:
            other_result = ME.run_report(db, _jload(base["definition"]),
                                         base["report_date"], include_ids=True)
        except ValueError as e:
            raise HTTPException(400, str(e))
        other_rules = ME.load_rules(db)
        other_label = "live"
    return MT.compare(base_result, other_result, base_rules, other_rules,
                      f"snapshot #{payload.snapshot_id}", other_label)


# ═════════════════════════════════════════════ M3 — Productivity

import uuid as _uuid


class TemplateIn(BaseModel):
    template_key: str
    name: str
    description: Optional[str] = None
    rows: list[dict]


def _ensure_m3_tables(db: Session) -> None:
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_section_templates ("
        " template_key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,"
        " rows JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.commit()


def _strip_ids(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        c = {k: v for k, v in r.items() if k != "id"}
        if c.get("children"):
            c["children"] = _strip_ids(c["children"])
        out.append(c)
    return out


def _assign_ids(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        c = dict(r)
        c["id"] = _uuid.uuid4().hex[:8]
        if c.get("children"):
            c["children"] = _assign_ids(c["children"])
        out.append(c)
    return out


@router.get("/templates")
def list_templates(db: Session = Depends(get_db)):
    _ensure_m3_tables(db)
    rows = db.execute(text(
        "SELECT template_key, name, description, rows, updated_at "
        "FROM rs_section_templates ORDER BY template_key")).mappings().all()
    return {"templates": [{**dict(r), "rows": _jload(r["rows"])} for r in rows]}


@router.post("/templates")
def save_template(payload: TemplateIn, db: Session = Depends(get_db)):
    """Save a row subtree as a reusable section (ids stripped — assigned fresh
    on every instantiation so the same template can appear many times)."""
    _ensure_m3_tables(db)
    rows = _strip_ids(payload.rows)
    db.execute(text("""
        INSERT INTO rs_section_templates (template_key, name, description, rows)
        VALUES (:k, :n, :d, CAST(:r AS jsonb))
        ON CONFLICT (template_key) DO UPDATE SET name=EXCLUDED.name,
          description=EXCLUDED.description, rows=EXCLUDED.rows, updated_at=now()
    """), {"k": payload.template_key, "n": payload.name,
           "d": payload.description, "r": json.dumps(rows)})
    _ensure_gov_tables(db)
    _audit(db, "template", payload.template_key, "update", None, {"rows": rows})
    db.commit()
    return {"template_key": payload.template_key}


@router.post("/templates/{template_key}/instantiate")
def instantiate_template(template_key: str, db: Session = Depends(get_db)):
    """Fresh-id copy of the template subtree, ready to graft under any parent.
    Parent rule inheritance is automatic — the engine compounds ancestor rules."""
    _ensure_m3_tables(db)
    rows = db.execute(text(
        "SELECT rows FROM rs_section_templates WHERE template_key=:k"),
        {"k": template_key}).scalar()
    if rows is None:
        raise HTTPException(404, "Template not found")
    return {"rows": _assign_ids(_jload(rows))}


@router.post("/reports/{report_id}/clone")
def clone_report(report_id: int, db: Session = Depends(get_db)):
    _ensure_tables(db)
    src = db.execute(text(
        "SELECT name, description, definition FROM rs_matrix_reports WHERE report_id=:r"),
        {"r": report_id}).mappings().first()
    if not src:
        raise HTTPException(404, "Report not found")
    rid = db.execute(text(
        "INSERT INTO rs_matrix_reports (name, description, definition) "
        "VALUES (:n, :d, CAST(:def AS jsonb)) RETURNING report_id"),
        {"n": f"{src['name']} (copy)", "d": src["description"],
         "def": json.dumps(_jload(src["definition"]))}).scalar()
    _ensure_gov_tables(db)
    _audit(db, "report", rid, "create", None, {"cloned_from": report_id})
    db.commit()
    return {"report_id": rid, "name": f"{src['name']} (copy)"}


# ═════════════════════════════════════════════ M4 — AI assist (spec §18)

from app.services import matrix_ai as MA


class DraftRuleIn(BaseModel):
    prompt: str
    report_date: date
    dataset_key: Optional[str] = None


@router.post("/ai/draft-rule")
def ai_draft_rule(payload: DraftRuleIn, db: Session = Depends(get_db)):
    """NL → draft condition. LLM (if configured) then deterministic parser;
    either way the draft is compiled + previewed by the ENGINE before return.
    Nothing is saved — the user reviews, previews, edits, then saves/versions."""
    _ensure_tables(db)
    dataset = ME.load_dataset(db, payload.dataset_key)
    semantic = ME.dataset_semantic_fields(dataset)
    draft = MA.maybe_llm_draft(payload.prompt, semantic)
    if draft is None:
        try:
            draft = MA.draft_rule_from_text(payload.prompt, semantic)
        except ValueError as e:
            raise HTTPException(400, str(e))
    # deterministic gate: compile + preview exactly like a hand-written rule
    count = _validate_condition(db, draft["condition"], payload.report_date)
    rules = ME.load_rules(db)
    return {**draft,
            "matching_count": count,
            "english": MA.explain_condition(draft["condition"], rules, semantic)}


class ExplainCellIn(CellIn):
    pass


@router.post("/ai/explain-cell")
def ai_explain_cell(payload: ExplainCellIn, db: Session = Depends(get_db)):
    _ensure_tables(db)
    definition = _definition_for(db, payload)
    try:
        drill = ME.cell_drilldown(db, definition, payload.report_date,
                                  payload.row_id, payload.column_key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    dataset = ME.load_dataset(db, definition.get("dataset"))
    semantic = ME.dataset_semantic_fields(dataset)
    rules = ME.load_rules(db)
    return {"explanation": MA.explain_cell(drill, rules, semantic), "drill": drill}


class NarrateIn(CompareIn):
    pass


@router.post("/ai/why-changed")
def ai_why_changed(payload: NarrateIn, db: Session = Depends(get_db)):
    """M2 compare rendered as review-meeting sentences."""
    cmp = compare_snapshots(payload, db)
    base = db.execute(text(
        "SELECT result FROM rs_matrix_snapshots WHERE snapshot_id=:s"),
        {"s": payload.snapshot_id}).scalar()
    cols = _jload(base)["columns"] if base else []
    return {"narrative": MA.narrate_comparison(cmp, cols), "compare": cmp}


@router.post("/ai/report-from-xlsx")
def ai_report_from_xlsx(payload: dict, db: Session = Depends(get_db)):
    """{path: server-side xlsx path} → draft report definition. (The web UI
    uploads through the standard upload endpoint and passes the stored path.)"""
    _ensure_tables(db)
    path = payload.get("path")
    if not path:
        raise HTTPException(400, "path required")
    rules = ME.load_rules(db)
    measures = ME.load_measures(db)
    try:
        return MA.report_skeleton_from_xlsx(
            path,
            {k: v["name"] for k, v in rules.items()},
            {k: m["name"] for k, m in measures.items()})
    except Exception as e:
        raise HTTPException(400, f"Parse failed: {str(e)[:300]}")
