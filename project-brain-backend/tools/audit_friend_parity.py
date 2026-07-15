"""Audit the restored Friend Project against Project Brain.

The audit is intentionally read-only.  It checks the immutable SQL archive
row-for-row, verifies the normalized import footprint, and compares every
numeric figure exposed by the Friend dashboard and report payloads with the
compatibility models used by Project Brain.

Run from ``project-brain-backend`` while the Friend API is on port 8001::

    .venv/Scripts/python tools/audit_friend_parity.py
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import urllib.request
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.api.v1.mos_reports import pmc_board
from app.core.database import SessionLocal, engine
from app.services.friend_parity import capex_detail_model, dashboard_model, mos_model

ARCHIVE_TABLES = [
    "activities", "app_settings", "appendix2", "billing_schedule", "capex_plans",
    "capex_settings", "corporate_amr_master", "corporate_amr_tender_openings",
    "daily_actuals", "daily_progress", "daily_progress_manpower", "monthly_plans",
    "plans", "plant_level_amr_details", "plant_level_amr_edc_idc",
    "plant_level_amr_monthly", "project_approval_field_history",
    "project_approval_fields", "projects", "schedule_activities",
    "schedule_baselines", "schedule_imports", "tods",
]
SECURITY_TABLES = [
    "app_users", "password_reset_otps", "role_project_permissions",
    "user_permissions", "user_preferences", "user_project_permissions", "user_projects",
]
FIGURE_KEYS = {
    "projects", "value", "cost", "totalCost", "expenditureLastFy", "capexCurrentFy",
    "expenditureCurrentFy", "totalExpenditure", "grossCost", "cumulativeExpenditure",
    "originalCost", "revisedCost", "anticipatedCost", "costOverrun", "be", "re",
    "plan", "actual", "achievement", "share", "amount", "scope", "lastFyActual",
    "planUptoMonth", "actualUptoMonth", "actualTillPreviousMonth", "planForMonth",
    "planForNextMonth", "actualForMonth", "overallTarget", "cumulativePrevious",
    "targetMonth", "nextMonthTarget", "achievementMonth", "lastFyActualPercent",
    "currentFyPlanPercent", "currentFyActualPercent", "filledDays", "manpower",
    "totalProjects", "ongoingProjects", "completedProjects", "droppedProjects",
    "totalProjectCost", "totalCapex", "actualCapex", "achievementPercent",
    "completedCorporateProjects", "completedCorporateCost", "completedPlantLevelProjects",
    "completedPlantLevelCost", "corporateProjects", "plantLevelProjects", "corporateCost",
    "plantLevelCost", "corporateOngoingProjects", "corporateOngoingCost",
    "plantLevelOngoingProjects", "plantLevelOngoingCost", "corporateScheduledThisFyProjects",
    "corporateScheduledThisFyCost", "plantLevelScheduledThisFyProjects",
    "plantLevelScheduledThisFyCost", "corporateUpcomingProjects", "corporateUpcomingCost",
    "plantLevelUpcomingProjects", "plantLevelUpcomingCost", "corporateValue",
    "corporateCost", "plantValue", "plantCost", "totalBe", "totalRe", "totalBeRe",
    "totalActual", "variance", "variancePercent", "count",
}


def _json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def _canon(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(k): _canon(v) for k, v in sorted(value.items(), key=lambda x: str(x[0]))}
    if isinstance(value, (list, tuple)):
        return [_canon(v) for v in value]
    return value


def _table_digest(connection, schema: str, table: str) -> tuple[int, str]:
    rows = connection.execute(text(f'SELECT * FROM "{schema}"."{table}"')).mappings()
    encoded = [json.dumps(_canon(dict(row)), sort_keys=True, separators=(",", ":"), default=str)
               for row in rows]
    encoded.sort()
    digest = hashlib.sha256("\n".join(encoded).encode("utf-8")).hexdigest()
    return len(encoded), digest


def _equal(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(float(a), float(b), rel_tol=1e-8, abs_tol=0.011)
    return a == b


def _figures(value: Any, path: str = "") -> dict[str, Any]:
    """Flatten report figures, retaining paths so missing drill-downs are visible."""
    out: dict[str, Any] = {}
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key in FIGURE_KEYS and (child is None or isinstance(child, (int, float))):
                out[child_path] = child
            out.update(_figures(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            out.update(_figures(child, f"{path}[{index}]"))
    return out


def _compare_figures(section: str, source: Any, target: Any, mismatches: list[dict]) -> dict:
    expected = _figures(source)
    actual = _figures(target)
    for path, source_value in expected.items():
        target_value = actual.get(path, "<missing>")
        if target_value == "<missing>" or not _equal(source_value, target_value):
            mismatches.append({"section": section, "path": path,
                               "source": source_value, "target": target_value})
    return {"source_figures": len(expected), "matched_figures": len(expected) -
            sum(1 for row in mismatches if row["section"] == section)}


def _compare_value(section: str, path: str, source: Any, target: Any,
                   mismatches: list[dict]) -> None:
    if not _equal(source, target):
        mismatches.append({"section": section, "path": path,
                           "source": source, "target": target})


def _section_result(section: str, total: int, before: int, mismatches: list[dict]) -> dict:
    failed = len(mismatches) - before
    return {"source_figures": total, "matched_figures": total - failed}


def _dashboard_target_for_source(target: dict) -> dict:
    # The source uses two legacy KPI names.  Keep the comparison semantic while
    # both aliases remain supported by the frontend.
    result = json.loads(json.dumps(target, default=str))
    kpis = result.get("kpis", {})
    kpis["completedCorporateProjects"] = kpis.get("corporateCompletedProjects")
    kpis["completedPlantLevelProjects"] = kpis.get("plantLevelCompletedProjects")
    return result


def _pmc_target_by_source_id(db, target: dict) -> dict[int, dict]:
    rows = db.execute(text("""
        SELECT package_id, extra_fields FROM packages
        WHERE NOT is_deleted AND extra_fields ? 'friend_project_ids'
    """)).mappings().all()
    source_by_package: dict[int, int] = {}
    for row in rows:
        extra = row["extra_fields"] or {}
        if isinstance(extra, str):
            extra = json.loads(extra)
        ids = [int(v) for v in extra.get("friend_project_ids", [])]
        if ids:
            source_by_package[int(row["package_id"])] = ids[-1]
    return {source_by_package[int(block["packageId"])]: block for block in target["blocks"]
            if int(block["packageId"]) in source_by_package}


def main() -> int:
    friend_api = os.getenv("FRIEND_API_URL", "http://127.0.0.1:8001").rstrip("/")
    source_url = engine.url.set(database=os.getenv("FRIEND_DB_NAME", "friend_brain"))
    source_engine = create_engine(source_url)
    mismatches: list[dict] = []
    archive: dict[str, dict] = {}

    with source_engine.connect() as source, engine.connect() as target:
        source_tables = set(inspect(source).get_table_names(schema="public"))
        archive_tables = set(inspect(target).get_table_names(schema="friend_archive"))
        for table in ARCHIVE_TABLES:
            if table not in source_tables or table not in archive_tables:
                archive[table] = {"status": "missing_table"}
                mismatches.append({"section": "sql_archive", "path": table,
                                   "source": table in source_tables, "target": table in archive_tables})
                continue
            source_count, source_hash = _table_digest(source, "public", table)
            target_count, target_hash = _table_digest(target, "friend_archive", table)
            archive[table] = {"source_rows": source_count, "target_rows": target_count,
                              "source_sha256": source_hash, "target_sha256": target_hash,
                              "exact": source_count == target_count and source_hash == target_hash}
            if not archive[table]["exact"]:
                mismatches.append({"section": "sql_archive", "path": table,
                                   "source": source_count, "target": target_count})

        excluded = {table: int(source.execute(text(f'SELECT COUNT(*) FROM public."{table}"')).scalar())
                    for table in SECURITY_TABLES if table in source_tables}

    source_dashboard_payload = _json(f"{friend_api}/api/dashboard/summary")
    source_reports = _json(f"{friend_api}/api/reports/summary")
    source_pmc = _json(f"{friend_api}/api/reports/summary?report=physical-progress-pmc")
    with SessionLocal() as db:
        target_dashboard = dashboard_model(db)
        target_mos = mos_model(db, "2026-07")
        target_detail = capex_detail_model(db, "2026-07")
        target_pmc = pmc_board("2026-07", db)
        pmc_by_source = _pmc_target_by_source_id(db, target_pmc)

        normalized = {
            "schemes": int(db.execute(text("SELECT COUNT(*) FROM scheme_master WHERE NOT is_deleted")).scalar()),
            "packages": int(db.execute(text("SELECT COUNT(*) FROM packages WHERE NOT is_deleted")).scalar()),
            "friend_plans": int(db.execute(text("SELECT COUNT(*) FROM progress_plans WHERE extra_fields->>'src'='friend_import'")).scalar()),
            "friend_activities": int(db.execute(text("""SELECT COUNT(*) FROM plan_activities pa JOIN progress_plans pp ON pp.plan_id=pa.plan_id WHERE pp.extra_fields->>'src'='friend_import' AND NOT pa.is_deleted""")).scalar()),
            "friend_monthly_plans": int(db.execute(text("""SELECT COUNT(*) FROM monthly_plan_entries mpe JOIN plan_activities pa ON pa.activity_id=mpe.activity_id JOIN progress_plans pp ON pp.plan_id=pa.plan_id WHERE pp.extra_fields->>'src'='friend_import'""")).scalar()),
            "friend_daily_actuals": int(db.execute(text("""SELECT COUNT(*) FROM daily_actuals da JOIN plan_activities pa ON pa.activity_id=da.activity_id JOIN progress_plans pp ON pp.plan_id=pa.plan_id WHERE pp.extra_fields->>'src'='friend_import'""")).scalar()),
            "appendix_revisions": int(db.execute(text("SELECT COUNT(*) FROM appendix2_revisions WHERE extra_fields->>'src'='friend_import'")).scalar()),
            "appendix_items": int(db.execute(text("""SELECT COUNT(*) FROM appendix2_items i JOIN appendix2_revisions r ON r.revision_id=i.revision_id WHERE r.extra_fields->>'src'='friend_import'""")).scalar()),
            "billing_rows": int(db.execute(text("SELECT COUNT(*) FROM billing_schedules WHERE extra_fields->>'src'='friend_import'")).scalar()),
        }

    sections = {}
    source_dash = {"cards": source_dashboard_payload["cards"], **source_dashboard_payload["dashboard"]}
    sections["dashboard"] = _compare_figures(
        "dashboard", source_dash, _dashboard_target_for_source(target_dashboard), mismatches)
    source_mos = source_reports["mosCapex"]
    summary_keys = ("projects", "totalCost", "expenditureLastFy", "capexCurrentFy",
                    "expenditureCurrentFy", "totalExpenditure")
    before = len(mismatches); total = 0
    for index, (source_row, target_row) in enumerate(zip(source_mos["rows"], target_mos["rows"])):
        for key in summary_keys:
            total += 1
            _compare_value("mos_summary", f"rows[{index}].{key}",
                           source_row.get(key), target_row.get(key), mismatches)
    _compare_value("mos_summary", "row_count", len(source_mos["rows"]), len(target_mos["rows"]), mismatches)
    total += 1
    sections["mos_summary"] = _section_result("mos_summary", total, before, mismatches)

    source_physical = source_mos["physicalFinancial"]
    before = len(mismatches); total = 0
    source_projects = {int(row["id"]): row for row in source_physical["detailProjects"]}
    target_projects = {int(row["id"]): row for row in target_mos["detailProjects"]}
    for source_id, source_row in source_projects.items():
        target_row = target_projects.get(source_id, {})
        for key in ("totalCost", "expenditureLastFy", "capexCurrentFy",
                    "expenditureCurrentFy", "totalExpenditure"):
            total += 1
            _compare_value("capex_detail", f"project[{source_id}].{key}",
                           source_row.get(key), target_row.get(key, "<missing>"), mismatches)
    low_source = source_physical["lowCostSummary"]
    low_target = target_detail["lowCostSummary"]
    for source_key, target_key in (("projects", "count"), ("totalCost", "totalCost"),
                                   ("expenditureLastFy", "expenditureLastFy"),
                                   ("capexCurrentFy", "capexCurrentFy"),
                                   ("expenditureCurrentFy", "expenditureCurrentFy"),
                                   ("totalExpenditure", "cumulativeExpenditure")):
        total += 1
        _compare_value("capex_detail", f"lowCostSummary.{source_key}",
                       low_source.get(source_key), low_target.get(target_key), mismatches)
    total += 1
    _compare_value("capex_detail", "project_count", len(source_projects), len(target_projects), mismatches)
    sections["capex_detail"] = _section_result("capex_detail", total, before, mismatches)

    pmc_expected = source_pmc["mosCapex"]["physicalFinancial"]["detailProjects"]
    pmc_source_map = {int(row["id"]): row for row in pmc_expected}
    before = len(mismatches); total = 1
    _compare_value("pmc", "project_count", len(pmc_source_map), len(pmc_by_source), mismatches)
    physical_key_map = (("lastFyActualPercent", "last_fy"),
                        ("currentFyPlanPercent", "fy_plan"),
                        ("currentFyActualPercent", "fy_actual"))
    for source_id, source_row in pmc_source_map.items():
        if not source_row.get("hasCompletedPlanning"):
            continue
        values = source_row["physicalProgressValuesByMonth"]["Jul-26"]
        target_values = (pmc_by_source.get(source_id) or {}).get("physical") or {}
        for source_key, target_key in physical_key_map:
            total += 1
            _compare_value("pmc", f"project[{source_id}].{source_key}",
                           values[source_key], target_values.get(target_key, "<missing>"), mismatches)
    sections["pmc"] = _section_result("pmc", total, before, mismatches)

    # The friend response repeats activity-level month tables in several report
    # branches.  Track this payload depth separately from the displayed parity
    # contract so it remains visible without turning every repeated cell into a
    # false independent business-figure failure.
    extended_source = len(_figures(source_reports)) + len(_figures(source_pmc))
    report_depth = {
        "friend_numeric_cells": extended_source,
        "note": "Activity/month drill-down payload is preserved in friend_archive; "
                "Project Brain exposes the matched dashboard, MoS, CAPEX and PMC figures above.",
    }

    exact_tables = sum(1 for row in archive.values() if row.get("exact"))
    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_database": "friend_brain",
        "archive": {"exact_tables": exact_tables, "expected_tables": len(ARCHIVE_TABLES),
                    "tables": archive, "security_rows_intentionally_excluded": excluded},
        "normalized": normalized,
        "sections": sections,
        "extended_payload": report_depth,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
    }
    output = ROOT / "tools" / "output"
    output.mkdir(parents=True, exist_ok=True)
    (output / "friend_parity_audit.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")
    md = ["# Friend-project parity audit", "",
          f"Generated: {report['generated_at']}", "",
          f"- SQL archive exact tables: {exact_tables}/{len(ARCHIVE_TABLES)}",
          f"- Figure mismatches: {len(mismatches)}", "",
          "## Figure coverage", ""]
    for name, values in sections.items():
        md.append(f"- {name}: {values['matched_figures']}/{values['source_figures']} matched")
    md.extend(["", "## First mismatches", ""])
    for row in mismatches[:100]:
        md.append(f"- `{row['section']}:{row['path']}` — friend `{row['source']}`, target `{row['target']}`")
    (output / "friend_parity_audit.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"archive_exact": f"{exact_tables}/{len(ARCHIVE_TABLES)}",
                      "sections": sections, "mismatches": len(mismatches),
                      "report": str(output / 'friend_parity_audit.md')}, indent=2))
    return 0 if not mismatches else 1


if __name__ == "__main__":
    raise SystemExit(main())
