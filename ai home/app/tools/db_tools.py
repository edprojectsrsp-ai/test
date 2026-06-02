"""
Database tools for the AI assistant.

CRITICAL DESIGN PRINCIPLE: AI never writes SQL.
- All tools have closed enums for entity, column, filter type
- All SQL is parameterized server-side
- AI can only request data shapes the schema supports
- This prevents prompt injection turning into SQL injection
"""
from __future__ import annotations
import os
from typing import Any, Optional
import psycopg2
import psycopg2.extras
from datetime import date, datetime
from dotenv import load_dotenv


# ============================================================================
# DB CONNECTION (read-only by default)
# ============================================================================

load_dotenv()

def get_db_conn():
    """Get a fresh read-only DB connection."""
    dsn = (
        os.environ.get("PROJECT_BRAIN_DB_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain"
    )
    conn = psycopg2.connect(dsn)
    conn.set_session(readonly=True, autocommit=True)
    return conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    """Internal helper. Run a SQL query and return list of dict rows."""
    conn = get_db_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def query_one(sql: str, params: tuple = ()) -> Optional[dict]:
    rows = query(sql, params)
    return rows[0] if rows else None


# ============================================================================
# SCHEMA INTROSPECTION — used to gracefully degrade tools whose source tables
# don't exist in this database (some tools were written for a schema that
# never materialized; rather than crashing, we report "data source not
# available" so the LLM stops fabricating).
# ============================================================================

_TABLE_CACHE: Optional[set[str]] = None


def _known_tables() -> set[str]:
    """List all tables + views in the public schema. Cached after first call."""
    global _TABLE_CACHE
    if _TABLE_CACHE is None:
        try:
            rows = query("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                UNION
                SELECT viewname AS table_name FROM pg_views WHERE schemaname = 'public'
            """)
            _TABLE_CACHE = {r["table_name"] for r in rows}
        except Exception:
            _TABLE_CACHE = set()  # never crash on diagnostics
    return _TABLE_CACHE


def _require_tables(*names: str) -> Optional[dict]:
    """If any of the given tables/views is missing, return a degraded-response
    dict that the LLM can read; otherwise return None (caller proceeds)."""
    known = _known_tables()
    missing = [n for n in names if n not in known]
    if missing:
        return {
            "error": "data_source_not_available",
            "missing_tables": missing,
            "explanation": (
                "This feature requires database tables/views that aren't present "
                "in the current Project Brain schema: " + ", ".join(missing) + ". "
                "The information cannot be retrieved. Do not invent data — tell "
                "the user this data source isn't configured."
            ),
        }
    return None


# ============================================================================
# TOOL REGISTRY — declare every tool here with its JSON schema for the LLM
# ============================================================================

TOOL_REGISTRY: list[dict] = []
TOOL_FUNCTIONS: dict[str, callable] = {}


def register_tool(name: str, description: str, parameters: dict):
    """Decorator to register a tool with the LLM-facing registry."""
    def deco(fn):
        TOOL_REGISTRY.append({"name": name, "description": description, "parameters": parameters})
        TOOL_FUNCTIONS[name] = fn
        return fn
    return deco


# ============================================================================
# TOOLS
# ============================================================================

@register_tool(
    name="find_scheme",
    description="Find a scheme by name (fuzzy match), code, or ID. Returns top matches with key details.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Scheme name, code, or partial name"},
            "limit": {"type": "integer", "description": "Max results (default 5)", "default": 5},
        },
        "required": ["query"],
    },
)
def find_scheme(query: str, limit: int = 5):
    # NB: scheme_code column does not exist in this schema; we search by id
    # (numeric string), name (ILIKE), and trigram similarity.
    rows = globals()["query"]("""
        SELECT scheme_id, scheme_name, scheme_type, current_status,
               estimated_cost_cr, sanctioned_cost_cr, anticipated_cost_cr,
               scheme_owner_name,
               similarity(scheme_name, %s) AS score
        FROM scheme_master
        WHERE NOT is_deleted
          AND (scheme_name ILIKE %s
               OR CAST(scheme_id AS text) = %s
               OR similarity(scheme_name, %s) > 0.2)
        ORDER BY score DESC NULLS LAST
        LIMIT %s
    """, (query, f"%{query}%", query, query, limit))
    return {"matches": rows, "count": len(rows)}


@register_tool(
    name="get_scheme_details",
    description="Get full details of one scheme including current lifecycle stage costs, dates, packages.",
    parameters={
        "type": "object",
        "properties": {"scheme_id": {"type": "integer"}},
        "required": ["scheme_id"],
    },
)
def get_scheme_details(scheme_id: int):
    scheme = query_one("""
        SELECT * FROM v_scheme_portfolio WHERE scheme_id = %s
    """, (scheme_id,))
    if not scheme:
        return {"error": f"Scheme {scheme_id} not found"}
    lifecycle = query_one("""
        SELECT * FROM v_active_lifecycle WHERE scheme_id = %s
    """, (scheme_id,))
    packages = query("""
        SELECT package_id, package_no, package_name, package_status,
               package_value_cr, project_manager_name, is_scheme_mirror
        FROM packages WHERE scheme_id = %s AND NOT is_deleted
        ORDER BY package_no
    """, (scheme_id,))
    return {"scheme": scheme, "lifecycle": lifecycle, "packages": packages}


@register_tool(
    name="get_scheme_timeline",
    description="Get full lifecycle event history for a scheme (chronological). Shows every dated event.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer"},
            "stage": {"type": "string", "enum": ["all", "formulation", "stage1", "tender", "stage2", "order", "closure"], "default": "all"},
            "limit": {"type": "integer", "default": 50},
        },
        "required": ["scheme_id"],
    },
)
def get_scheme_timeline(scheme_id: int, stage: str = "all", limit: int = 50):
    if stage == "all":
        rows = query("""
            SELECT event_id, stage, event_type, event_date, event_label,
                   cost_cr, party_name, package_id, document_id, notes
            FROM v_scheme_timeline
            WHERE scheme_id = %s
            ORDER BY event_date ASC, event_id ASC
            LIMIT %s
        """, (scheme_id, limit))
    else:
        rows = query("""
            SELECT event_id, stage, event_type, event_date, event_label,
                   cost_cr, party_name, package_id, document_id, notes
            FROM v_scheme_timeline
            WHERE scheme_id = %s AND stage = %s
            ORDER BY event_date ASC, event_id ASC
            LIMIT %s
        """, (scheme_id, stage, limit))
    return {"events": rows, "count": len(rows)}


@register_tool(
    name="list_packages",
    description="List packages with optional filters. Use for queries like 'show me all at-risk packages' or 'packages for scheme X'.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer", "description": "Filter by scheme"},
            "status": {"type": "string", "enum": ["planned", "tendering", "awarded", "in_progress", "on_hold", "completed", "closed", "cancelled"]},
            "risk_level": {"type": "string", "enum": ["red", "amber", "green"], "description": "Filter by latest risk"},
            "include_mirrors": {"type": "boolean", "default": False},
            "limit": {"type": "integer", "default": 20},
        },
    },
)
def list_packages(scheme_id: int = None, status: str = None, risk_level: str = None,
                  include_mirrors: bool = False, limit: int = 20):
    conds = ["NOT p.is_deleted"]
    params: list[Any] = []
    if scheme_id is not None:
        conds.append("p.scheme_id = %s"); params.append(scheme_id)
    if status:
        # package_status is a plain VARCHAR with a CHECK constraint, not an enum.
        conds.append("p.package_status = %s"); params.append(status)
    if risk_level:
        # risk_indicators table doesn't exist; use v_at_risk_packages buckets.
        # Map external risk_level → internal bucket: red→severe, amber→amber, green→minor/no_baseline.
        bucket_map = {
            "red": ["severe"],
            "amber": ["amber", "on_hold"],
            "green": ["minor", "no_baseline"],
        }
        buckets = bucket_map.get(risk_level, [])
        if buckets:
            placeholder = ",".join(["%s"] * len(buckets))
            conds.append(f"EXISTS (SELECT 1 FROM v_at_risk_packages vrp "
                         f"WHERE vrp.package_id = p.package_id "
                         f"AND vrp.risk_bucket IN ({placeholder}))")
            params.extend(buckets)
    if not include_mirrors:
        conds.append("NOT p.is_scheme_mirror")
    params.append(limit)
    sql = f"""
        SELECT p.package_id, p.scheme_id, sm.scheme_name,
               p.package_no, p.package_name, p.package_status, p.package_value_cr,
               p.project_manager_name, p.is_scheme_mirror
        FROM packages p JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
        WHERE {' AND '.join(conds)}
        ORDER BY sm.scheme_name, p.package_no
        LIMIT %s
    """
    return {"packages": query(sql, tuple(params))}


@register_tool(
    name="get_progress_status",
    description="Get progress info for a package: planned vs actual %, S-curve, forecast completion.",
    parameters={
        "type": "object",
        "properties": {"package_id": {"type": "integer"}},
        "required": ["package_id"],
    },
)
def get_progress_status(package_id: int):
    pkg = query_one("SELECT * FROM v_package_health WHERE package_id=%s", (package_id,))
    if not pkg:
        return {"error": f"Package {package_id} not found"}
    # In this schema, plant_progress_monthly stores monthly planned/actual and
    # cumulative fields keyed by month_date.
    scurve = query("""
        SELECT month_date,
               planned_progress_pct,
               actual_progress_pct,
               cumulative_planned_pct,
               cumulative_actual_pct,
               variance_pct,
               notes
        FROM plant_progress_monthly
        WHERE package_id=%s
        ORDER BY month_date
    """, (package_id,))
    return {"package": pkg, "s_curve_points": scurve, "data_points_count": len(scurve)}


@register_tool(
    name="analyze_delays",
    description="Identify packages that are behind schedule with reasons. Returns at-risk packages and their indicators.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer", "description": "Optional - filter to one scheme"},
            "min_variance_pct": {"type": "number", "description": "Min negative variance to include (default -3)", "default": -3},
        },
    },
)
def analyze_delays(scheme_id: int = None, min_variance_pct: float = -3):
    conds = ["variance_pct IS NOT NULL", "variance_pct <= %s"]
    params: list[Any] = [min_variance_pct]
    if scheme_id is not None:
        conds.append("scheme_id = %s"); params.append(scheme_id)
    # v_package_health gives us the joined scheme/package row plus computed
    # variance_pct (actual cumulative_progress_pct minus planned from the
    # active plan). monitoring_log gives delay reasons logged by PMs.
    sql = f"""
        SELECT package_id, scheme_id, package_name, scheme_name,
               planned_progress_pct, actual_progress_pct, variance_pct,
               latest_progress_month, project_manager_name, package_status,
                (SELECT array_agg(jsonb_build_object(
                           'occurred_at', ml.occurred_at,
                           'severity', ml.severity,
                           'event_type', ml.event_type,
                           'source', ml.source,
                           'message', ml.message
                       ) ORDER BY ml.occurred_at DESC)
                 FROM monitoring_log ml
                 WHERE ml.occurred_at >= NOW() - INTERVAL '90 days'
                ) AS recent_monitoring_entries
        FROM v_package_health vph
        WHERE {' AND '.join(conds)}
        ORDER BY variance_pct ASC NULLS LAST
        LIMIT 20
    """
    return {"delayed_packages": query(sql, tuple(params))}


@register_tool(
    name="list_open_commitments",
    description="List commitments (delivery/payment/approval) that are open or overdue.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer"},
            "urgency": {"type": "string", "enum": ["overdue", "due_soon", "upcoming", "all"], "default": "all"},
            "limit": {"type": "integer", "default": 50},
        },
    },
)
def list_open_commitments(scheme_id: int = None, urgency: str = "all", limit: int = 50):
    conds = []
    params: list[Any] = []
    if scheme_id is not None:
        conds.append("scheme_id = %s"); params.append(scheme_id)
    if urgency != "all":
        conds.append("urgency = %s"); params.append(urgency)
    where = " WHERE " + " AND ".join(conds) if conds else ""
    params.append(limit)
    sql = f"SELECT * FROM v_open_commitments{where} LIMIT %s"
    return {"commitments": query(sql, tuple(params))}


@register_tool(
    name="list_approvals",
    description="List ad-hoc approvals (deviation/EOT/change-order/price revision). Filter by status.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer"},
            "is_approved": {"type": "boolean", "description": "true=approved, false=rejected, null=pending"},
            "approval_type": {"type": "string"},
        },
    },
)
def list_approvals(scheme_id: int = None, is_approved=None, approval_type: str = None):
    guard = _require_tables("ad_hoc_approvals")
    if guard:
        return guard
    conds = ["NOT is_deleted"]
    params: list[Any] = []
    if scheme_id is not None:
        conds.append("scheme_id = %s"); params.append(scheme_id)
    if is_approved is not None:
        if is_approved:
            conds.append("is_approved = TRUE")
        else:
            conds.append("is_approved = FALSE")
    else:
        # If neither - pending only would mean is_approved IS NULL
        pass
    if approval_type:
        conds.append("approval_type = %s"); params.append(approval_type)
    sql = f"""
        SELECT approval_id, scheme_id, package_id, approval_type, subject, requested_by,
               requested_date, approver_designation, approver_name, approval_date,
               is_approved, cost_impact_cr, time_impact_days
        FROM ad_hoc_approvals WHERE {' AND '.join(conds)}
        ORDER BY requested_date DESC NULLS LAST LIMIT 50
    """
    return {"approvals": query(sql, tuple(params))}


@register_tool(
    name="get_risk_summary",
    description="Get portfolio-wide risk summary: how many red/amber/green packages, top risk rules firing.",
    parameters={"type": "object", "properties": {}},
)
def get_risk_summary():
    # Originally queried risk_indicators (which doesn't exist in this schema).
    # We rebuild the same shape from v_at_risk_packages (created in the
    # 2026_05_21_ai_views.sql migration).
    guard = _require_tables("v_at_risk_packages")
    if guard:
        return guard
    summary = query_one("""
        SELECT
            COUNT(*) AS total,
            COUNT(DISTINCT package_id) AS pkgs,
            COUNT(DISTINCT scheme_id)  AS schemes
        FROM v_at_risk_packages
    """)
    # The "by_rule" breakdown made sense for the old indicator table; here
    # we group by reason category (variance band / on_hold) as a substitute.
    by_rule = query("""
        SELECT
            risk_level::text AS indicator_key,
            risk_level::text AS indicator_label,
            COUNT(*) AS count
        FROM v_at_risk_packages
        GROUP BY risk_level
        ORDER BY count DESC NULLS LAST
    """)
    return {"summary": summary, "by_rule": by_rule}


@register_tool(
    name="get_correspondence",
    description="Get correspondence (letters in/out) for a scheme or package. Used for 'what did contractor say last week?'",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer"},
            "package_id": {"type": "integer"},
            "direction": {"type": "string", "enum": ["in", "out", "any"], "default": "any"},
            "since_date": {"type": "string", "description": "ISO date, eg '2024-01-01'"},
            "limit": {"type": "integer", "default": 20},
        },
    },
)
def get_correspondence(scheme_id: int = None, package_id: int = None,
                       direction: str = "any", since_date: str = None, limit: int = 20):
    guard = _require_tables("scheme_correspondence")
    if guard:
        return guard
    conds = ["NOT is_deleted"]
    params: list[Any] = []
    if scheme_id is not None:
        conds.append("scheme_id = %s"); params.append(scheme_id)
    if package_id is not None:
        conds.append("package_id = %s"); params.append(package_id)
    if direction in ("in", "out"):
        conds.append("direction = %s"); params.append(direction)
    if since_date:
        conds.append("correspondence_date >= %s"); params.append(since_date)
    params.append(limit)
    sql = f"""
        SELECT correspondence_id, scheme_id, package_id, direction, correspondence_no,
               correspondence_date, sender, recipient, subject, summary,
               action_required, action_due_date, action_status, document_id
        FROM scheme_correspondence WHERE {' AND '.join(conds)}
        ORDER BY correspondence_date DESC LIMIT %s
    """
    return {"correspondence": query(sql, tuple(params))}


@register_tool(
    name="get_record_notes",
    description="Get record notes (observations, decisions, instructions, meeting notes) for a scheme.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer"},
            "package_id": {"type": "integer"},
            "note_type": {"type": "string", "enum": ["observation", "decision", "instruction", "meeting_note", "any"], "default": "any"},
            "since_date": {"type": "string"},
            "limit": {"type": "integer", "default": 20},
        },
    },
)
def get_record_notes(scheme_id: int = None, package_id: int = None,
                     note_type: str = "any", since_date: str = None, limit: int = 20):
    # The 'record_notes' table doesn't exist in this schema. The closest
    # equivalent is monitoring_log entries (PM observations / decisions),
    # which we surface instead so the LLM has *something* useful.
    if "record_notes" not in _known_tables():
        if "monitoring_log" not in _known_tables():
            return _require_tables("record_notes")  # both missing → error
        conds = []
        params: list[Any] = []
        if scheme_id is not None:
            conds.append("scheme_id = %s"); params.append(scheme_id)
        if package_id is not None:
            conds.append("package_id = %s"); params.append(package_id)
        if since_date:
            conds.append("log_date >= %s"); params.append(since_date)
        params.append(limit)
        where = (" WHERE " + " AND ".join(conds)) if conds else ""
        sql = f"""
            SELECT log_id AS note_id, scheme_id, package_id,
                   log_date AS note_date,
                   'monitoring_log' AS note_type,
                   COALESCE(reason_for_delay, 'Monitoring entry') AS title,
                   issues AS body,
                   action_taken AS summary,
                   progress_status AS key_points,
                   changed_by_username AS raised_by,
                   NULL AS addressed_to,
                   NULL AS document_id
            FROM monitoring_log
            {where}
            ORDER BY log_date DESC LIMIT %s
        """
        return {
            "notes": query(sql, tuple(params)),
            "note": (
                "Returned from monitoring_log because record_notes table is not "
                "configured. Fields mapped: reason_for_delay → title, issues → body, "
                "action_taken → summary."
            ),
        }
    # If record_notes ever gets added, original code path below works.
    conds = ["NOT is_deleted"]
    params: list[Any] = []
    if scheme_id is not None:
        conds.append("scheme_id = %s"); params.append(scheme_id)
    if package_id is not None:
        conds.append("package_id = %s"); params.append(package_id)
    if note_type != "any":
        conds.append("note_type = %s"); params.append(note_type)
    if since_date:
        conds.append("note_date >= %s"); params.append(since_date)
    params.append(limit)
    sql = f"""
        SELECT note_id, scheme_id, package_id, note_date, note_type, title,
               body, summary, key_points, raised_by, addressed_to, document_id
        FROM record_notes WHERE {' AND '.join(conds)}
        ORDER BY note_date DESC LIMIT %s
    """
    return {"notes": query(sql, tuple(params))}


@register_tool(
    name="compute_s_curve_variance",
    description="Compute schedule variance and trend for a package. Used for 'is this package on track?'",
    parameters={
        "type": "object",
        "properties": {"package_id": {"type": "integer"}},
        "required": ["package_id"],
    },
)
def compute_s_curve_variance(package_id: int):
    # v_package_health already computes planned/actual/variance from the
    # active plan + monthly entries. We rely on it here to avoid duplicating
    # the join logic.
    guard = _require_tables("v_package_health", "plant_progress_monthly")
    if guard:
        return guard

    pkg = query_one("SELECT * FROM v_package_health WHERE package_id=%s", (package_id,))
    if not pkg:
        return {"error": f"Package {package_id} not found"}

    # Series of actuals (planned-per-month would require a separate roll-up
    # from monthly_plan_entries — we surface the active plan summary instead)
    actuals = query("""
        SELECT month_date,
               cumulative_planned_pct,
               cumulative_actual_pct,
               variance_pct,
               notes
        FROM plant_progress_monthly
        WHERE package_id = %s
        ORDER BY month_date
    """, (package_id,))
    if not actuals:
        return {
            "package_id": package_id,
            "data_points": 0,
            "note": "No progress data logged for this package",
            "active_plan": {
                "plan_name": pkg.get("active_plan_name"),
                "financial_year": pkg.get("active_plan_fy"),
                "expected_completion_month": pkg.get("expected_completion_month"),
            },
        }

    latest = actuals[-1]
    return {
        "package_id": package_id,
        "data_points": len(actuals),
        "latest_month": latest["month_date"],
        "current_planned_pct": latest.get("cumulative_planned_pct"),
        "current_actual_pct": latest.get("cumulative_actual_pct"),
        "current_variance_pct": pkg.get("variance_pct"),
        "active_plan": {
            "plan_name": pkg.get("active_plan_name"),
            "financial_year": pkg.get("active_plan_fy"),
            "expected_completion_month": pkg.get("expected_completion_month"),
        },
        "trend_last_3mo": [
            {
                "month": p["month_date"],
                "actual_pct": float(p.get("cumulative_actual_pct") or 0),
            }
            for p in actuals[-3:]
        ],
        # forecast_snapshots table doesn't exist in this schema; the
        # forecasting page (frontend) computes it client-side from the
        # progress series instead.
        "forecast": None,
        "forecast_note": (
            "Forecast is computed client-side in the S-Curve frontend "
            "(linear regression on the actual series), not persisted server-side."
        ),
    }


@register_tool(
    name="get_capex_summary",
    description="Get CAPEX planning vs actuals for a scheme or package. Used for cost analysis questions.",
    parameters={
        "type": "object",
        "properties": {
            "scheme_id": {"type": "integer"},
            "financial_year": {"type": "string", "description": "e.g. '2024-25'"},
        },
        "required": ["scheme_id"],
    },
)
def get_capex_summary(scheme_id: int, financial_year: str = None):
    # The CAPEX plan headers in this schema live in capex_plan_header (one
    # row per plan), with line-item rows in capex_plan_rows and per-month
    # amounts in capex_month_values. There is no scheme_id on the header —
    # the connection to a scheme is via capex_plan_rows.scheme_id. We
    # aggregate live so the LLM sees totals across BE + RE + Actual.
    guard = _require_tables("capex_plan_header", "capex_plan_rows", "capex_month_values")
    if guard:
        return guard

    fy_filter = ""
    params: list[Any] = [scheme_id]
    if financial_year:
        fy_filter = " AND cph.fy_year = %s"
        params.append(financial_year)

    plans = query(f"""
        SELECT
            cph.id AS capex_plan_id,
            cph.fy_year AS financial_year,
            cph.plan_type,
            cph.plan_version,
            cph.plan_status,
            cph.is_effective,
            cph.effective_from_month,
            cph.created_at,
            COALESCE(SUM(cmv.be_amount), 0) AS total_be_cr,
            COALESCE(SUM(cmv.re_amount), 0) AS total_re_cr,
            COALESCE(SUM(cmv.actual_amount), 0) AS total_actual_cr,
            COUNT(DISTINCT cpr.id) AS scheme_row_count
        FROM capex_plan_header cph
        JOIN capex_plan_rows cpr ON cpr.plan_id = cph.id
        LEFT JOIN capex_month_values cmv ON cmv.plan_row_id = cpr.id
        WHERE cpr.scheme_id = %s {fy_filter}
        GROUP BY cph.id
        ORDER BY cph.fy_year DESC, cph.id DESC
    """, tuple(params))
    return {"capex_plans": plans}


@register_tool(
    name="search_documents",
    description="Semantic search across documents (uses pgvector embeddings). Use for 'find documents about X' or 'where is the contract that mentions Y'.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to search for"},
            "scheme_id": {"type": "integer", "description": "Optional - scope to one scheme"},
            "document_type": {"type": "string", "enum": [
                "fr_ts", "dpr", "approval_letter", "contract", "loa", "po", "tender_doc",
                "correspondence_in", "correspondence_out", "record_note", "meeting_minutes",
                "monthly_progress", "site_photo", "drawing", "specification", "test_report",
                "inspection_report", "warranty", "other", "any"], "default": "any"},
            "limit": {"type": "integer", "default": 5},
        },
        "required": ["query"],
    },
)
def search_documents(query: str, scheme_id: int = None, document_type: str = "any", limit: int = 5):
    """Semantic search via embeddings. Embedding generation handled by ingestion service."""
    # Entire RAG pipeline (documents, document_chunks, document_embeddings) is
    # not part of this database's schema. Return a clear degraded response so
    # the LLM stops fabricating document content.
    guard = _require_tables("documents", "document_chunks", "document_embeddings")
    if guard:
        return guard

    # Import here to avoid circular dep
    from app.services.embeddings_service import embed_text
    try:
        vec = embed_text(query)
        if vec is None:
            # Fallback: text search
            return _fallback_text_search(query, scheme_id, document_type, limit)
    except Exception:
        return _fallback_text_search(query, scheme_id, document_type, limit)

    conds = ["NOT d.is_deleted"]
    params: list[Any] = [vec]  # vector first for the operator
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    if document_type != "any":
        conds.append("d.document_type = %s::document_type_enum"); params.append(document_type)
    params.append(limit)
    sql = f"""
        SELECT d.document_id, d.title, d.document_type::text, d.scheme_id, d.package_id,
               d.auto_summary, d.important_points,
               dc.chunk_id, dc.chunk_text, dc.page_number,
               (1 - (de.embedding <=> %s::vector)) AS similarity
        FROM document_embeddings de
        JOIN document_chunks dc ON dc.chunk_id = de.chunk_id
        JOIN documents d ON d.document_id = dc.document_id
        WHERE {' AND '.join(conds)}
        ORDER BY de.embedding <=> %s::vector
        LIMIT %s
    """
    # Need vector twice
    params2 = [vec, *params[1:-1], vec, params[-1]]
    return {"chunks": query_run(sql, tuple(params2))}


def _fallback_text_search(q: str, scheme_id: int = None, document_type: str = "any", limit: int = 5):
    """When embeddings not ready, fall back to trigram match on chunk text."""
    conds = ["NOT d.is_deleted"]
    params: list[Any] = [q]
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    if document_type != "any":
        conds.append("d.document_type = %s::document_type_enum"); params.append(document_type)
    params.append(limit)
    sql = f"""
        SELECT d.document_id, d.title, d.document_type::text, d.scheme_id,
               dc.chunk_id, dc.chunk_text, dc.page_number,
               similarity(dc.chunk_text, %s) AS similarity
        FROM document_chunks dc
        JOIN documents d ON d.document_id = dc.document_id
        WHERE {' AND '.join(conds)} AND dc.chunk_text %% %s
        ORDER BY similarity DESC LIMIT %s
    """
    params_full = [q, *params[1:-1], q, params[-1]]
    return {"chunks": query_run(sql, tuple(params_full)), "fallback": True}


def query_run(sql, params):
    """Same as query() but exposed in case search_documents needs it directly."""
    return query(sql, params)


@register_tool(
    name="get_tender_history",
    description="Get tender cycle history for a package (shows retender, RPN, cancellations).",
    parameters={
        "type": "object",
        "properties": {"package_id": {"type": "integer"}},
        "required": ["package_id"],
    },
)
def get_tender_history(package_id: int):
    # Pull tender_cycles directly (this schema stores rpn_* and values here).
    cycles = query("""
        SELECT tc.tender_cycle_id,
               tc.cycle_no,
               tc.cycle_label,
               tc.cycle_status,
               tc.is_current,
               tc.mode_of_tender,
               tc.nit_number,
               tc.nit_date,
               tc.pre_bid_date,
               tc.tod_original_date,
               tc.offers_received_count,
               tc.bidder_names,
               tc.cancellation_reason,
               tc.cancellation_date,
               tc.remarks,
               tc.rpn_issued,
               tc.rpn_date,
               tc.rpn_reason,
               tc.estimated_value_cr,
               tc.awarded_value_cr
        FROM tender_cycles tc
        WHERE tc.package_id = %s
        ORDER BY tc.cycle_no
    """, (package_id,))
    return {"tender_cycles": cycles, "count": len(cycles)}


@register_tool(
    name="get_today_dashboard",
    description="Get today's portfolio dashboard: counts, top risks, today's commitments due.",
    parameters={"type": "object", "properties": {}},
)
def get_today_dashboard():
    tiers = query("SELECT * FROM v_hub_tiers")
    top_risks = query("""
        SELECT * FROM v_at_risk_packages LIMIT 5
    """)
    due_today = query("""
        SELECT scheme_name, package_name, title, due_date, urgency
        FROM v_open_commitments WHERE urgency IN ('overdue','due_soon') LIMIT 10
    """)
    return {"tiers": tiers, "top_risks": top_risks, "commitments_due": due_today}


# ============================================================================
# DISPATCHER — called by AI orchestrator
# ============================================================================

def call_tool(name: str, arguments: dict) -> dict:
    """Run a tool by name with arguments. Returns result dict or error."""
    if name not in TOOL_FUNCTIONS:
        return {"error": f"Unknown tool: {name}"}
    try:
        fn = TOOL_FUNCTIONS[name]
        result = fn(**arguments) if arguments else fn()
        return _serialize(result)
    except TypeError as e:
        return {"error": f"Bad arguments for {name}: {e}"}
    except Exception as e:
        return {"error": f"Tool {name} failed: {e}"}


def _serialize(obj):
    """Make dates/datetimes JSON-safe."""
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(x) for x in obj]
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if hasattr(obj, "__class__") and obj.__class__.__name__ == "Decimal":
        return float(obj)
    return obj


def get_tools_for_llm() -> list[dict]:
    """Return the full tool registry, ready for LLM."""
    return TOOL_REGISTRY
