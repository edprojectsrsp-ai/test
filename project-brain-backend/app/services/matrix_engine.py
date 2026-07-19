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

import json
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import text


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


def fetch_population(db, report_date: date) -> list[dict[str, Any]]:
    """One SQL: schemes + FY-sensitive CAPEX aggregates; then derived fields."""
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
    return population


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
                   stack: tuple = ()) -> bool:
    """Evaluate one condition node against one record."""
    # reusable rule reference
    if "rule" in cond:
        key = cond["rule"]
        if key in stack:
            raise ValueError(f"Circular rule reference: {' -> '.join(stack + (key,))}")
        rule = rules.get(key)
        if rule is None:
            raise ValueError(f"Unknown rule '{key}'")
        return eval_group(rec, rule["condition"], ctx, rules, stack + (key,))
    # nested group
    if "op" in cond and "conditions" in cond:
        return eval_group(rec, cond, ctx, rules, stack)

    field, op = cond.get("field"), cond.get("op")
    if field not in SEMANTIC_FIELDS:
        raise ValueError(f"Unknown field '{field}'")
    val = rec.get(field)
    want = resolve_value(cond.get("value"), ctx)
    ftype = SEMANTIC_FIELDS[field]["type"]

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
               stack: tuple = ()) -> bool:
    if not group:
        return True
    op = (group.get("op") or "AND").upper()
    conds = group.get("conditions") or []
    if op == "AND":
        return all(eval_condition(rec, c, ctx, rules, stack) for c in conds)
    if op == "OR":
        return any(eval_condition(rec, c, ctx, rules, stack) for c in conds)
    if op == "NOT":
        return not any(eval_condition(rec, c, ctx, rules, stack) for c in conds)
    raise ValueError(f"Unknown group op '{op}'")


# ─────────────────────────────────────────────── measures

def apply_measure(records: list[dict], measure: dict) -> Optional[float]:
    """measure = {field, agg} — agg: sum|count|count_distinct|avg|min|max."""
    agg = (measure.get("agg") or "sum").lower()
    field = measure.get("field")
    if agg == "count":
        return float(len(records))
    if field not in SEMANTIC_FIELDS:
        raise ValueError(f"Unknown measure field '{field}'")
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


def run_report(db, definition: dict, report_date: date) -> dict[str, Any]:
    """Calculate every row × column, with per-cell traceability + reconciliation."""
    ctx = period_context(report_date)
    rules = load_rules(db)
    population = fetch_population(db, report_date)
    columns = definition.get("columns") or []

    flat = _walk_rows(definition.get("rows") or [], [])
    results: list[dict[str, Any]] = []
    ids_by_rowid: dict[str, set] = {}

    for row, chain in flat:
        eff = _effective_condition(row, chain)
        qualifying = [r for r in population if eval_group(r, eff, ctx, rules)]
        ids = {r["scheme_id"] for r in qualifying}
        ids_by_rowid[row["id"]] = ids
        cells = {}
        for col in columns:
            cells[col["key"]] = apply_measure(qualifying, col["measure"])
        results.append({
            "id": row["id"], "name": row["name"], "depth": len(chain),
            "rule": row.get("rule"), "recon": row.get("recon"),
            "scheme_count": len(ids), "cells": cells,
        })

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

    return {
        "report_date": report_date.isoformat(),
        "fy": ctx["fy"],
        "population_count": len(population),
        "columns": columns,
        "rows": results,
        "reconciliation": checks,
        "rule_versions": {k: v["version"] for k, v in rules.items()},
    }


def cell_drilldown(db, definition: dict, report_date: date,
                   row_id: str, column_key: str) -> dict[str, Any]:
    """Spec §5.9 — never a black box: exact contributing schemes + values."""
    ctx = period_context(report_date)
    rules = load_rules(db)
    population = fetch_population(db, report_date)
    flat = _walk_rows(definition.get("rows") or [], [])
    target = next(((row, chain) for row, chain in flat if row["id"] == row_id), None)
    if not target:
        raise ValueError(f"Row '{row_id}' not found")
    col = next((c for c in (definition.get("columns") or []) if c["key"] == column_key), None)
    if not col:
        raise ValueError(f"Column '{column_key}' not found")
    row, chain = target
    eff = _effective_condition(row, chain)
    qualifying = [r for r in population if eval_group(r, eff, ctx, rules)]
    field = col["measure"].get("field")
    return {
        "row": row["name"], "column": col["name"],
        "effective_conditions": eff,
        "value": apply_measure(qualifying, col["measure"]),
        "qualifying_count": len(qualifying),
        "schemes": [{
            "scheme_id": r["scheme_id"], "scheme_name": r["scheme_name"],
            "contribution": (float(r[field]) if (field and r.get(field) is not None
                                                 and SEMANTIC_FIELDS.get(field, {}).get("type") == "number")
                             else None),
        } for r in qualifying],
    }
