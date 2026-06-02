"""
AI Service Diagnostics.

Endpoint: GET /ai/diagnostics

Runs each registered tool with a safe argument set and reports:
  - DB connectivity check
  - For each tool: status ("ok" | "degraded" | "error"), preview of result
  - Schema introspection: which tables/views the AI expects vs which exist

Use this to verify "is the AI actually connected to the database?" in one shot.

Safe args: we pick the first scheme_id / package_id from the database to feed
tools that need them. If the DB is empty, those tools report "no test data"
rather than failing — that's not a code bug.
"""
from __future__ import annotations

import time
import traceback
from typing import Any, Optional

from fastapi import APIRouter
from app.tools.db_tools import (
    TOOL_FUNCTIONS, TOOL_REGISTRY, _known_tables, query_one, query,
)

router = APIRouter(prefix="/ai", tags=["diagnostics"])


# Args to pass to each tool. Tools needing scheme/package IDs get them
# resolved at runtime from the DB. Tools with no required args use {}.
TOOL_ARGS_TEMPLATE: dict[str, dict] = {
    "find_scheme":             {"query": "scheme", "limit": 3},
    "get_scheme_details":      {"scheme_id": "__FIRST_SCHEME__"},
    "get_scheme_timeline":     {"scheme_id": "__FIRST_SCHEME__", "limit": 5},
    "list_packages":           {"limit": 3},
    "get_progress_status":     {"package_id": "__FIRST_PACKAGE__"},
    "analyze_delays":          {"min_variance_pct": -3},
    "list_open_commitments":   {"urgency": "all", "limit": 3},
    "list_approvals":          {},
    "get_risk_summary":        {},
    "get_correspondence":      {"limit": 3},
    "get_record_notes":        {"limit": 3},
    "compute_s_curve_variance": {"package_id": "__FIRST_PACKAGE__"},
    "get_capex_summary":       {"scheme_id": "__FIRST_SCHEME__"},
    "search_documents":        {"query": "scheme summary", "limit": 3},
    "get_tender_history":      {"package_id": "__FIRST_PACKAGE__"},
    "get_today_dashboard":     {},
}


# Tables/views the AI tools query. Used for schema completeness check.
EXPECTED_TABLES = [
    # Core
    "scheme_master", "packages",
    # Stage tables
    "scheme_formulation", "scheme_stage1", "scheme_tender",
    "scheme_stage2", "scheme_order", "completion_details",
    # Tender + contract
    "tender_cycles", "contracts",
    # Plans + actuals
    "progress_plans", "plan_activities", "monthly_plan_entries",
    "plant_progress_monthly", "daily_actuals",
    # Capex
    "capex_plan_header", "capex_plan_rows",
    "capex_plan_values", "capex_month_values",
    # Logs
    "monitoring_log", "audit_log",
]

EXPECTED_VIEWS = [
    "v_active_lifecycle", "v_scheme_portfolio", "v_scheme_timeline",
    "v_package_health", "v_at_risk_packages", "v_open_commitments",
    "v_hub_tiers",
]

# Tables the AI service was originally built for but that don't exist in this
# schema. Listed here so the diagnostic can call them out as "not configured"
# rather than "missing — broken".
OPTIONAL_TABLES = [
    "ad_hoc_approvals", "scheme_correspondence", "record_notes",
    "documents", "document_chunks", "document_embeddings",
    "risk_indicators", "forecast_snapshots",
]


def _safe_preview(result: Any, max_chars: int = 400) -> str:
    try:
        s = str(result)
    except Exception:
        s = repr(result)
    if len(s) > max_chars:
        s = s[:max_chars] + "..."
    return s


def _classify(result: Any) -> str:
    """Decide if a tool result is ok / degraded / error."""
    if not isinstance(result, dict):
        return "ok"
    if "error" in result:
        if result["error"] == "data_source_not_available":
            return "degraded"
        return "error"
    return "ok"


def _resolve_args(args: dict, first_scheme_id: Optional[int],
                  first_package_id: Optional[int]) -> Optional[dict]:
    """Replace placeholder strings with real ids, or return None to skip."""
    out: dict[str, Any] = {}
    for k, v in args.items():
        if v == "__FIRST_SCHEME__":
            if first_scheme_id is None:
                return None
            out[k] = first_scheme_id
        elif v == "__FIRST_PACKAGE__":
            if first_package_id is None:
                return None
            out[k] = first_package_id
        else:
            out[k] = v
    return out


@router.get("/diagnostics")
def diagnostics():
    """Run health checks: DB connectivity, expected tables, every tool."""
    started = time.time()

    # ----- 1. DB connectivity
    db_ok = False
    db_error: Optional[str] = None
    try:
        row = query_one("SELECT 1 AS ok")
        db_ok = row is not None and row.get("ok") == 1
    except Exception as e:
        db_error = f"{type(e).__name__}: {e}"

    # ----- 2. Schema completeness
    known = _known_tables() if db_ok else set()
    schema_status = {
        "expected_tables": {
            name: ("present" if name in known else "MISSING")
            for name in EXPECTED_TABLES
        },
        "expected_views": {
            name: ("present" if name in known else "MISSING")
            for name in EXPECTED_VIEWS
        },
        "optional_tables_not_present": [
            name for name in OPTIONAL_TABLES if name not in known
        ],
        "missing_required_count":
            sum(1 for n in EXPECTED_TABLES + EXPECTED_VIEWS if n not in known),
    }

    # ----- 3. Resolve sample ids for tools that need them
    first_scheme_id: Optional[int] = None
    first_package_id: Optional[int] = None
    if db_ok and "scheme_master" in known:
        try:
            r = query_one("""
                SELECT scheme_id FROM scheme_master
                WHERE NOT is_deleted
                ORDER BY scheme_id LIMIT 1
            """)
            first_scheme_id = r["scheme_id"] if r else None
        except Exception:
            pass
    if db_ok and "packages" in known:
        try:
            r = query_one("""
                SELECT package_id FROM packages
                WHERE NOT is_deleted
                ORDER BY package_id LIMIT 1
            """)
            first_package_id = r["package_id"] if r else None
        except Exception:
            pass

    # ----- 4. Run every registered tool
    tool_results: list[dict] = []
    summary_counts = {"ok": 0, "degraded": 0, "error": 0, "skipped": 0}
    for tool_meta in TOOL_REGISTRY:
        name = tool_meta["name"]
        template = TOOL_ARGS_TEMPLATE.get(name, {})
        args = _resolve_args(template, first_scheme_id, first_package_id)
        if args is None:
            tool_results.append({
                "tool": name,
                "status": "skipped",
                "reason": "No test data (DB has no schemes/packages)",
            })
            summary_counts["skipped"] += 1
            continue

        t0 = time.time()
        try:
            fn = TOOL_FUNCTIONS[name]
            result = fn(**args) if args else fn()
            status = _classify(result)
            entry = {
                "tool": name,
                "status": status,
                "args_used": args,
                "latency_ms": int((time.time() - t0) * 1000),
                "result_preview": _safe_preview(result),
            }
            if status == "degraded":
                entry["missing"] = result.get("missing_tables")
        except Exception as e:
            status = "error"
            entry = {
                "tool": name,
                "status": status,
                "args_used": args,
                "latency_ms": int((time.time() - t0) * 1000),
                "error_type": type(e).__name__,
                "error_message": str(e),
                "traceback_preview": traceback.format_exc().splitlines()[-5:],
            }
        summary_counts[status] = summary_counts.get(status, 0) + 1
        tool_results.append(entry)

    # ----- 5. Overall verdict
    total = len(tool_results)
    verdict = "ok"
    if summary_counts["error"] > 0:
        verdict = "errors_present"
    elif summary_counts["ok"] == 0 and total > 0:
        verdict = "no_tools_returning_data"
    elif summary_counts["degraded"] > total / 2:
        verdict = "mostly_degraded"

    return {
        "verdict": verdict,
        "summary": summary_counts,
        "total_tools": total,
        "latency_ms_total": int((time.time() - started) * 1000),
        "db": {
            "reachable": db_ok,
            "error": db_error,
            "sample_scheme_id": first_scheme_id,
            "sample_package_id": first_package_id,
        },
        "schema": schema_status,
        "tools": tool_results,
        "guidance": _guidance(verdict, schema_status, summary_counts),
    }


def _guidance(verdict: str, schema: dict, counts: dict) -> list[str]:
    """Plain-English hints based on what's wrong."""
    tips: list[str] = []
    missing_views = [n for n, v in schema["expected_views"].items() if v == "MISSING"]
    missing_tables = [n for n, v in schema["expected_tables"].items() if v == "MISSING"]
    if missing_views:
        tips.append(
            "Missing views: " + ", ".join(missing_views) + ". "
            "Run migration migrations/2026_05_21_ai_views.sql."
        )
    if missing_tables:
        tips.append(
            "Missing tables: " + ", ".join(missing_tables) + ". "
            "These need to be created before the AI can read related data."
        )
    if counts["error"] > 0:
        tips.append(
            f"{counts['error']} tools threw exceptions — check `tools[].error_message` "
            "below for SQL errors (most likely a column name mismatch)."
        )
    if counts["degraded"] > 0:
        tips.append(
            f"{counts['degraded']} tools returned 'data_source_not_available'. "
            "Their source tables aren't in this schema. The AI will tell users "
            "this data isn't configured rather than fabricating answers."
        )
    if not tips:
        tips.append("Everything looks healthy. Tool-calling chat should work.")
    return tips
