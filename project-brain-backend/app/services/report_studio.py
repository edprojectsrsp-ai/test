"""Report Studio semantic layer.

A curated set of *datasets* (safe pre-joined views over the live schema), each
exposing labelled dimensions (group-by / filter fields) and measures (numeric,
aggregatable fields). A structured query — dimensions + measures + computed
formulas + nested AND/OR filters — is compiled here to a single parameterized
SQL statement. Identifiers are whitelisted against the registry; values are
always bound parameters; computed formulas are parsed with Python's `ast` and
re-emitted as SQL (division wrapped in NULLIF to avoid divide-by-zero). No raw
user SQL is ever executed — this is the same "semantic layer" approach used by
Power BI / Metabase, adapted to Project Brain's schema.
"""
from __future__ import annotations

import ast
from typing import Any, Optional

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
#  Dataset registry                                                           #
# --------------------------------------------------------------------------- #
# Each dataset:
#   base        : FROM ... JOIN ... (+ a WHERE fragment scoping soft-deletes)
#   dimensions  : key -> {label, sql, type}          groupable / filterable
#   measures    : key -> {label, sql, agg, type}      aggregatable numerics
#
# SQL fragments reference the aliases declared in `base`. They are trusted
# (author-written), never user input.

_STATUS_CASE = (
    "CASE WHEN pa.actual_finish_date IS NOT NULL THEN 'Completed' "
    "WHEN pa.actual_start_date IS NOT NULL THEN 'In Progress' "
    "WHEN pa.planned_start_date > CURRENT_DATE THEN 'Not Started' "
    "ELSE 'Due / Not Started' END"
)

DATASETS: dict[str, dict[str, Any]] = {
    "schemes": {
        "label": "Schemes",
        "base": "FROM scheme_master s WHERE NOT COALESCE(s.is_deleted, FALSE)",
        "dimensions": {
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_code": {"label": "Scheme Code", "sql": "s.scheme_code", "type": "text"},
            "status": {"label": "Status", "sql": "s.current_status", "type": "text"},
            "scheme_type": {"label": "Type", "sql": "s.scheme_type", "type": "text"},
            "owner": {"label": "Owner", "sql": "s.scheme_owner_name", "type": "text"},
            "planned_completion": {"label": "Planned Completion", "sql": "s.planned_completion_date", "type": "date"},
            "actual_completion": {"label": "Actual Completion", "sql": "s.actual_completion_date", "type": "date"},
            "completion_fy": {"label": "Planned Completion FY",
                              "sql": "CASE WHEN EXTRACT(MONTH FROM s.planned_completion_date) >= 4 "
                                     "THEN EXTRACT(YEAR FROM s.planned_completion_date) "
                                     "ELSE EXTRACT(YEAR FROM s.planned_completion_date) - 1 END", "type": "int"},
            "multi_package": {"label": "Multi-Package", "sql": "s.has_multiple_packages", "type": "bool"},
        },
        "measures": {
            "scheme_count": {"label": "# Schemes", "sql": "s.scheme_id", "agg": "count_distinct", "type": "int"},
            "estimated_cost": {"label": "Estimated Cost (Cr)", "sql": "s.estimated_cost_cr", "agg": "sum", "type": "money"},
            "sanctioned_cost": {"label": "Sanctioned Cost (Cr)", "sql": "s.sanctioned_cost_cr", "agg": "sum", "type": "money"},
            "anticipated_cost": {"label": "Anticipated Cost (Cr)", "sql": "s.anticipated_cost_cr", "agg": "sum", "type": "money"},
        },
    },
    "packages": {
        "label": "Packages",
        "base": ("FROM packages pk "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "WHERE NOT COALESCE(pk.is_deleted, FALSE)"),
        "dimensions": {
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "package_code": {"label": "Package Code", "sql": "pk.package_code", "type": "text"},
            "package_status": {"label": "Package Status", "sql": "pk.package_status", "type": "text"},
            "package_type": {"label": "Package Type", "sql": "pk.package_type", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
            "executing_agency": {"label": "Executing Agency", "sql": "pk.executing_agency", "type": "text"},
            "pmc": {"label": "Consultant / PMC", "sql": "pk.consultant_pmc", "type": "text"},
            "project_manager": {"label": "Project Manager", "sql": "pk.project_manager_name", "type": "text"},
            "site_location": {"label": "Site Location", "sql": "pk.site_location", "type": "text"},
            "planned_end": {"label": "Planned End", "sql": "pk.planned_end_date", "type": "date"},
        },
        "measures": {
            "package_count": {"label": "# Packages", "sql": "pk.package_id", "agg": "count_distinct", "type": "int"},
            "package_value": {"label": "Package Value (Cr)", "sql": "pk.package_value_cr", "agg": "sum", "type": "money"},
            "package_estimate": {"label": "Package Estimate (Cr)", "sql": "pk.package_estimate_cr", "agg": "sum", "type": "money"},
        },
    },
    "activities": {
        "label": "Plan Activities",
        "base": ("FROM plan_activities pa "
                 "JOIN progress_plans pp ON pp.plan_id = pa.plan_id "
                 "JOIN packages pk ON pk.package_id = pp.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "LEFT JOIN uom_master um ON um.uom_id = pa.uom_id "
                 "WHERE NOT COALESCE(pa.is_deleted, FALSE) AND NOT COALESCE(pp.is_deleted, FALSE)"),
        "dimensions": {
            "activity_name": {"label": "Activity", "sql": "pa.activity_name", "type": "text"},
            "category": {"label": "Category", "sql": "pa.activity_category", "type": "text"},
            "status": {"label": "Status", "sql": _STATUS_CASE, "type": "text"},
            "uom": {"label": "UoM", "sql": "um.uom_code", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "plan_name": {"label": "Plan", "sql": "pp.plan_name", "type": "text"},
            "financial_year": {"label": "Financial Year", "sql": "pp.financial_year", "type": "text"},
            "is_current_plan": {"label": "Current Plan?", "sql": "pp.is_current", "type": "bool"},
            "is_locked_plan": {"label": "Locked Plan?", "sql": "pp.is_locked", "type": "bool"},
            "planned_start": {"label": "Planned Start", "sql": "pa.planned_start_date", "type": "date"},
            "planned_finish": {"label": "Planned Finish", "sql": "pa.planned_finish_date", "type": "date"},
            "actual_start": {"label": "Actual Start", "sql": "pa.actual_start_date", "type": "date"},
            "actual_finish": {"label": "Actual Finish", "sql": "pa.actual_finish_date", "type": "date"},
        },
        "measures": {
            "activity_count": {"label": "# Activities", "sql": "pa.activity_id", "agg": "count_distinct", "type": "int"},
            "scope_qty": {"label": "Scope Qty", "sql": "pa.scope_qty", "agg": "sum", "type": "number"},
            "weight_pct": {"label": "Weight %", "sql": "pa.weight_pct", "agg": "sum", "type": "number"},
            "avg_weight": {"label": "Avg Weight %", "sql": "pa.weight_pct", "agg": "avg", "type": "number"},
            "completed_count": {"label": "# Completed",
                                "sql": "CASE WHEN pa.actual_finish_date IS NOT NULL THEN 1 END",
                                "agg": "count", "type": "int"},
            "slip_days": {"label": "Total Slip (days)",
                          "sql": "GREATEST(COALESCE(pa.actual_finish_date, pa.expected_finish_date) "
                                 "- pa.planned_finish_date, 0)", "agg": "sum", "type": "number"},
        },
    },
    "actuals": {
        "label": "Daily Actuals (DPR)",
        "base": ("FROM daily_actuals da "
                 "JOIN plan_activities pa ON pa.activity_id = da.activity_id "
                 "JOIN progress_plans pp ON pp.plan_id = pa.plan_id "
                 "JOIN packages pk ON pk.package_id = pp.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "WHERE NOT COALESCE(pa.is_deleted, FALSE)"),
        "dimensions": {
            "actual_date": {"label": "Date", "sql": "da.actual_date", "type": "date"},
            "actual_month": {"label": "Month", "sql": "date_trunc('month', da.actual_date)::date", "type": "date"},
            "entered_via": {"label": "Entered Via", "sql": "da.entered_via", "type": "text"},
            "area_of_work": {"label": "Area of Work", "sql": "da.area_of_work", "type": "text"},
            "activity_name": {"label": "Activity", "sql": "pa.activity_name", "type": "text"},
            "category": {"label": "Category", "sql": "pa.activity_category", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
        },
        "measures": {
            "entry_count": {"label": "# Entries", "sql": "da.daily_actual_id", "agg": "count", "type": "int"},
            "actual_qty": {"label": "Actual Qty", "sql": "da.actual_qty", "agg": "sum", "type": "number"},
            "manpower": {"label": "Manpower (sum)", "sql": "da.manpower_count", "agg": "sum", "type": "int"},
            "avg_manpower": {"label": "Avg Manpower", "sql": "da.manpower_count", "agg": "avg", "type": "number"},
            "active_days": {"label": "# Active Days", "sql": "da.actual_date", "agg": "count_distinct", "type": "int"},
        },
    },
    "delays": {
        "label": "Delay Events",
        "base": ("FROM delay_events de "
                 "JOIN scheme_master s ON s.scheme_id = de.scheme_id"),
        "dimensions": {
            "event_name": {"label": "Event", "sql": "de.name", "type": "text"},
            "party": {"label": "Party", "sql": "de.party", "type": "text"},
            "cause": {"label": "Cause", "sql": "de.cause_label", "type": "text"},
            "source": {"label": "Source", "sql": "de.source", "type": "text"},
            "excusable": {"label": "Excusable?", "sql": "de.is_excusable", "type": "bool"},
            "compensable": {"label": "Compensable?", "sql": "de.is_compensable", "type": "bool"},
            "at_date": {"label": "Date", "sql": "de.at_date", "type": "date"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
        },
        "measures": {
            "event_count": {"label": "# Events", "sql": "de.event_id", "agg": "count", "type": "int"},
            "delay_days": {"label": "Total Delay (days)", "sql": "de.delay_days", "agg": "sum", "type": "number"},
            "avg_delay_days": {"label": "Avg Delay (days)", "sql": "de.delay_days", "agg": "avg", "type": "number"},
            "max_delay_days": {"label": "Max Delay (days)", "sql": "de.delay_days", "agg": "max", "type": "number"},
        },
    },
    "capex": {
        "label": "CAPEX",
        "base": ("FROM capex_plan_rows cr "
                 "JOIN scheme_master s ON s.scheme_id = cr.scheme_id "
                 "LEFT JOIN capex_plan_values cv ON cv.plan_row_id = cr.id"),
        "dimensions": {
            "row_name": {"label": "CAPEX Head", "sql": "cr.row_name", "type": "text"},
            "row_level": {"label": "Level", "sql": "cr.row_level", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
        },
        "measures": {
            "gross_cost": {"label": "Gross Cost (Cr)", "sql": "cv.gross_cost", "agg": "sum", "type": "money"},
            "exp_till_last_fy": {"label": "Exp Till Last FY (Cr)", "sql": "cv.cumulative_exp_till_last_fy", "agg": "sum", "type": "money"},
            "be_fy": {"label": "BE This FY (Cr)", "sql": "cv.be_fy", "agg": "sum", "type": "money"},
            "re_fy": {"label": "RE This FY (Cr)", "sql": "cv.re_fy", "agg": "sum", "type": "money"},
        },
    },
    "contracts": {
        "label": "Contracts",
        "base": ("FROM contracts ct "
                 "JOIN packages pk ON pk.package_id = ct.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "WHERE NOT COALESCE(ct.is_deleted, FALSE)"),
        "dimensions": {
            "contract_no": {"label": "Contract No", "sql": "ct.contract_no", "type": "text"},
            "contractor": {"label": "Contractor", "sql": "ct.contractor_name", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "effective_date": {"label": "Effective Date", "sql": "ct.effective_date", "type": "date"},
            "completion_date": {"label": "Sched. Completion", "sql": "ct.schedule_completion_date", "type": "date"},
        },
        "measures": {
            "contract_count": {"label": "# Contracts", "sql": "ct.contract_id", "agg": "count", "type": "int"},
            "contract_value": {"label": "Contract Value (Cr)", "sql": "ct.contract_value_cr", "agg": "sum", "type": "money"},
            "avg_duration": {"label": "Avg Duration (months)", "sql": "ct.contract_duration_months", "agg": "avg", "type": "number"},
        },
    },
    "documents": {
        "label": "Document Vault",
        "base": ("FROM documents d "
                 "LEFT JOIN scheme_master s ON s.scheme_id = d.scheme_id "
                 "WHERE NOT COALESCE(d.is_deleted, FALSE)"),
        "dimensions": {
            "title": {"label": "Title", "sql": "d.title", "type": "text"},
            "document_type": {"label": "Type", "sql": "d.document_type", "type": "text"},
            "ingest_channel": {"label": "Ingest Channel", "sql": "d.ingest_channel", "type": "text"},
            "embedding_status": {"label": "Embedding Status", "sql": "d.embedding_status", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "COALESCE(s.scheme_name, 'Portfolio (unscoped)')", "type": "text"},
            "document_date": {"label": "Doc Date", "sql": "d.document_date", "type": "date"},
        },
        "measures": {
            "doc_count": {"label": "# Documents", "sql": "d.document_id", "agg": "count", "type": "int"},
            "total_pages": {"label": "Total Pages", "sql": "d.page_count", "agg": "sum", "type": "int"},
            "total_chunks": {"label": "Total Chunks", "sql": "d.chunk_count", "agg": "sum", "type": "int"},
        },
    },
}

AGGS = {
    "sum": "SUM", "avg": "AVG", "min": "MIN", "max": "MAX", "count": "COUNT",
    "count_distinct": "COUNT_DISTINCT",  # special-cased in _agg_sql
}

OPERATORS = {
    "=", "!=", ">", ">=", "<", "<=", "in", "not_in",
    "contains", "starts_with", "between", "is_null", "not_null", "is_true", "is_false",
}


# --------------------------------------------------------------------------- #
#  Request models                                                             #
# --------------------------------------------------------------------------- #
class MeasureSpec(BaseModel):
    field: str                       # measure key in the dataset
    agg: Optional[str] = None        # override the registry default agg
    alias: Optional[str] = None      # output column name


class ComputedSpec(BaseModel):
    alias: str
    expression: str                  # arithmetic over measure keys, e.g. "completed_count/activity_count*100"


class Condition(BaseModel):
    field: str                       # a dimension key (filters apply pre-aggregation)
    op: str
    value: Any = None


class FilterGroup(BaseModel):
    op: str = "AND"                  # AND | OR
    conditions: list[Condition] = Field(default_factory=list)
    groups: list["FilterGroup"] = Field(default_factory=list)


class SortSpec(BaseModel):
    by: str                          # an output alias
    dir: str = "desc"                # asc | desc


class QueryIn(BaseModel):
    dataset: str
    dimensions: list[str] = Field(default_factory=list)
    measures: list[MeasureSpec] = Field(default_factory=list)
    computed: list[ComputedSpec] = Field(default_factory=list)
    filters: Optional[FilterGroup] = None
    sort: list[SortSpec] = Field(default_factory=list)
    limit: int = 500


FilterGroup.model_rebuild()


# --------------------------------------------------------------------------- #
#  Compiler                                                                    #
# --------------------------------------------------------------------------- #
class CompileError(ValueError):
    pass


def _ds(dataset: str) -> dict[str, Any]:
    ds = DATASETS.get(dataset)
    if not ds:
        raise CompileError(f"Unknown dataset '{dataset}'")
    return ds


def _agg_sql(agg: str, inner: str) -> str:
    if agg == "count_distinct":
        return f"COUNT(DISTINCT {inner})"
    fn = AGGS.get(agg)
    if not fn:
        raise CompileError(f"Unknown aggregation '{agg}'")
    return f"{fn}({inner})"


def _measure_agg_sql(ds: dict[str, Any], key: str, override_agg: Optional[str] = None) -> str:
    m = ds["measures"].get(key)
    if not m:
        raise CompileError(f"Unknown measure '{key}'")
    agg = override_agg or m["agg"]
    if agg not in AGGS:
        raise CompileError(f"Invalid aggregation '{agg}'")
    return _agg_sql(agg, m["sql"])


def _compile_computed(ds: dict[str, Any], expression: str) -> str:
    """Parse an arithmetic formula over measure keys and emit aggregate SQL.

    Only names that are measure keys, numbers, + - * / and parentheses are
    allowed. Every division's denominator is wrapped in NULLIF(...,0).
    """
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        raise CompileError(f"Invalid expression: {e}")

    def emit(node: ast.AST) -> str:
        if isinstance(node, ast.Expression):
            return emit(node.body)
        if isinstance(node, ast.BinOp):
            left, right = emit(node.left), emit(node.right)
            if isinstance(node.op, ast.Add):
                return f"({left} + {right})"
            if isinstance(node.op, ast.Sub):
                return f"({left} - {right})"
            if isinstance(node.op, ast.Mult):
                return f"({left} * {right})"
            if isinstance(node.op, ast.Div):
                return f"({left}::numeric / NULLIF({right}, 0))"
            raise CompileError("Only + - * / are allowed in formulas")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            sign = "-" if isinstance(node.op, ast.USub) else "+"
            return f"({sign}{emit(node.operand)})"
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return str(node.value)
        if isinstance(node, ast.Name):
            if node.id not in ds["measures"]:
                raise CompileError(f"Unknown measure in formula: '{node.id}'")
            return _measure_agg_sql(ds, node.id)
        raise CompileError("Only numbers, measures and + - * / ( ) are allowed in formulas")

    return emit(tree)


def _field_sql(ds: dict[str, Any], key: str) -> str:
    d = ds["dimensions"].get(key)
    if not d:
        raise CompileError(f"Unknown field '{key}'")
    return d["sql"]


def _quote_alias(alias: str) -> str:
    if not alias or any(c == '"' for c in alias):
        raise CompileError(f"Invalid alias '{alias}'")
    return '"' + alias.replace('\\', '') + '"'


def _compile_filters(ds: dict[str, Any], grp: FilterGroup, params: dict[str, Any]) -> str:
    parts: list[str] = []
    for cond in grp.conditions:
        parts.append(_compile_condition(ds, cond, params))
    for sub in grp.groups:
        s = _compile_filters(ds, sub, params)
        if s:
            parts.append(f"({s})")
    if not parts:
        return ""
    joiner = " OR " if grp.op.upper() == "OR" else " AND "
    return joiner.join(parts)


def _compile_condition(ds: dict[str, Any], cond: Condition, params: dict[str, Any]) -> str:
    col = _field_sql(ds, cond.field)
    op = cond.op
    if op not in OPERATORS:
        raise CompileError(f"Unknown operator '{op}'")
    pname = f"p{len(params)}"

    if op in ("is_null", "not_null"):
        return f"{col} IS {'NULL' if op == 'is_null' else 'NOT NULL'}"
    if op in ("is_true", "is_false"):
        return f"{col} IS {'TRUE' if op == 'is_true' else 'FALSE'}"
    if op in ("in", "not_in"):
        vals = cond.value if isinstance(cond.value, list) else [cond.value]
        params[pname] = vals
        neg = "NOT " if op == "not_in" else ""
        return f"{neg}{col} = ANY(:{pname})"
    if op == "contains":
        params[pname] = f"%{cond.value}%"
        return f"{col}::text ILIKE :{pname}"
    if op == "starts_with":
        params[pname] = f"{cond.value}%"
        return f"{col}::text ILIKE :{pname}"
    if op == "between":
        if not isinstance(cond.value, list) or len(cond.value) != 2:
            raise CompileError("'between' needs [low, high]")
        p1, p2 = f"p{len(params)}", f"p{len(params) + 1}"
        params[p1], params[p2] = cond.value[0], cond.value[1]
        return f"{col} BETWEEN :{p1} AND :{p2}"
    # scalar comparisons
    params[pname] = cond.value
    return f"{col} {op} :{pname}"


def compile_query(q: QueryIn) -> tuple[str, dict[str, Any], list[dict[str, str]]]:
    """Return (sql, params, columns). `columns` is output metadata."""
    ds = _ds(q.dataset)
    if not q.dimensions and not q.measures and not q.computed:
        raise CompileError("Pick at least one dimension, measure or formula")

    select_parts: list[str] = []
    group_parts: list[str] = []
    columns: list[dict[str, str]] = []
    used_aliases: set[str] = set()

    def add_col(alias: str, label: str, ctype: str):
        if alias in used_aliases:
            raise CompileError(f"Duplicate output column '{alias}'")
        used_aliases.add(alias)
        columns.append({"key": alias, "label": label, "type": ctype})

    # dimensions
    for dim in q.dimensions:
        d = ds["dimensions"].get(dim)
        if not d:
            raise CompileError(f"Unknown dimension '{dim}'")
        select_parts.append(f'{d["sql"]} AS {_quote_alias(dim)}')
        group_parts.append(d["sql"])
        add_col(dim, d["label"], d["type"])

    # measures
    for ms in q.measures:
        m = ds["measures"].get(ms.field)
        if not m:
            raise CompileError(f"Unknown measure '{ms.field}'")
        alias = ms.alias or ms.field
        select_parts.append(f"{_measure_agg_sql(ds, ms.field, ms.agg)} AS {_quote_alias(alias)}")
        add_col(alias, m["label"], m["type"])

    # computed formulas
    for cs in q.computed:
        sql = _compile_computed(ds, cs.expression)
        select_parts.append(f"{sql} AS {_quote_alias(cs.alias)}")
        add_col(cs.alias, cs.alias, "number")

    params: dict[str, Any] = {}
    where_extra = ""
    if q.filters:
        where_extra = _compile_filters(ds, q.filters, params)

    base = ds["base"]
    # merge the dataset's own WHERE with user filters
    if where_extra:
        if " WHERE " in base:
            base = base + " AND (" + where_extra + ")"
        else:
            base = base + " WHERE " + where_extra

    sql = "SELECT " + ", ".join(select_parts) + " " + base
    if group_parts:
        sql += " GROUP BY " + ", ".join(group_parts)

    # sort — only by an output alias
    if q.sort:
        order_bits = []
        for s in q.sort:
            if s.by not in used_aliases:
                raise CompileError(f"Cannot sort by '{s.by}' (not an output column)")
            direction = "ASC" if s.dir.lower() == "asc" else "DESC"
            order_bits.append(f"{_quote_alias(s.by)} {direction} NULLS LAST")
        sql += " ORDER BY " + ", ".join(order_bits)
    elif columns:
        # default: first measure/computed desc, else first dimension
        first_measure = next((c["key"] for c in columns if c["type"] in ("int", "number", "money")), None)
        sql += f" ORDER BY {_quote_alias(first_measure or columns[0]['key'])} DESC NULLS LAST"

    limit = max(1, min(int(q.limit or 500), 5000))
    sql += f" LIMIT {limit}"
    return sql, params, columns


def registry_public() -> list[dict[str, Any]]:
    """Registry shaped for the UI — no raw SQL exposed."""
    out = []
    for key, ds in DATASETS.items():
        out.append({
            "key": key,
            "label": ds["label"],
            "dimensions": [{"key": k, "label": v["label"], "type": v["type"]}
                           for k, v in ds["dimensions"].items()],
            "measures": [{"key": k, "label": v["label"], "type": v["type"], "default_agg": v["agg"]}
                         for k, v in ds["measures"].items()],
        })
    return out
