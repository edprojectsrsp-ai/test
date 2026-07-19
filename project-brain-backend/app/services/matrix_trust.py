"""Matrix Engine M2 — data quality (spec §11) + snapshot compare.

DQ: each configured check is a formula over record fields; a record for which
the expression is TRUE is a violation. Error-severity violations gate snapshot
freezing (override allowed but audited by the API layer).

Compare: cell-level deltas between a frozen snapshot and either live figures
or another snapshot, with WHY: which records entered/left each row and which
rule versions changed between the two sides.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy import text

from app.services import matrix_engine as ME
from app.services.formula_engine import FormulaError, evaluate as feval


def load_dq_checks(db, dataset_key: str = "schemes") -> list[dict]:
    try:
        rows = db.execute(text(
            "SELECT check_key, name, description, severity, expr FROM rs_dq_checks "
            "WHERE is_active AND dataset_key = :d ORDER BY severity, check_key"),
            {"d": dataset_key}).mappings().all()
    except Exception:
        db.rollback()
        return []
    return [dict(r) for r in rows]


def run_dq(db, report_date: date, dataset_key: Optional[str] = None) -> dict[str, Any]:
    """Evaluate every active check over the live population — drillable."""
    dataset = ME.load_dataset(db, dataset_key)
    dkey = (dataset or {}).get("dataset_key", ME.DEFAULT_DATASET_KEY)
    idf = (dataset or {}).get("id_field", "scheme_id")
    nf = (dataset or {}).get("name_field", "scheme_name")
    population = ME.fetch_population(db, report_date, dataset_key)
    ctx = ME.period_context(report_date)
    results = []
    for chk in load_dq_checks(db, dkey):
        violations = []
        for rec in population:
            try:
                hit = bool(feval(chk["expr"], {**ctx, **rec}))
            except FormulaError as e:
                results.append({**chk, "error": str(e), "violation_count": None,
                                "violations": []})
                break
            if hit:
                violations.append({"scheme_id": rec[idf], "scheme_name": rec.get(nf)})
        else:
            results.append({**chk, "violation_count": len(violations),
                            "violations": violations[:100]})
    errors = sum(r["violation_count"] or 0 for r in results if r["severity"] == "error")
    warnings = sum(r["violation_count"] or 0 for r in results if r["severity"] == "warning")
    return {"report_date": report_date.isoformat(), "dataset": dkey,
            "population": len(population),
            "error_violations": errors, "warning_violations": warnings,
            "freeze_allowed": errors == 0, "checks": results}


def _index_result(result: dict) -> dict[str, dict]:
    return {r["id"]: r for r in result["rows"]}


def compare(base: dict, other: dict, base_rules: dict, other_rules: dict,
            base_label: str, other_label: str) -> dict[str, Any]:
    """base/other = run results (with scheme_ids where available)."""
    bi, oi = _index_result(base), _index_result(other)
    col_keys = [c["key"] for c in base["columns"]]
    rows = []
    for rid, br in bi.items():
        orow = oi.get(rid)
        deltas, changed = {}, False
        for k in col_keys:
            a = br["cells"].get(k)
            b = orow["cells"].get(k) if orow else None
            d = None if (a is None or b is None) else round(b - a, 4)
            if d not in (None, 0) or (a is None) != (b is None):
                changed = True
            deltas[k] = {"base": a, "other": b, "delta": d}
        entered = left = None
        if orow and "scheme_ids" in br and "scheme_ids" in orow:
            bs, os_ = set(br["scheme_ids"]), set(orow["scheme_ids"])
            entered, left = sorted(os_ - bs), sorted(bs - os_)
            if entered or left:
                changed = True
        if changed:
            rows.append({"id": rid, "name": br["name"], "depth": br["depth"],
                         "cells": deltas, "entered": entered, "left": left,
                         "missing_in_other": orow is None})
    rule_changes = []
    for key in sorted(set(base_rules) | set(other_rules)):
        bv = (base_rules.get(key) or {}).get("version") if isinstance(base_rules.get(key), dict) else base_rules.get(key)
        ov = (other_rules.get(key) or {}).get("version") if isinstance(other_rules.get(key), dict) else other_rules.get(key)
        if bv != ov:
            rule_changes.append({"rule_key": key, base_label: bv, other_label: ov})
    return {"base": base_label, "other": other_label,
            "changed_rows": rows, "rule_version_changes": rule_changes,
            "unchanged": len(bi) - len(rows)}
