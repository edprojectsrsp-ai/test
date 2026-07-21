"""Matrix Engine — metadata-driven enterprise report calculator.

Implements the core of the Report Studio requirement spec: every report cell =
a MEASURE applied to the POPULATION of schemes satisfying the row's EFFECTIVE
RULE (own rule AND all inherited parent rules) for a REPORTING PERIOD.

Design decisions (per spec §15/§16 — no SQL-per-cell):
  · The scheme population is loaded ONCE per run with all semantic fields
    (one SQL over scheme_master + CAPEX aggregates), then every rule is
    evaluated in-process against each record. One scan → every row/cell.
  · Because the engine knows exactly which scheme_ids qualify for each row,
    drill-down and reconciliation are free, not bolted on.
  · Rules are JSON condition trees: {op: AND|OR|NOT, conditions: [...]}
    where a condition is {field, op, value} or {rule: "<key>"} (reusable rule
    reference, cycle-detected) or a nested group.
  · Reporting-period awareness: values may be tokens ({"token": "fy_start"})
    resolved against the selected report date — the same report re-runs for
    any month or FY without edits (spec §7).
  · Applicable-date/cost priority (spec §8): derived fields implement
    "revised completion date else planned", "sanctioned cost else estimated".
  · Snapshots (spec §9): a frozen run stores the grid, the definition, the
    verbatim rules used and the period — later data changes never touch it.

Field types: text, number, date, bool. Derived fields are computed per record
after the SQL fetch so rules can use them like stored columns.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import text

from app.services.formula_engine import (FormulaError, evaluate as feval,
                                         identifiers as fidents,
                                         median as _median, validate_formula)


# ─────────────────────────────────────────────── reporting-period context

def fy_start_year_of(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def period_context(report_date: date) -> dict[str, Any]:
    fy_start_year = fy_start_year_of(report_date)
    return {
        "report_date": report_date,
        "fy": f"{fy_start_year}-{str(fy_start_year + 1)[2:]}",
        "prev_fy": f"{fy_start_year - 1}-{str(fy_start_year)[2:]}",
        "fy_start": date(fy_start_year, 4, 1),
        "fy_end": date(fy_start_year + 1, 3, 31),
        "prev_fy_start": date(fy_start_year - 1, 4, 1),
        "prev_fy_end": date(fy_start_year, 3, 31),
        "one_year_before_report": report_date - timedelta(days=365),
    }


def resolve_value(value: Any, ctx: dict[str, Any]) -> Any:
    """{"token": "fy_start"} → the actual date for this reporting period."""
    if isinstance(value, dict) and "token" in value:
        tok = value["token"]
        if tok not in ctx:
            raise ValueError(f"Unknown period token '{tok}'")
        return ctx[tok]
    if isinstance(value, list):
        return [resolve_value(v, ctx) for v in value]
    return value


# ─────────────────────────────────────────────── population (one SQL + derive)

# Semantic layer: business field → how it is sourced.
SEMANTIC_FIELDS: dict[str, dict[str, str]] = {
    "scheme_id":            {"label": "Scheme ID", "type": "number"},
    "scheme_name":          {"label": "Scheme Name", "type": "text"},
    "scheme_code":          {"label": "Scheme Code", "type": "text"},
    "scheme_type":          {"label": "Scheme Category (corporate/plant)", "type": "text"},
    "current_status":       {"label": "Lifecycle Status", "type": "text"},
    "estimated_cost":       {"label": "Estimated Cost (Cr)", "type": "number"},
    "sanctioned_cost":      {"label": "Sanctioned Cost (Cr)", "type": "number"},
    "anticipated_cost":     {"label": "Anticipated Cost (Cr)", "type": "number"},
    "planned_start":        {"label": "Planned Start", "type": "date"},
    "actual_start":         {"label": "Actual Start", "type": "date"},
    "planned_completion":   {"label": "Original Completion Date", "type": "date"},
    "revised_completion":   {"label": "Approved Revised Completion", "type": "date"},
    "actual_completion":    {"label": "Actual Completion", "type": "date"},
    # financial (FY-sensitive aggregates from CAPEX tables)
    "exp_prev_fy":          {"label": "Expenditure up to Previous FY (Cr)", "type": "number"},
    "be_fy":                {"label": "BE for Selected FY (Cr)", "type": "number"},
    "exp_fy":               {"label": "Expenditure in Selected FY (Cr)", "type": "number"},
    "total_exp":            {"label": "Total Expenditure (Cr)", "type": "number"},
    # derived (spec §8 priority logic + §5.4 classification inputs)
    "applicable_completion": {"label": "Applicable Completion (revised else original)", "type": "date"},
    "applicable_cost":       {"label": "Applicable Cost (sanctioned else estimated)", "type": "number"},
    "effective_start":       {"label": "Effective Start (actual else planned)", "type": "date"},
    "delay_days":            {"label": "Delay Days at Reporting Date", "type": "number"},
}


DEFAULT_DATASET_KEY = "schemes"


def load_dataset(db, dataset_key: Optional[str] = None) -> Optional[dict[str, Any]]:
    """User-configured dataset (rs_datasets): base SQL + fields + derived-field
    formulas. Returns None when the table/row is absent (built-in fallback)."""
    try:
        row = db.execute(text(
            "SELECT dataset_key, name, base_sql, fields, derived FROM rs_datasets "
            "WHERE dataset_key = :k AND is_active"),
            {"k": dataset_key or DEFAULT_DATASET_KEY}).mappings().first()
    except Exception:
        db.rollback()
        return None
    if not row:
        return None
    out = dict(row)
    for k in ("fields", "derived"):
        if isinstance(out[k], str):
            out[k] = json.loads(out[k])
    return out


def dataset_semantic_fields(dataset: Optional[dict]) -> dict[str, dict[str, str]]:
    """Field registry for a configured dataset (falls back to built-in seed)."""
    if not dataset:
        return SEMANTIC_FIELDS
    reg: dict[str, dict[str, str]] = {}
    for f in dataset["fields"]:
        reg[f["key"]] = {"label": f.get("label", f["key"]), "type": f.get("type", "text")}
    for f in dataset.get("derived") or []:
        reg[f["key"]] = {"label": f.get("label", f["key"]), "type": f.get("type", "number")}
    return reg


def fetch_population_configured(db, dataset: dict, report_date: date) -> list[dict[str, Any]]:
    """Run the configured base SQL (:fy / :report_date params available), then
    evaluate derived-field formulas per record in declaration order — later
    derived fields may reference earlier ones (spec §5.3/§8, pure config)."""
    ctx = period_context(report_date)
    rows = db.execute(text(dataset["base_sql"]),
                      {"fy": ctx["fy"], "prev_fy": ctx["prev_fy"],
                       "report_date": report_date}).mappings().all()
    fields = dataset["fields"]
    derived = dataset.get("derived") or []
    tok_ctx = {k: v for k, v in ctx.items()}
    population = []
    for r in rows:
        rec: dict[str, Any] = dict(r)
        for f in fields:
            if f.get("type") == "number" and rec.get(f["key"]) is not None:
                rec[f["key"]] = float(rec[f["key"]])
        env = {**tok_ctx, **rec}
        for f in derived:
            try:
                val = feval(f["expr"], env)
            except FormulaError as e:
                raise ValueError(f"Derived field '{f['key']}': {e}")
            if f.get("type") == "number" and val is not None:
                val = float(val)
            rec[f["key"]] = val
            env[f["key"]] = val
        population.append(rec)
    return population


def load_row_scopes(db, user: Optional[dict]) -> Optional[dict[str, set]]:
    """Effective allow-lists for a user: {dimension -> {values}}. None = no
    restriction (unrestricted). admin always unrestricted. A principal with no
    scope rows is unrestricted (back-compat)."""
    if not user or user.get("role") == "admin":
        return None
    try:
        rows = db.execute(text(
            "SELECT dimension, value FROM rs_row_scopes "
            "WHERE role = :role OR user_id = :uid"),
            {"role": user.get("role"), "uid": user.get("user_id")}).mappings().all()
    except Exception:
        db.rollback()
        return None
    if not rows:
        return None
    scopes: dict[str, set] = {}
    for r in rows:
        scopes.setdefault(r["dimension"], set()).add(r["value"])
    return scopes


# dimension -> record field used to test membership
_SCOPE_FIELD = {"scheme_type": "scheme_type", "department": "department",
                "plant": "plant", "scheme_id": "scheme_id"}


def apply_row_scopes(population: list[dict], scopes: Optional[dict[str, set]]
                     ) -> list[dict]:
    """Keep only records permitted by EVERY restricted dimension (AND across
    dimensions, OR within a dimension's values)."""
    if not scopes:
        return population
    out = []
    for rec in population:
        ok = True
        for dim, allowed in scopes.items():
            field = _SCOPE_FIELD.get(dim, dim)
            val = rec.get(field)
            if val is None:
                ok = False
                break
            # normalise numeric ids (104.0 -> "104") so text scope values match
            sval = str(int(val)) if isinstance(val, float) and val.is_integer() else str(val)
            if sval not in allowed:
                ok = False
                break
        if ok:
            out.append(rec)
    return out


def _dataset_fingerprint(dataset: Optional[dict]) -> str:
    """Stable hash of the config that determines the population shape/values."""
    if not dataset:
        return "builtin_v1"
    blob = json.dumps({"sql": dataset.get("base_sql"),
                       "fields": dataset.get("fields"),
                       "derived": dataset.get("derived")},
                      sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _cache_get(db, dataset_key: str, report_date: date, fp: str):
    try:
        row = db.execute(text(
            "UPDATE rs_population_cache SET hits = hits + 1 "
            "WHERE dataset_key = :d AND report_date = :dt AND fingerprint = :fp "
            "RETURNING population"),
            {"d": dataset_key, "dt": report_date, "fp": fp}).scalar()
        db.commit()
    except Exception:
        db.rollback()
        return None
    if row is None:
        return None
    pop = json.loads(row) if isinstance(row, str) else row
    # revive dates (JSON stored them as ISO strings)
    for rec in pop:
        for k, v in rec.items():
            if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
                try:
                    rec[k] = date.fromisoformat(v)
                except ValueError:
                    pass
    return pop


def _cache_put(db, dataset_key: str, report_date: date, fp: str,
               population: list[dict]) -> None:
    try:
        db.execute(text(
            "INSERT INTO rs_population_cache "
            " (dataset_key, report_date, fingerprint, population, row_count) "
            "VALUES (:d, :dt, :fp, CAST(:p AS jsonb), :n) "
            "ON CONFLICT (dataset_key, report_date, fingerprint) "
            "DO UPDATE SET population = EXCLUDED.population, "
            " row_count = EXCLUDED.row_count, built_at = now(), hits = 0"),
            {"d": dataset_key, "dt": report_date, "fp": fp,
             "p": json.dumps(population, default=str), "n": len(population)})
        db.commit()
    except Exception:
        db.rollback()


def invalidate_population_cache(db, dataset_key: Optional[str] = None) -> int:
    try:
        if dataset_key:
            n = db.execute(text("DELETE FROM rs_population_cache WHERE dataset_key = :d"),
                           {"d": dataset_key}).rowcount
        else:
            n = db.execute(text("DELETE FROM rs_population_cache")).rowcount
        db.commit()
        return n or 0
    except Exception:
        db.rollback()
        return 0


def fetch_population(db, report_date: date, dataset_key: Optional[str] = None,
                     user: Optional[dict] = None, use_cache: bool = True
                     ) -> list[dict[str, Any]]:
    """Configured dataset when one exists; built-in scheme dataset otherwise."""
    dataset = load_dataset(db, dataset_key)
    scopes = load_row_scopes(db, user)
    dkey = (dataset or {}).get("dataset_key", DEFAULT_DATASET_KEY)
    fp = _dataset_fingerprint(dataset)

    if use_cache:
        cached = _cache_get(db, dkey, report_date, fp)
        if cached is not None:
            return apply_row_scopes(cached, scopes)

    if dataset:
        raw = fetch_population_configured(db, dataset, report_date)
        if use_cache:
            _cache_put(db, dkey, report_date, fp, raw)
        return apply_row_scopes(raw, scopes)
    ctx = period_context(report_date)
    rows = db.execute(text("""
        WITH be AS (
          SELECT r.scheme_id, SUM(cmv.be_amount) AS be_fy
          FROM capex_month_values cmv
          JOIN capex_plan_rows r ON r.id = cmv.plan_row_id
          JOIN capex_plan_header h ON h.id = r.plan_id
          WHERE h.fy_year = :fy AND h.plan_type = 'BE'
            AND (h.is_effective = 1 OR NOT EXISTS
                 (SELECT 1 FROM capex_plan_header h2
                  WHERE h2.fy_year = :fy AND h2.plan_type = 'BE' AND h2.is_effective = 1))
          GROUP BY r.scheme_id),
        prev_exp AS (
          SELECT r.scheme_id, SUM(v.cumulative_exp_till_last_fy) AS exp_prev_fy
          FROM capex_plan_rows r
          JOIN capex_plan_header h ON h.id = r.plan_id
          LEFT JOIN capex_plan_values v ON v.plan_row_id = r.id
          WHERE h.fy_year = :fy
          GROUP BY r.scheme_id),
        fy_exp AS (
          SELECT r.scheme_id, SUM(a.amount) AS exp_fy
          FROM capex_actuals a
          JOIN capex_plan_rows r ON r.id = a.plan_row_id
          WHERE a.fy_year = :fy
          GROUP BY r.scheme_id)
        SELECT s.scheme_id, s.scheme_name, s.scheme_code, s.scheme_type,
               s.current_status,
               s.estimated_cost_cr  AS estimated_cost,
               s.sanctioned_cost_cr AS sanctioned_cost,
               s.anticipated_cost_cr AS anticipated_cost,
               s.planned_start_date AS planned_start,
               s.actual_start_date  AS actual_start,
               s.planned_completion_date AS planned_completion,
               NULLIF(s.extra_fields->>'revised_completion_date', '')::date AS revised_completion,
               s.actual_completion_date AS actual_completion,
               COALESCE(p.exp_prev_fy, 0) AS exp_prev_fy,
               COALESCE(b.be_fy, 0)       AS be_fy,
               COALESCE(f.exp_fy, 0)      AS exp_fy
        FROM scheme_master s
        LEFT JOIN be b ON b.scheme_id = s.scheme_id
        LEFT JOIN prev_exp p ON p.scheme_id = s.scheme_id
        LEFT JOIN fy_exp f ON f.scheme_id = s.scheme_id
        WHERE NOT COALESCE(s.is_deleted, FALSE)
        ORDER BY s.scheme_id
    """), {"fy": ctx["fy"]}).mappings().all()

    population = []
    for r in rows:
        rec: dict[str, Any] = dict(r)
        for k in ("estimated_cost", "sanctioned_cost", "anticipated_cost",
                  "exp_prev_fy", "be_fy", "exp_fy"):
            rec[k] = float(rec[k]) if rec[k] is not None else None
        rec["total_exp"] = (rec["exp_prev_fy"] or 0.0) + (rec["exp_fy"] or 0.0)
        # spec §8 — configurable priority (default chains)
        rec["applicable_completion"] = rec["revised_completion"] or rec["planned_completion"]
        rec["applicable_cost"] = rec["sanctioned_cost"] if rec["sanctioned_cost"] not in (None, 0) \
            else rec["estimated_cost"]
        rec["effective_start"] = rec["actual_start"] or rec["planned_start"]
        ac = rec["applicable_completion"]
        rec["delay_days"] = float((report_date - ac).days) if (ac and report_date > ac
                                                              and not rec["actual_completion"]) else 0.0
        population.append(rec)
    if use_cache:
        _cache_put(db, dkey, report_date, fp, population)
    return apply_row_scopes(population, scopes)


# ─────────────────────────────────────────────── rule evaluation

_TEXT_OPS = {"=", "!=", "contains", "not_contains", "starts_with", "ends_with",
             "in", "not_in", "is_null", "not_null"}
_CMP_OPS = {"=", "!=", ">", ">=", "<", "<=", "between", "not_between",
            "in", "not_in", "is_null", "not_null"}


def _coerce_date(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return v
    if isinstance(v, datetime):
        return v.date()
    return v


def eval_condition(rec: dict, cond: dict, ctx: dict, rules: dict[str, dict],
                   stack: tuple = (), semantic: Optional[dict] = None) -> bool:
    """Evaluate one condition node against one record."""
    semantic = semantic or SEMANTIC_FIELDS
    # reusable rule reference
    if "rule" in cond:
        key = cond["rule"]
        if key in stack:
            raise ValueError(f"Circular rule reference: {' -> '.join(stack + (key,))}")
        rule = rules.get(key)
        if rule is None:
            raise ValueError(f"Unknown rule '{key}'")
        return eval_group(rec, rule["condition"], ctx, rules, stack + (key,), semantic)
    # nested group
    if "op" in cond and "conditions" in cond:
        return eval_group(rec, cond, ctx, rules, stack, semantic)

    field, op = cond.get("field"), cond.get("op")
    if field not in semantic:
        raise ValueError(f"Unknown field '{field}'")
    val = rec.get(field)
    want = resolve_value(cond.get("value"), ctx)
    ftype = semantic[field]["type"]

    if op == "is_null":
        return val is None or val == ""
    if op == "not_null":
        return not (val is None or val == "")
    if val is None:
        return False

    if ftype == "date":
        val = _coerce_date(val)
        want = [_coerce_date(w) for w in want] if isinstance(want, list) else _coerce_date(want)
    if ftype == "number":
        val = float(val)
        want = [float(w) for w in want] if isinstance(want, list) else \
               (float(want) if want is not None else None)
    if ftype == "text":
        val = str(val)
        if op in {"contains", "not_contains", "starts_with", "ends_with"}:
            want = str(want)

    if op == "=":
        return val == want
    if op == "!=":
        return val != want
    if op == ">":
        return val > want
    if op == ">=":
        return val >= want
    if op == "<":
        return val < want
    if op == "<=":
        return val <= want
    if op == "between":
        return want[0] <= val <= want[1]
    if op == "not_between":
        return not (want[0] <= val <= want[1])
    if op == "in":
        return val in want
    if op == "not_in":
        return val not in want
    if op == "contains":
        return want.lower() in val.lower()
    if op == "not_contains":
        return want.lower() not in val.lower()
    if op == "starts_with":
        return val.lower().startswith(want.lower())
    if op == "ends_with":
        return val.lower().endswith(want.lower())
    if op == "is_true":
        return bool(val) is True
    if op == "is_false":
        return bool(val) is False
    raise ValueError(f"Unknown operator '{op}'")


def eval_group(rec: dict, group: Optional[dict], ctx: dict, rules: dict[str, dict],
               stack: tuple = (), semantic: Optional[dict] = None) -> bool:
    if not group:
        return True
    op = (group.get("op") or "AND").upper()
    conds = group.get("conditions") or []
    if op == "AND":
        return all(eval_condition(rec, c, ctx, rules, stack, semantic) for c in conds)
    if op == "OR":
        return any(eval_condition(rec, c, ctx, rules, stack, semantic) for c in conds)
    if op == "NOT":
        return not any(eval_condition(rec, c, ctx, rules, stack, semantic) for c in conds)
    raise ValueError(f"Unknown group op '{op}'")


# ─────────────────────────────────────────────── measures

def load_measures(db) -> dict[str, dict]:
    """User-defined measure library (rs_measures) — spec §5.6."""
    try:
        rows = db.execute(text(
            "SELECT measure_key, name, kind, field, agg, weight_field, expr, "
            "unit, decimals FROM rs_measures WHERE is_active")).mappings().all()
    except Exception:
        db.rollback()
        return {}
    return {r["measure_key"]: dict(r) for r in rows}


def apply_measure(records: list[dict], measure: dict,
                  semantic: Optional[dict[str, dict]] = None) -> Optional[float]:
    """measure = {field, agg[, weight_field]} —
    agg: sum|count|count_distinct|avg|min|max|median|weighted_avg."""
    semantic = semantic or SEMANTIC_FIELDS
    agg = (measure.get("agg") or "sum").lower()
    field = measure.get("field")
    if agg == "count":
        return float(len(records))
    if field not in semantic:
        raise ValueError(f"Unknown measure field '{field}'")
    if agg == "weighted_avg":
        wf = measure.get("weight_field")
        if wf not in semantic:
            raise ValueError(f"weighted_avg needs a valid weight_field (got '{wf}')")
        num = den = 0.0
        for r in records:
            v, w = r.get(field), r.get(wf)
            if v is None or w is None:
                continue
            num += float(v) * float(w)
            den += float(w)
        return round(num / den, 4) if den else None
    vals = [r.get(field) for r in records if r.get(field) is not None]
    if agg == "count_distinct":
        return float(len({v for v in vals}))
    nums = [float(v) for v in vals]
    if agg == "sum":
        return round(sum(nums), 4)
    if not nums:
        return None
    if agg == "avg":
        return round(sum(nums) / len(nums), 4)
    if agg == "min":
        return min(nums)
    if agg == "max":
        return max(nums)
    if agg == "median":
        return _median(nums)
    raise ValueError(f"Unknown aggregation '{agg}'")


# ─────────────────────────────────────────────── report runner

def load_rules(db) -> dict[str, dict]:
    rows = db.execute(text(
        "SELECT rule_key, rule_name, condition, version FROM rs_rules "
        "WHERE is_published ORDER BY rule_key")).mappings().all()
    out = {}
    for r in rows:
        cond = r["condition"]
        out[r["rule_key"]] = {"name": r["rule_name"], "version": r["version"],
                              "condition": json.loads(cond) if isinstance(cond, str) else cond}
    return out


def _walk_rows(rows: list[dict], parent_chain: list[dict]) -> list[tuple[dict, list[dict]]]:
    """Flatten the row tree into (row, ancestor_chain) pairs, depth-first."""
    out = []
    for row in rows:
        out.append((row, parent_chain))
        out.extend(_walk_rows(row.get("children") or [], parent_chain + [row]))
    return out


def _effective_condition(row: dict, chain: list[dict]) -> dict:
    conds = []
    for anc in chain + [row]:
        rule = anc.get("rule")
        if not rule:
            continue
        conds.append({"rule": rule} if isinstance(rule, str) else rule)
    return {"op": "AND", "conditions": conds}


def _resolve_columns(columns: list[dict], measure_lib: dict[str, dict]) -> list[dict]:
    """A column may inline its measure, or reference a library measure_key.
    Library measures may be kind='agg' or kind='formula' (over other columns)."""
    out = []
    for col in columns:
        c = dict(col)
        mk = c.get("measure_key")
        if mk:
            m = measure_lib.get(mk)
            if not m:
                raise ValueError(f"Unknown measure '{mk}'")
            if m["kind"] == "formula":
                c["formula"] = m["expr"]
                c["formula_deps"] = {
                    name: {"field": lib_m["field"], "agg": lib_m["agg"],
                           "weight_field": lib_m.get("weight_field")}
                    for name in fidents(m["expr"])
                    if (lib_m := measure_lib.get(name)) and lib_m["kind"] == "agg"}
            else:
                c["measure"] = {"field": m["field"], "agg": m["agg"],
                                "weight_field": m.get("weight_field")}
            c.setdefault("name", m["name"])
            if m.get("unit"):
                c.setdefault("unit", m["unit"])
            if m.get("decimals") is not None:
                c.setdefault("decimals", int(m["decimals"]))
        out.append(c)
    return out


def _id_field(dataset: Optional[dict]) -> str:
    return (dataset or {}).get("id_field") or "scheme_id"


def run_report(db, definition: dict, report_date: date,
               include_ids: bool = False, user: Optional[dict] = None) -> dict[str, Any]:
    """Calculate every row × column, with per-cell traceability + reconciliation."""
    ctx = period_context(report_date)
    rules = load_rules(db)
    dataset = load_dataset(db, definition.get("dataset"))
    semantic = dataset_semantic_fields(dataset)
    population = fetch_population(db, report_date, definition.get("dataset"), user=user)
    measure_lib = load_measures(db)
    columns = _resolve_columns(definition.get("columns") or [], measure_lib)
    idf = _id_field(dataset)

    flat = _walk_rows(definition.get("rows") or [], [])
    results: list[dict[str, Any]] = []
    ids_by_rowid: dict[str, set] = {}
    cells_by_rowid: dict[str, dict] = {}

    # pass 1 — rule rows (population + agg measures)
    for row, chain in flat:
        if row.get("type") == "formula":
            continue
        eff = _effective_condition(row, chain)
        qualifying = [r for r in population if eval_group(r, eff, ctx, rules, (), semantic)]
        ids = {r[idf] for r in qualifying}
        ids_by_rowid[row["id"]] = ids
        cells: dict[str, Any] = {}
        for col in columns:
            if "formula" in col:
                continue
            cells[col["key"]] = apply_measure(qualifying, col["measure"], semantic)
        # formula columns evaluate over this row's own agg cells (spec §4.2)
        for col in columns:
            if "formula" in col:
                env = dict(cells)
                for dep, dm in (col.get("formula_deps") or {}).items():
                    if dep not in env:
                        env[dep] = apply_measure(qualifying, dm, semantic)
                try:
                    v = feval(col["formula"], env)
                except FormulaError as e:
                    raise ValueError(f"Column '{col.get('name', col['key'])}': {e}")
                cells[col["key"]] = round(v, 4) if isinstance(v, float) else v
        cells_by_rowid[row["id"]] = cells
        entry = {
            "id": row["id"], "name": row["name"], "depth": len(chain),
            "rule": row.get("rule"), "recon": row.get("recon"),
            "scheme_count": len(ids), "cells": cells,
        }
        if include_ids:
            entry["scheme_ids"] = sorted(ids)
        results.append(entry)

    # pass 2 — calculated rows (spec §4.5: cells referencing other cells)
    def _cell(rid: str, ck: str):
        c = cells_by_rowid.get(rid)
        if c is None:
            raise FormulaError(f"cell(): unknown or not-yet-computed row '{rid}'")
        if ck not in c:
            raise FormulaError(f"cell(): unknown column '{ck}' on row '{rid}'")
        return c[ck]

    for row, chain in flat:
        if row.get("type") != "formula":
            continue
        cells = {}
        for col in columns:
            expr = (row.get("cells") or {}).get(col["key"])
            if expr is None:
                cells[col["key"]] = None
                continue
            try:
                v = feval(expr, {"__cell__": _cell})
            except FormulaError as e:
                raise ValueError(f"Calculated row '{row['name']}' × {col['key']}: {e}")
            cells[col["key"]] = round(v, 4) if isinstance(v, float) else v
        cells_by_rowid[row["id"]] = cells
        results.append({
            "id": row["id"], "name": row["name"], "depth": len(chain),
            "rule": None, "recon": None, "type": "formula",
            "scheme_count": None, "cells": cells,
        })

    # restore document order (formula rows appended in pass 2)
    order = {row["id"]: i for i, (row, _c) in enumerate(flat)}
    results.sort(key=lambda r: order[r["id"]])

    # reconciliation (spec §5.10 / §6)
    checks = []
    row_by_id = {row["id"]: (row, chain) for row, chain in flat}
    for row, chain in flat:
        recon = row.get("recon")
        children = row.get("children") or []
        if not recon or not children:
            continue
        parent_ids = ids_by_rowid[row["id"]]
        child_sets = [ids_by_rowid[c["id"]] for c in children]
        union = set().union(*child_sets) if child_sets else set()
        overlaps = []
        for i in range(len(child_sets)):
            for j in range(i + 1, len(child_sets)):
                both = child_sets[i] & child_sets[j]
                if both:
                    overlaps.append({"a": children[i]["name"], "b": children[j]["name"],
                                     "scheme_ids": sorted(both)})
        missing = sorted(parent_ids - union)
        extra = sorted(union - parent_ids)
        ok = True
        detail = []
        if recon in ("exclusive", "exclusive_exhaustive") and overlaps:
            ok = False
            detail.append(f"{len(overlaps)} overlapping child pair(s)")
        if recon in ("exhaustive", "exclusive_exhaustive", "sum_children"):
            if missing:
                ok = False
                detail.append(f"{len(missing)} scheme(s) in parent but no child")
            if extra:
                ok = False
                detail.append(f"{len(extra)} scheme(s) in a child but not parent")
        checks.append({
            "parent": row["name"], "type": recon, "passed": ok,
            "detail": "; ".join(detail) or "OK",
            "parent_count": len(parent_ids), "children_union_count": len(union),
            "overlaps": overlaps, "missing_scheme_ids": missing,
        })

    # value reconciliation (spec §5.10: On Time + D<1 + D>1 = Total, etc.)
    def _cellv(rid: str, ck: str):
        c = cells_by_rowid.get(rid)
        if c is None or ck not in c:
            raise FormulaError(f"cell('{rid}','{ck}') not found")
        return c[ck]

    for vc in definition.get("value_checks") or []:
        try:
            left = feval(vc["left"], {"__cell__": _cellv})
            right = feval(vc["right"], {"__cell__": _cellv})
        except FormulaError as e:
            checks.append({"parent": vc.get("name", "value check"), "type": "value",
                           "passed": False, "detail": str(e),
                           "parent_count": None, "children_union_count": None,
                           "overlaps": [], "missing_scheme_ids": []})
            continue
        tol = float(vc.get("tolerance", 0.01))
        diff = None if (left is None or right is None) else abs(left - right)
        ok = diff is not None and diff <= tol
        checks.append({"parent": vc.get("name", "value check"), "type": "value",
                       "passed": ok,
                       "detail": f"left {left} vs right {right}" + ("" if ok else f" (Δ {diff})"),
                       "parent_count": left, "children_union_count": right,
                       "overlaps": [], "missing_scheme_ids": []})

    return {
        "report_date": report_date.isoformat(),
        "fy": ctx["fy"],
        "dataset": (dataset or {}).get("dataset_key", DEFAULT_DATASET_KEY),
        "population_count": len(population),
        "columns": columns,
        "rows": results,
        "reconciliation": checks,
        "rule_versions": {k: v["version"] for k, v in rules.items()},
    }


def cell_drilldown(db, definition: dict, report_date: date,
                   row_id: str, column_key: str, user: Optional[dict] = None) -> dict[str, Any]:
    """Spec §5.9 — never a black box: exact contributing schemes + values."""
    ctx = period_context(report_date)
    rules = load_rules(db)
    dataset = load_dataset(db, definition.get("dataset"))
    semantic = dataset_semantic_fields(dataset)
    population = fetch_population(db, report_date, definition.get("dataset"), user=user)
    measure_lib = load_measures(db)
    columns = _resolve_columns(definition.get("columns") or [], measure_lib)
    idf = _id_field(dataset)
    flat = _walk_rows(definition.get("rows") or [], [])
    target = next(((row, chain) for row, chain in flat if row["id"] == row_id), None)
    if not target:
        raise ValueError(f"Row '{row_id}' not found")
    col = next((c for c in columns if c["key"] == column_key), None)
    if not col:
        raise ValueError(f"Column '{column_key}' not found")
    row, chain = target
    if row.get("type") == "formula":
        raise ValueError("Calculated rows have no record population; drill their inputs instead")
    eff = _effective_condition(row, chain)
    qualifying = [r for r in population if eval_group(r, eff, ctx, rules, (), semantic)]
    if "formula" in col:
        base = {c["key"]: apply_measure(qualifying, c["measure"], semantic)
                for c in columns if "measure" in c}
        for dep, dm in (col.get("formula_deps") or {}).items():
            if dep not in base:
                base[dep] = apply_measure(qualifying, dm, semantic)
        value = feval(col["formula"], base)
        field = None
    else:
        value = apply_measure(qualifying, col["measure"], semantic)
        field = col["measure"].get("field")
    name_f = (dataset or {}).get("name_field") or "scheme_name"
    return {
        "row": row["name"], "column": col["name"],
        "effective_conditions": eff,
        "value": round(value, 4) if isinstance(value, float) else value,
        "qualifying_count": len(qualifying),
        "schemes": [{
            "scheme_id": r[idf], "scheme_name": r.get(name_f),
            "contribution": (float(r[field]) if (field and r.get(field) is not None
                                                 and semantic.get(field, {}).get("type") == "number")
                             else None),
        } for r in qualifying],
    }
