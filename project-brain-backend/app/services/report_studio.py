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

# Apr-1 of the current financial year, computed in SQL so every dataset that
# talks about "this FY" agrees with the MoS reports.
_FY_START_SQL = "(date_trunc('year', CURRENT_DATE - INTERVAL '3 months') + INTERVAL '3 months')::date"

# month_no in capex_month_values is the CALENDAR month (Apr=4 .. Mar=3).
_MONTH_LABEL_CASE = (
    "CASE cmv.month_no WHEN 1 THEN 'Jan' WHEN 2 THEN 'Feb' WHEN 3 THEN 'Mar' "
    "WHEN 4 THEN 'Apr' WHEN 5 THEN 'May' WHEN 6 THEN 'Jun' WHEN 7 THEN 'Jul' "
    "WHEN 8 THEN 'Aug' WHEN 9 THEN 'Sep' WHEN 10 THEN 'Oct' WHEN 11 THEN 'Nov' "
    "WHEN 12 THEN 'Dec' END"
)
_QUARTER_CASE = (
    "CASE WHEN cmv.month_no IN (4,5,6) THEN 'Q1' WHEN cmv.month_no IN (7,8,9) THEN 'Q2' "
    "WHEN cmv.month_no IN (10,11,12) THEN 'Q3' ELSE 'Q4' END"
)

_STATUS_CASE = (
    "CASE WHEN pa.actual_finish_date IS NOT NULL THEN 'Completed' "
    "WHEN pa.actual_start_date IS NOT NULL THEN 'In Progress' "
    "WHEN pa.planned_start_date > CURRENT_DATE THEN 'Not Started' "
    "ELSE 'Due / Not Started' END"
)


def _fy_month_label(col: str) -> str:
    """Apr/May/.../Mar label for any date column — pivot-friendly."""
    return f"TRIM(to_char({col}, 'Mon'))"


def _fy_quarter(col: str) -> str:
    return (f"CASE WHEN EXTRACT(MONTH FROM {col}) IN (4,5,6) THEN 'Q1' "
            f"WHEN EXTRACT(MONTH FROM {col}) IN (7,8,9) THEN 'Q2' "
            f"WHEN EXTRACT(MONTH FROM {col}) IN (10,11,12) THEN 'Q3' ELSE 'Q4' END")


def _fy_year(col: str) -> str:
    return (f"CASE WHEN EXTRACT(MONTH FROM {col}) >= 4 THEN EXTRACT(YEAR FROM {col})::int "
            f"ELSE EXTRACT(YEAR FROM {col})::int - 1 END")

DATASETS: dict[str, dict[str, Any]] = {
    "mos_capex_summary_reference": {
        "label": "MoS CAPEX Summary Reference",
        "base": ("FROM (VALUES "
                 "(1,'1a','Being implemented from last FY',28::numeric,5628.55::numeric,1078.77::numeric,1483.00::numeric,630.01::numeric,1708.78::numeric,'i. Ontime-37\\nii. Delay<1-11\\niii. Delay>1-4'), "
                 "(2,'1b','Implementation started during FY24-25',24::numeric,183.80::numeric,0.00::numeric,33.30::numeric,0.01::numeric,0.01::numeric,''), "
                 "(3,'1','Total Ongoing projects (1a+1b)',52::numeric,5812.35::numeric,1078.77::numeric,1516.30::numeric,630.02::numeric,1708.79::numeric,''), "
                 "(4,'2','Milestone payments in completed projects',NULL::numeric,NULL::numeric,NULL::numeric,288.51::numeric,172.31::numeric,172.31::numeric,''), "
                 "(5,'3a','New Projects under tendering/ final approval and contract award',15::numeric,440.13::numeric,0.74::numeric,10.40::numeric,0.00::numeric,0.74::numeric,''), "
                 "(6,'3b','New Projects under Stage-I approval',4::numeric,249.87::numeric,0.00::numeric,0.00::numeric,0.00::numeric,0.00::numeric,''), "
                 "(7,'3','Total New projects under consideration (3a+3b)',19.00::numeric,690.00::numeric,0.74::numeric,10.40::numeric,0.00::numeric,0.74::numeric,''), "
                 "(8,'4','Spares & Capital Repairs',NULL::numeric,NULL::numeric,NULL::numeric,334.80::numeric,2.20::numeric,2.20::numeric,''), "
                 "(9,'5','Other schemes/ JVs',NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,''), "
                 "(10,'','Total',71.00::numeric,6502.35::numeric,1079.51::numeric,2150.01::numeric,804.53::numeric,1884.04::numeric,'') "
                 ") AS mf(row_order, sn, category, project_count, total_cost, exp_upto_last_fy, capex_re, exp_current_fy, total_exp, delay_profile) "
                 "WHERE TRUE"),
        "dimensions": {
            "__row_order": {"label": "", "sql": "mf.row_order", "type": "int"},
            "sn": {"label": "S. N.", "sql": "mf.sn", "type": "text"},
            "category": {"label": "Category", "sql": "mf.category", "type": "text"},
            "project_count": {"label": "Total no. of Projects", "sql": "mf.project_count", "type": "number"},
            "total_cost": {"label": "Total cost of Projects (Rs cr.)", "sql": "mf.total_cost", "type": "money"},
            "exp_upto_last_fy": {"label": "Expenditure incurred up to FY24-25 (Rs cr.)", "sql": "mf.exp_upto_last_fy", "type": "money"},
            "capex_re": {"label": "CAPEX for FY 25-26 (RE) (Rs cr.)", "sql": "mf.capex_re", "type": "money"},
            "exp_current_fy": {"label": "Expenditure in FY25-26 till Mar'26 (Rs cr.)", "sql": "mf.exp_current_fy", "type": "money"},
            "total_exp": {"label": "Total Expenditure (Rs cr.)", "sql": "mf.total_exp", "type": "money"},
            "delay_profile": {"label": "No. of projects: i. On time ii. Delayed up to 01 year iii. Delayed more than 01 year", "sql": "mf.delay_profile", "type": "text"},
        },
        "measures": {},
    },
    "mos_capex_summary_calculated": {
        "label": "MoS CAPEX Summary Calculated",
        "base": ("FROM (WITH rollup(row_order, drilldown_key, sn, category, leaf_key, blank_cost_cols) AS (VALUES "
                 "(1,'1a','1a','Being implemented from last FY','r6',false),"
                 "(1,'1a','1a','Being implemented from last FY','r7',false),"
                 "(1,'1a','1a','Being implemented from last FY','r8',false),"
                 "(1,'1a','1a','Being implemented from last FY','r10',false),"
                 "(1,'1a','1a','Being implemented from last FY','r11',false),"
                 "(1,'1a','1a','Being implemented from last FY','r12',false),"
                 "(2,'1b','1b','Implementation started during FY24-25','r15',false),"
                 "(2,'1b','1b','Implementation started during FY24-25','r16',false),"
                 "(2,'1b','1b','Implementation started during FY24-25','r17',false),"
                 "(2,'1b','1b','Implementation started during FY24-25','r19',false),"
                 "(2,'1b','1b','Implementation started during FY24-25','r20',false),"
                 "(2,'1b','1b','Implementation started during FY24-25','r21',false),"
                 "(3,'1','1','Total Ongoing projects (1a+1b)','r23',false),"
                 "(3,'1','1','Total Ongoing projects (1a+1b)','r24',false),"
                 "(3,'1','1','Total Ongoing projects (1a+1b)','r25',false),"
                 "(4,'2','2','Milestone payments in completed projects','r26',true),"
                 "(5,'3a','3a','New Projects under tendering/ final approval and contract award','r39',false),"
                 "(5,'3a','3a','New Projects under tendering/ final approval and contract award','r40',false),"
                 "(5,'3a','3a','New Projects under tendering/ final approval and contract award','r41',false),"
                 "(6,'3b','3b','New Projects under Stage-I approval','r43',false),"
                 "(6,'3b','3b','New Projects under Stage-I approval','r44',false),"
                 "(6,'3b','3b','New Projects under Stage-I approval','r45',false),"
                 "(6,'3b','3b','New Projects under Stage-I approval','r46',false),"
                 "(6,'3b','3b','New Projects under Stage-I approval','r47',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r39',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r40',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r41',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r43',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r44',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r45',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r46',false),"
                 "(7,'3','3','Total New projects under consideration (3a+3b)','r47',false),"
                 "(8,'4','4','Spares & Capital Repairs','r49',true),"
                 "(9,'5','5','Other schemes/ JVs','r50',true),"
                 "(10,'total','','Total','r23',false),"
                 "(10,'total','','Total','r24',false),"
                 "(10,'total','','Total','r25',false),"
                 "(10,'total','','Total','r26',false),"
                 "(10,'total','','Total','r39',false),"
                 "(10,'total','','Total','r40',false),"
                 "(10,'total','','Total','r41',false),"
                 "(10,'total','','Total','r43',false),"
                 "(10,'total','','Total','r44',false),"
                 "(10,'total','','Total','r45',false),"
                 "(10,'total','','Total','r46',false),"
                 "(10,'total','','Total','r47',false),"
                 "(10,'total','','Total','r49',false)"
                 "), grouped AS ("
                 " SELECT r.row_order, r.drilldown_key, r.sn, r.category, bool_or(r.blank_cost_cols) AS blank_cost_cols,"
                 "        SUM(s.project_count) AS project_count, SUM(s.total_cost) AS total_cost,"
                 "        SUM(s.exp_upto_last_fy) AS exp_upto_last_fy, SUM(s.capex_re) AS capex_re,"
                 "        SUM(s.exp_current_fy) AS exp_current_fy, SUM(s.total_exp) AS total_exp"
                 " FROM rollup r JOIN mos_capex_source_rows s ON s.row_key = r.leaf_key"
                 " WHERE s.report_key = 'fy25_26_mos_capex'"
                 " GROUP BY r.row_order, r.drilldown_key, r.sn, r.category"
                 "), delay AS ("
                 " SELECT 'i. Ontime-' || COALESCE(MAX(project_count) FILTER (WHERE row_key='r23'),0)::text || E'\\n' ||"
                 "        'ii. Delay<1-' || COALESCE(MAX(project_count) FILTER (WHERE row_key='r24'),0)::text || E'\\n' ||"
                 "        'iii. Delay>1-' || COALESCE(MAX(project_count) FILTER (WHERE row_key='r25'),0)::text AS txt"
                 " FROM mos_capex_source_rows WHERE report_key = 'fy25_26_mos_capex'"
                 ") SELECT row_order, drilldown_key, sn, category,"
                 "        project_count,"
                 "        CASE WHEN blank_cost_cols THEN NULL ELSE total_cost END AS total_cost,"
                 "        CASE WHEN blank_cost_cols THEN NULL ELSE exp_upto_last_fy END AS exp_upto_last_fy,"
                 "        capex_re, exp_current_fy, total_exp,"
                 "        CASE WHEN row_order = 1 THEN (SELECT txt FROM delay) ELSE '' END AS delay_profile"
                 " FROM grouped) mf WHERE TRUE"),
        "dimensions": {
            "__row_order": {"label": "", "sql": "mf.row_order", "type": "int"},
            "__drilldown_key": {"label": "", "sql": "mf.drilldown_key", "type": "text"},
            "sn": {"label": "S. N.", "sql": "mf.sn", "type": "text"},
            "category": {"label": "Category", "sql": "mf.category", "type": "text"},
            "project_count": {"label": "Total no. of Projects", "sql": "mf.project_count", "type": "number"},
            "total_cost": {"label": "Total cost of Projects (Rs cr.)", "sql": "mf.total_cost", "type": "money"},
            "exp_upto_last_fy": {"label": "Expenditure incurred up to FY24-25 (Rs cr.)", "sql": "mf.exp_upto_last_fy", "type": "money"},
            "capex_re": {"label": "CAPEX for FY 25-26 (RE) (Rs cr.)", "sql": "mf.capex_re", "type": "money"},
            "exp_current_fy": {"label": "Expenditure in FY25-26 till Mar'26 (Rs cr.)", "sql": "mf.exp_current_fy", "type": "money"},
            "total_exp": {"label": "Total Expenditure (Rs cr.)", "sql": "mf.total_exp", "type": "money"},
            "delay_profile": {"label": "No. of projects: i. On time ii. Delayed up to 01 year iii. Delayed more than 01 year", "sql": "mf.delay_profile", "type": "text"},
        },
        "measures": {},
    },
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
    "capex_monthly": {
        "label": "CAPEX Monthly (BE/RE/Actual)",
        "base": ("FROM capex_month_values cmv "
                 "JOIN capex_plan_rows cpr ON cpr.id = cmv.plan_row_id "
                 "JOIN capex_plan_header cph ON cph.id = cpr.plan_id "
                 "LEFT JOIN scheme_master s ON s.scheme_id = cpr.scheme_id "
                 "WHERE cph.plan_status != 'Archived'"),
        "dimensions": {
            "row_name": {"label": "CAPEX Head / Scheme Row", "sql": "cpr.row_name", "type": "text"},
            "row_level": {"label": "Row Level", "sql": "cpr.row_level", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "COALESCE(s.scheme_name, cpr.row_name)", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
            "fy_year": {"label": "Financial Year", "sql": "cph.fy_year", "type": "text"},
            "month_no": {"label": "Month No (calendar)", "sql": "cmv.month_no", "type": "int"},
            "month_label": {"label": "Month", "sql": _MONTH_LABEL_CASE, "type": "text"},
            "quarter": {"label": "Quarter (FY)", "sql": _QUARTER_CASE, "type": "text"},
        },
        "measures": {
            "be": {"label": "BE (Cr)", "sql": "COALESCE(cmv.be_amount, 0)", "agg": "sum", "type": "money"},
            "re": {"label": "RE (Cr)", "sql": "COALESCE(cmv.re_amount, 0)", "agg": "sum", "type": "money"},
            "actual": {"label": "Actual (Cr)", "sql": "COALESCE(cmv.actual_amount, 0)", "agg": "sum", "type": "money"},
            "row_count": {"label": "# Rows", "sql": "cmv.plan_row_id", "agg": "count_distinct", "type": "int"},
        },
    },
    "physical_monthly": {
        "label": "Physical Progress Monthly",
        # one row per activity-month with plan qty and actual qty side by side;
        # weighted % measures roll up to package/scheme physical progress.
        "base": ("FROM (SELECT activity_id, month_date, SUM(COALESCE(planned_qty, 0)) AS plan_qty, "
                 "             0::numeric AS actual_qty "
                 "      FROM monthly_plan_entries GROUP BY activity_id, month_date "
                 "      UNION ALL "
                 "      SELECT activity_id, date_trunc('month', actual_date)::date, 0::numeric, "
                 "             SUM(COALESCE(actual_qty, 0)) "
                 "      FROM daily_actuals GROUP BY activity_id, date_trunc('month', actual_date)::date) pm "
                 "JOIN plan_activities pa ON pa.activity_id = pm.activity_id "
                 "JOIN progress_plans pp ON pp.plan_id = pa.plan_id "
                 "JOIN packages pk ON pk.package_id = pp.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "WHERE NOT COALESCE(pa.is_deleted, FALSE) AND NOT COALESCE(pp.is_deleted, FALSE) "
                 "AND pp.is_current"),
        "dimensions": {
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "activity_name": {"label": "Activity", "sql": "pa.activity_name", "type": "text"},
            "category": {"label": "Category", "sql": "pa.activity_category", "type": "text"},
            "month_date": {"label": "Month Date", "sql": "pm.month_date", "type": "date"},
            "month_label": {"label": "Month", "sql": "TRIM(to_char(pm.month_date, 'Mon'))", "type": "text"},
            "quarter": {"label": "Quarter (FY)",
                        "sql": "CASE WHEN EXTRACT(MONTH FROM pm.month_date) IN (4,5,6) THEN 'Q1' "
                               "WHEN EXTRACT(MONTH FROM pm.month_date) IN (7,8,9) THEN 'Q2' "
                               "WHEN EXTRACT(MONTH FROM pm.month_date) IN (10,11,12) THEN 'Q3' ELSE 'Q4' END",
                        "type": "text"},
            "fy": {"label": "Financial Year",
                   "sql": "CASE WHEN EXTRACT(MONTH FROM pm.month_date) >= 4 "
                          "THEN EXTRACT(YEAR FROM pm.month_date)::int ELSE EXTRACT(YEAR FROM pm.month_date)::int - 1 END",
                   "type": "int"},
            "is_locked_plan": {"label": "Locked Plan?", "sql": "pp.is_locked", "type": "bool"},
        },
        "measures": {
            "plan_qty": {"label": "Plan Qty", "sql": "pm.plan_qty", "agg": "sum", "type": "number"},
            "actual_qty": {"label": "Actual Qty", "sql": "pm.actual_qty", "agg": "sum", "type": "number"},
            "plan_pct_w": {"label": "Weighted Plan %",
                           "sql": "pm.plan_qty / NULLIF(pa.scope_qty, 0) * COALESCE(pa.weight_pct, 0)",
                           "agg": "sum", "type": "number"},
            "actual_pct_w": {"label": "Weighted Actual %",
                             "sql": "pm.actual_qty / NULLIF(pa.scope_qty, 0) * COALESCE(pa.weight_pct, 0)",
                             "agg": "sum", "type": "number"},
        },
    },
    "pf_projects": {
        "label": "Physical–Financial Projects",
        # One row per (non-dropped) scheme with the full MoS physical-financial
        # picture pre-joined: CAPEX plan financials, FY actuals, approval /
        # award / completion dates, delay bucket, MoS category, cost band and
        # weighted physical progress (till last FY / FY plan / FY actual).
        "base": ("FROM (SELECT s.scheme_id, s.scheme_name, s.scheme_type::text AS scheme_type, "
                 "             s.current_status::text AS current_status, "
                 "             s.last_status_remark, "
                 "             COALESCE(NULLIF(f.gross, 0), s.estimated_cost_cr, 0) AS gross, "
                 "             COALESCE(f.last_fy, 0) AS exp_last_fy, COALESCE(f.be_fy, 0) AS be_fy, "
                 "             COALESCE(f.re_fy, 0) AS re_fy, COALESCE(f.actual_fy, 0) AS actual_fy, "
                 "             d.pkg_start, d.pkg_end, "
                 "             m.approval_date, m.award_date, m.sched_completion, m.expected_completion, "
                 "             ph.phys_last_fy, ph.phys_fy_plan, ph.phys_fy_actual, "
                 "             CASE WHEN s.current_status IN ('ongoing','on_hold') "
                 "                       AND (d.pkg_start IS NULL OR d.pkg_start < " + _FY_START_SQL + ") "
                 "                  THEN '1a. Being implemented from last FY' "
                 "                  WHEN s.current_status IN ('ongoing','on_hold') "
                 "                  THEN '1b. Implementation started during FY' "
                 "                  WHEN s.current_status = 'closed' "
                 "                  THEN '2. Completed (milestone payments)' "
                 "                  WHEN s.current_status IN ('under_tendering','under_stage2') "
                 "                  THEN '3a. New - under tendering / award' "
                 "                  WHEN s.current_status IN ('under_formulation','under_stage1') "
                 "                  THEN '3b. New - under Stage-I approval' "
                 "                  ELSE '4. Other' END AS mos_category, "
                 "             CASE WHEN COALESCE(NULLIF(f.gross, 0), s.estimated_cost_cr, 0) >= 50 "
                 "                       OR COALESCE(NULLIF(f.gross, 0), s.estimated_cost_cr, 0) = 0 "
                 "                  THEN 'A. Projects >= Rs 50 Cr' ELSE 'B. Projects < Rs 50 Cr' END AS cost_band, "
                 "             CASE WHEN d.pkg_end IS NULL OR d.pkg_end >= CURRENT_DATE THEN 'On Time' "
                 "                  WHEN CURRENT_DATE - d.pkg_end <= 365 THEN 'Delay < 1 Yr' "
                 "                  ELSE 'Delay > 1 Yr' END AS delay_bucket "
                 "      FROM scheme_master s "
                 "      LEFT JOIN (SELECT cpr.scheme_id, SUM(COALESCE(cpv.gross_cost, 0)) AS gross, "
                 "                        SUM(COALESCE(cpv.cumulative_exp_till_last_fy, 0)) AS last_fy, "
                 "                        SUM(COALESCE(cpv.be_fy, 0)) AS be_fy, "
                 "                        SUM(COALESCE(cpv.re_fy, 0)) AS re_fy, "
                 "                        SUM(COALESCE(mv.actual, 0)) AS actual_fy "
                 "                 FROM capex_plan_rows cpr "
                 "                 JOIN capex_plan_header cph ON cph.id = cpr.plan_id "
                 "                      AND cph.plan_status != 'Archived' "
                 "                 LEFT JOIN capex_plan_values cpv ON cpv.plan_row_id = cpr.id "
                 "                 LEFT JOIN (SELECT plan_row_id, SUM(COALESCE(actual_amount, 0)) AS actual "
                 "                            FROM capex_month_values GROUP BY plan_row_id) mv "
                 "                        ON mv.plan_row_id = cpr.id "
                 "                 WHERE cpr.scheme_id IS NOT NULL AND cpr.row_level IN ('Item', 'Package') "
                 "                 GROUP BY cpr.scheme_id) f ON f.scheme_id = s.scheme_id "
                 "      LEFT JOIN (SELECT scheme_id, MIN(planned_start_date) AS pkg_start, "
                 "                        MAX(planned_end_date) AS pkg_end "
                 "                 FROM packages WHERE NOT is_deleted GROUP BY scheme_id) d "
                 "             ON d.scheme_id = s.scheme_id "
                 "      LEFT JOIN LATERAL (SELECT COALESCE(st2.sanction_date, st1.sanction_date) AS approval_date, "
                 "                                COALESCE(c.effective_date, c.loa_date, st2.order_date) AS award_date, "
                 "                                c.schedule_completion_date AS sched_completion, "
                 "                                c.expected_completion_date AS expected_completion "
                 "                         FROM (SELECT 1) one "
                 "                         LEFT JOIN LATERAL (SELECT sanction_date, order_date FROM stage2_approvals "
                 "                                            WHERE scheme_id = s.scheme_id AND is_current AND NOT is_deleted "
                 "                                            ORDER BY revision_no DESC LIMIT 1) st2 ON TRUE "
                 "                         LEFT JOIN LATERAL (SELECT sanction_date FROM stage1_approvals "
                 "                                            WHERE scheme_id = s.scheme_id AND is_current AND NOT is_deleted "
                 "                                            ORDER BY revision_no DESC LIMIT 1) st1 ON TRUE "
                 "                         LEFT JOIN LATERAL (SELECT c2.effective_date, c2.loa_date, "
                 "                                                   c2.schedule_completion_date, c2.expected_completion_date "
                 "                                            FROM contracts c2 "
                 "                                            JOIN packages p2 ON p2.package_id = c2.package_id "
                 "                                            WHERE p2.scheme_id = s.scheme_id AND c2.is_active AND NOT c2.is_deleted "
                 "                                            ORDER BY c2.contract_value_cr DESC NULLS LAST, "
                 "                                                     c2.effective_date ASC NULLS LAST LIMIT 1) c ON TRUE) m ON TRUE "
                 "      LEFT JOIN (SELECT p2.scheme_id, "
                 "                        SUM(COALESCE(pa.actuals_till_last_fy, 0) / NULLIF(pa.scope_qty, 0) "
                 "                            * COALESCE(pa.weight_pct, 0)) AS phys_last_fy, "
                 "                        SUM(COALESCE(mp.fy_plan, 0) / NULLIF(pa.scope_qty, 0) "
                 "                            * COALESCE(pa.weight_pct, 0)) AS phys_fy_plan, "
                 "                        SUM(COALESCE(daf.fy_actual, 0) / NULLIF(pa.scope_qty, 0) "
                 "                            * COALESCE(pa.weight_pct, 0)) AS phys_fy_actual "
                 "                 FROM plan_activities pa "
                 "                 JOIN progress_plans pp2 ON pp2.plan_id = pa.plan_id "
                 "                      AND pp2.is_current AND NOT COALESCE(pp2.is_deleted, FALSE) "
                 "                 JOIN packages p2 ON p2.package_id = pp2.package_id "
                 "                 LEFT JOIN (SELECT activity_id, SUM(COALESCE(planned_qty, 0)) AS fy_plan "
                 "                            FROM monthly_plan_entries "
                 "                            WHERE month_date >= " + _FY_START_SQL + " "
                 "                            GROUP BY activity_id) mp ON mp.activity_id = pa.activity_id "
                 "                 LEFT JOIN (SELECT activity_id, SUM(COALESCE(actual_qty, 0)) AS fy_actual "
                 "                            FROM daily_actuals "
                 "                            WHERE actual_date >= " + _FY_START_SQL + " "
                 "                            GROUP BY activity_id) daf ON daf.activity_id = pa.activity_id "
                 "                 WHERE NOT COALESCE(pa.is_deleted, FALSE) "
                 "                 GROUP BY p2.scheme_id) ph ON ph.scheme_id = s.scheme_id "
                 "      WHERE NOT COALESCE(s.is_deleted, FALSE) AND s.current_status != 'dropped') pf "
                 "WHERE TRUE"),
        "dimensions": {
            "scheme_name": {"label": "Project / Scheme", "sql": "pf.scheme_name", "type": "text"},
            "status": {"label": "Status", "sql": "pf.current_status", "type": "text"},
            "scheme_type": {"label": "Type", "sql": "pf.scheme_type", "type": "text"},
            "mos_category": {"label": "MoS Category", "sql": "pf.mos_category", "type": "text"},
            "cost_band": {"label": "Cost Band (₹50 Cr)", "sql": "pf.cost_band", "type": "text"},
            "delay_bucket": {"label": "Delay Bucket", "sql": "pf.delay_bucket", "type": "text"},
            "approval_date": {"label": "Approval Date", "sql": "pf.approval_date", "type": "date"},
            "award_date": {"label": "Award Date", "sql": "pf.award_date", "type": "date"},
            "original_completion": {"label": "Original Completion",
                                    "sql": "COALESCE(pf.sched_completion, pf.pkg_end)", "type": "date"},
            "anticipated_completion": {"label": "Anticipated Completion",
                                       "sql": "COALESCE(pf.expected_completion, pf.sched_completion, pf.pkg_end)",
                                       "type": "date"},
            "reason": {"label": "Reasons of Delay / Remark", "sql": "pf.last_status_remark", "type": "text"},
        },
        "measures": {
            "project_count": {"label": "# Projects", "sql": "pf.scheme_id", "agg": "count_distinct", "type": "int"},
            "gross": {"label": "Total Cost (Cr)", "sql": "pf.gross", "agg": "sum", "type": "money"},
            "exp_last_fy": {"label": "Exp till last FY (Cr)", "sql": "pf.exp_last_fy", "agg": "sum", "type": "money"},
            "be_fy": {"label": "CAPEX BE this FY (Cr)", "sql": "pf.be_fy", "agg": "sum", "type": "money"},
            "re_fy": {"label": "CAPEX RE this FY (Cr)", "sql": "pf.re_fy", "agg": "sum", "type": "money"},
            "actual_fy": {"label": "Exp this FY (Cr)", "sql": "pf.actual_fy", "agg": "sum", "type": "money"},
            "total_exp": {"label": "Cumulative Exp (Cr)", "sql": "pf.exp_last_fy + pf.actual_fy", "agg": "sum", "type": "money"},
            "phys_last_fy": {"label": "Physical % till last FY", "sql": "COALESCE(pf.phys_last_fy, 0)", "agg": "avg", "type": "number"},
            "phys_fy_plan": {"label": "Physical % FY plan", "sql": "COALESCE(pf.phys_fy_plan, 0)", "agg": "avg", "type": "number"},
            "phys_fy_actual": {"label": "Physical % FY actual", "sql": "COALESCE(pf.phys_fy_actual, 0)", "agg": "avg", "type": "number"},
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
    "plant_progress": {
        "label": "Plant Progress (Monthly)",
        "base": ("FROM plant_progress_monthly ppm "
                 "JOIN packages pk ON pk.package_id = ppm.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "WHERE NOT COALESCE(pk.is_deleted, FALSE)"),
        "dimensions": {
            "month_date": {"label": "Month Date", "sql": "ppm.month_date", "type": "date"},
            "month_label": {"label": "Month", "sql": _fy_month_label("ppm.month_date"), "type": "text"},
            "quarter": {"label": "Quarter (FY)", "sql": _fy_quarter("ppm.month_date"), "type": "text"},
            "fy": {"label": "Financial Year", "sql": _fy_year("ppm.month_date"), "type": "int"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
            "risk_level": {"label": "Risk Level", "sql": "ppm.risk_level", "type": "text"},
        },
        "measures": {
            "entry_count": {"label": "# Entries", "sql": "ppm.progress_id", "agg": "count", "type": "int"},
            "planned_pct": {"label": "Planned % (month)", "sql": "ppm.planned_progress_pct", "agg": "sum", "type": "number"},
            "actual_pct": {"label": "Actual % (month)", "sql": "ppm.actual_progress_pct", "agg": "sum", "type": "number"},
            "cum_planned_pct": {"label": "Cumulative Planned %", "sql": "ppm.cumulative_planned_pct", "agg": "max", "type": "number"},
            "cum_actual_pct": {"label": "Cumulative Actual %", "sql": "ppm.cumulative_actual_pct", "agg": "max", "type": "number"},
            "variance_pct": {"label": "Variance %", "sql": "ppm.variance_pct", "agg": "avg", "type": "number"},
        },
    },
    "monthly_plan": {
        "label": "Monthly Plan Entries",
        "base": ("FROM monthly_plan_entries mpe "
                 "JOIN plan_activities pa ON pa.activity_id = mpe.activity_id "
                 "JOIN progress_plans pp ON pp.plan_id = pa.plan_id "
                 "JOIN packages pk ON pk.package_id = pp.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "WHERE NOT COALESCE(pa.is_deleted, FALSE) AND NOT COALESCE(pp.is_deleted, FALSE)"),
        "dimensions": {
            "month_date": {"label": "Month Date", "sql": "mpe.month_date", "type": "date"},
            "month_label": {"label": "Month", "sql": _fy_month_label("mpe.month_date"), "type": "text"},
            "quarter": {"label": "Quarter (FY)", "sql": _fy_quarter("mpe.month_date"), "type": "text"},
            "fy": {"label": "Financial Year", "sql": _fy_year("mpe.month_date"), "type": "int"},
            "row_type": {"label": "Row Type", "sql": "mpe.row_type", "type": "text"},
            "activity_name": {"label": "Activity", "sql": "pa.activity_name", "type": "text"},
            "category": {"label": "Category", "sql": "pa.activity_category", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "plan_name": {"label": "Plan", "sql": "pp.plan_name", "type": "text"},
            "financial_year": {"label": "Plan FY", "sql": "pp.financial_year", "type": "text"},
            "is_current_plan": {"label": "Current Plan?", "sql": "pp.is_current", "type": "bool"},
            "is_locked_plan": {"label": "Locked Plan?", "sql": "pp.is_locked", "type": "bool"},
        },
        "measures": {
            "entry_count": {"label": "# Entries", "sql": "mpe.monthly_entry_id", "agg": "count", "type": "int"},
            "planned_qty": {"label": "Planned Qty", "sql": "mpe.planned_qty", "agg": "sum", "type": "number"},
        },
    },
    "stage1": {
        "label": "Stage-I Approvals",
        "base": ("FROM stage1_approvals st1 "
                 "JOIN scheme_master s ON s.scheme_id = st1.scheme_id "
                 "WHERE NOT COALESCE(st1.is_deleted, FALSE)"),
        "dimensions": {
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
            "revision_label": {"label": "Revision", "sql": "st1.revision_label", "type": "text"},
            "is_current": {"label": "Current Revision?", "sql": "st1.is_current", "type": "bool"},
            "sanction_date": {"label": "Sanction Date", "sql": "st1.sanction_date", "type": "date"},
            "sanction_fy": {"label": "Sanction FY", "sql": _fy_year("st1.sanction_date"), "type": "int"},
            "order_date": {"label": "Order Date", "sql": "st1.order_date", "type": "date"},
            "sail_board_date": {"label": "SAIL Board Date", "sql": "st1.sail_board_date", "type": "date"},
            "chairman_approval_date": {"label": "Chairman Approval", "sql": "st1.chairman_approval_date", "type": "date"},
            "cod_date": {"label": "COD Date", "sql": "st1.cod_date", "type": "date"},
        },
        "measures": {
            "approval_count": {"label": "# Approvals", "sql": "st1.stage1_id", "agg": "count", "type": "int"},
            "scheme_count": {"label": "# Schemes", "sql": "st1.scheme_id", "agg": "count_distinct", "type": "int"},
            "cost_gross": {"label": "Gross Cost (Cr)", "sql": "st1.cost_gross_cr", "agg": "sum", "type": "money"},
            "cost_net": {"label": "Net Cost (Cr)", "sql": "st1.cost_net_itc_cr", "agg": "sum", "type": "money"},
            "impl_months": {"label": "Avg Impl. Period (months)", "sql": "st1.implementation_period_months", "agg": "avg", "type": "number"},
            "cod_to_sanction_days": {"label": "Avg COD→Sanction (days)", "sql": "(st1.sanction_date - st1.cod_date)", "agg": "avg", "type": "number"},
        },
    },
    "stage2": {
        "label": "Stage-II Approvals",
        "base": ("FROM stage2_approvals st2 "
                 "JOIN scheme_master s ON s.scheme_id = st2.scheme_id "
                 "WHERE NOT COALESCE(st2.is_deleted, FALSE)"),
        "dimensions": {
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "scheme_status": {"label": "Scheme Status", "sql": "s.current_status", "type": "text"},
            "revision_label": {"label": "Revision", "sql": "st2.revision_label", "type": "text"},
            "is_current": {"label": "Current Revision?", "sql": "st2.is_current", "type": "bool"},
            "sanction_date": {"label": "Sanction Date", "sql": "st2.sanction_date", "type": "date"},
            "sanction_fy": {"label": "Sanction FY", "sql": _fy_year("st2.sanction_date"), "type": "int"},
            "order_date": {"label": "Order Date", "sql": "st2.order_date", "type": "date"},
            "sail_board_date": {"label": "SAIL Board Date", "sql": "st2.sail_board_date", "type": "date"},
            "pag_date": {"label": "PAG Date", "sql": "st2.pag_date", "type": "date"},
        },
        "measures": {
            "approval_count": {"label": "# Approvals", "sql": "st2.stage2_id", "agg": "count", "type": "int"},
            "scheme_count": {"label": "# Schemes", "sql": "st2.scheme_id", "agg": "count_distinct", "type": "int"},
            "firmed_gross": {"label": "Firmed-up Gross (Cr)", "sql": "st2.firmed_up_cost_gross_cr", "agg": "sum", "type": "money"},
            "firmed_net": {"label": "Firmed-up Net (Cr)", "sql": "st2.firmed_up_cost_net_itc_cr", "agg": "sum", "type": "money"},
            "consultant_estimate": {"label": "Consultant Estimate (Cr)", "sql": "st2.consultant_estimate_cr", "agg": "sum", "type": "money"},
            "var_vs_stage1": {"label": "Avg Var vs Stage-I %", "sql": "st2.variance_vs_stage1_pct", "agg": "avg", "type": "number"},
            "var_vs_consultant": {"label": "Avg Var vs Consultant %", "sql": "st2.variance_vs_consultant_pct", "agg": "avg", "type": "number"},
        },
    },
    "billing": {
        "label": "Billing Schedule",
        "base": ("FROM billing_schedules bs "
                 "JOIN packages pk ON pk.package_id = bs.package_id "
                 "JOIN scheme_master s ON s.scheme_id = pk.scheme_id "
                 "LEFT JOIN contracts ct ON ct.contract_id = bs.contract_id "
                 "WHERE NOT COALESCE(bs.is_deleted, FALSE)"),
        "dimensions": {
            "description": {"label": "Milestone", "sql": "bs.description", "type": "text"},
            "milestone_no": {"label": "Milestone No", "sql": "bs.milestone_no", "type": "int"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "contractor": {"label": "Contractor", "sql": "ct.contractor_name", "type": "text"},
            "scheduled_date": {"label": "Scheduled Date", "sql": "bs.scheduled_date", "type": "date"},
            "scheduled_month": {"label": "Scheduled Month", "sql": _fy_month_label("bs.scheduled_date"), "type": "text"},
            "scheduled_fy": {"label": "Scheduled FY", "sql": _fy_year("bs.scheduled_date"), "type": "int"},
            "actual_billed_date": {"label": "Billed Date", "sql": "bs.actual_billed_date", "type": "date"},
            "payment_received_date": {"label": "Payment Date", "sql": "bs.payment_received_date", "type": "date"},
            "is_billed": {"label": "Billed?", "sql": "bs.is_billed", "type": "bool"},
            "is_paid": {"label": "Paid?", "sql": "bs.is_paid", "type": "bool"},
        },
        "measures": {
            "milestone_count": {"label": "# Milestones", "sql": "bs.billing_schedule_id", "agg": "count", "type": "int"},
            "scheduled_amount": {"label": "Scheduled Amount (Cr)", "sql": "bs.scheduled_amount_cr", "agg": "sum", "type": "money"},
            "actual_amount": {"label": "Actual Billed (Cr)", "sql": "bs.actual_amount_cr", "agg": "sum", "type": "money"},
            "billed_count": {"label": "# Billed", "sql": "CASE WHEN bs.is_billed THEN 1 END", "agg": "count", "type": "int"},
            "paid_count": {"label": "# Paid", "sql": "CASE WHEN bs.is_paid THEN 1 END", "agg": "count", "type": "int"},
        },
    },
    "manpower": {
        "label": "Manpower Deployment (DPR)",
        "base": ("FROM daily_progress_manpower dpm "
                 "JOIN scheme_master s ON s.scheme_id = dpm.scheme_id"),
        "dimensions": {
            "report_date": {"label": "Date", "sql": "dpm.report_date", "type": "date"},
            "report_month": {"label": "Month", "sql": _fy_month_label("dpm.report_date"), "type": "text"},
            "report_fy": {"label": "Financial Year", "sql": _fy_year("dpm.report_date"), "type": "int"},
            "section_name": {"label": "Section", "sql": "dpm.section_name", "type": "text"},
            "category_name": {"label": "Category", "sql": "dpm.category_name", "type": "text"},
            "contractor_name": {"label": "Contractor", "sql": "dpm.contractor_name", "type": "text"},
            "role_name": {"label": "Role / Trade", "sql": "dpm.role_name", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
        },
        "measures": {
            "entry_count": {"label": "# Entries", "sql": "dpm.id", "agg": "count", "type": "int"},
            "manpower": {"label": "Manpower (sum)", "sql": "dpm.qty", "agg": "sum", "type": "number"},
            "avg_manpower": {"label": "Avg Manpower", "sql": "dpm.qty", "agg": "avg", "type": "number"},
            "peak_manpower": {"label": "Peak Manpower", "sql": "dpm.qty", "agg": "max", "type": "number"},
            "last_month_avg": {"label": "Avg Last-Month", "sql": "dpm.last_month_average", "agg": "avg", "type": "number"},
            "active_days": {"label": "# Active Days", "sql": "dpm.report_date", "agg": "count_distinct", "type": "int"},
        },
    },
    "appendix2": {
        "label": "Appendix-2 (Baseline Items)",
        "base": ("FROM appendix2_items ai "
                 "JOIN appendix2_revisions ar ON ar.revision_id = ai.revision_id "
                 "JOIN scheme_master s ON s.scheme_id = ar.scheme_id "
                 "LEFT JOIN packages pk ON pk.package_id = ar.package_id "
                 "WHERE NOT COALESCE(ar.is_deleted, FALSE)"),
        "dimensions": {
            "item_name": {"label": "Item / Activity", "sql": "ai.item_name", "type": "text"},
            "category": {"label": "Category", "sql": "ai.category", "type": "text"},
            "s_no": {"label": "S. No", "sql": "ai.s_no", "type": "text"},
            "is_category": {"label": "Is Category?", "sql": "ai.is_category", "type": "bool"},
            "revision_label": {"label": "Revision", "sql": "ar.revision_label", "type": "text"},
            "is_current_rev": {"label": "Current Revision?", "sql": "ar.is_current", "type": "bool"},
            "is_locked_rev": {"label": "Locked Revision?", "sql": "ar.is_locked", "type": "bool"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "schedule_start": {"label": "Schedule Start", "sql": "ai.schedule_start", "type": "date"},
            "schedule_finish": {"label": "Schedule Finish", "sql": "ai.schedule_finish", "type": "date"},
            "source": {"label": "Source", "sql": "ai.source", "type": "text"},
        },
        "measures": {
            "item_count": {"label": "# Items", "sql": "ai.item_id", "agg": "count", "type": "int"},
            "weight_pct": {"label": "Weight %", "sql": "ai.weight_pct", "agg": "sum", "type": "number"},
            "avg_weight": {"label": "Avg Weight %", "sql": "ai.weight_pct", "agg": "avg", "type": "number"},
            "commencement_months": {"label": "Avg Commencement (months)", "sql": "ai.commencement_months", "agg": "avg", "type": "number"},
            "completion_months": {"label": "Avg Completion (months)", "sql": "ai.completion_months", "agg": "avg", "type": "number"},
        },
    },
    "lifecycle": {
        "label": "Lifecycle Events",
        "base": ("FROM lifecycle_events le "
                 "JOIN scheme_master s ON s.scheme_id = le.scheme_id "
                 "LEFT JOIN packages pk ON pk.package_id = le.package_id "
                 "WHERE NOT COALESCE(le.is_deleted, FALSE)"),
        "dimensions": {
            "stage": {"label": "Stage", "sql": "le.stage", "type": "text"},
            "event_type": {"label": "Event Type", "sql": "le.event_type", "type": "text"},
            "event_label": {"label": "Event", "sql": "le.event_label", "type": "text"},
            "event_date": {"label": "Event Date", "sql": "le.event_date", "type": "date"},
            "event_month": {"label": "Event Month", "sql": _fy_month_label("le.event_date"), "type": "text"},
            "event_fy": {"label": "Event FY", "sql": _fy_year("le.event_date"), "type": "int"},
            "party_name": {"label": "Party", "sql": "le.party_name", "type": "text"},
            "scheme_name": {"label": "Scheme", "sql": "s.scheme_name", "type": "text"},
            "package_name": {"label": "Package", "sql": "pk.package_name", "type": "text"},
            "source_table": {"label": "Source Table", "sql": "le.source_table", "type": "text"},
        },
        "measures": {
            "event_count": {"label": "# Events", "sql": "le.event_id", "agg": "count", "type": "int"},
            "scheme_count": {"label": "# Schemes", "sql": "le.scheme_id", "agg": "count_distinct", "type": "int"},
            "cost_cr": {"label": "Cost (Cr)", "sql": "le.cost_cr", "agg": "sum", "type": "money"},
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


class PivotSpec(BaseModel):
    on: str                          # a selected dimension whose values become columns
    values: list[str] = Field(default_factory=list)  # numeric output aliases to spread (default: all)
    row_total: bool = True           # append a Total column per measure
    quarter_totals: bool = False     # for month pivots: insert Q1..Q4 total columns


class QueryIn(BaseModel):
    dataset: str
    dimensions: list[str] = Field(default_factory=list)
    measures: list[MeasureSpec] = Field(default_factory=list)
    computed: list[ComputedSpec] = Field(default_factory=list)
    filters: Optional[FilterGroup] = None
    sort: list[SortSpec] = Field(default_factory=list)
    limit: int = 500
    pivot: Optional[PivotSpec] = None
    grand_total: bool = False        # append a grand-total row (post-pivot)


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

    if q.pivot:
        if q.pivot.on not in q.dimensions:
            raise CompileError(f"Pivot column '{q.pivot.on}' must be one of the selected dimensions")
        numeric_aliases = {c["key"] for c in columns if c["type"] in ("int", "number", "money")}
        for v in q.pivot.values:
            if v not in numeric_aliases:
                raise CompileError(f"Pivot value '{v}' is not a numeric output column")

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


# --------------------------------------------------------------------------- #
#  Post-processing: pivot + totals                                            #
# --------------------------------------------------------------------------- #
FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
_QUARTER_OF = {m: f"Q{i // 3 + 1}" for i, m in enumerate(FY_MONTHS)}
_NUMERIC_TYPES = ("int", "number", "money")


def _order_pivot_values(vals: list[Any]) -> list[Any]:
    svals = [str(v) for v in vals]
    if all(v in FY_MONTHS for v in svals):
        return sorted(vals, key=lambda v: FY_MONTHS.index(str(v)))
    if all(str(v).startswith("Q") and len(str(v)) == 2 for v in svals):
        return sorted(vals, key=str)
    try:
        return sorted(vals)
    except TypeError:
        return vals


def apply_postprocess(q: QueryIn, columns: list[dict[str, str]],
                      rows: list[dict[str, Any]]) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Apply pivot / grand-total to an executed result. Runs on jsonified rows."""
    if q.pivot:
        columns, rows = _apply_pivot(q, columns, rows)
    if q.grand_total and rows:
        total: dict[str, Any] = {}
        labeled = False
        for c in columns:
            if c["type"] in _NUMERIC_TYPES:
                vals = [r.get(c["key"]) for r in rows if isinstance(r.get(c["key"]), (int, float))]
                total[c["key"]] = round(sum(vals), 4) if vals else None
            else:
                total[c["key"]] = "Total" if not labeled else ""
                labeled = True
        total["__total__"] = True
        rows = rows + [total]
    return columns, rows


def _apply_pivot(q: QueryIn, columns: list[dict[str, str]],
                 rows: list[dict[str, Any]]) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    pv = q.pivot
    col_by_key = {c["key"]: c for c in columns}
    if pv.on not in col_by_key:
        return columns, rows
    value_keys = pv.values or [c["key"] for c in columns if c["type"] in _NUMERIC_TYPES]
    key_cols = [c for c in columns if c["key"] != pv.on and c["key"] not in value_keys]

    pvals = _order_pivot_values(list({r.get(pv.on) for r in rows if r.get(pv.on) is not None}))
    multi = len(value_keys) > 1

    def cell_key(pval: Any, vkey: str) -> str:
        return f"{pval}|{vkey}" if multi else str(pval)

    # group rows by the remaining dimensions (order of first appearance)
    groups: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        gk = tuple(r.get(c["key"]) for c in key_cols)
        g = groups.setdefault(gk, {c["key"]: r.get(c["key"]) for c in key_cols})
        for vk in value_keys:
            v = r.get(vk)
            if isinstance(v, (int, float)):
                ck = cell_key(r.get(pv.on), vk)
                g[ck] = round(g.get(ck, 0) + v, 4)

    # single group of measure-rows when there are no remaining dimensions
    no_dims = not key_cols
    out_rows: list[dict[str, Any]]
    out_cols: list[dict[str, str]] = [dict(c) for c in key_cols]
    if no_dims:
        out_cols.append({"key": "__measure__", "label": "Measure", "type": "text"})

    def vlabel(vk: str) -> str:
        return col_by_key.get(vk, {}).get("label", vk)

    months_mode = all(str(p) in FY_MONTHS for p in pvals)
    seq: list[tuple[str, Any]] = []          # (kind, pval-or-quarter)
    if months_mode and pv.quarter_totals:
        for qtr in ("Q1", "Q2", "Q3", "Q4"):
            qmonths = [m for m in pvals if _QUARTER_OF[str(m)] == qtr]
            seq += [("val", m) for m in qmonths]
            if qmonths:
                seq.append(("qtot", qtr))
    else:
        seq = [("val", p) for p in pvals]

    if no_dims:
        # rows = one per measure, columns = pivot values (+ totals)
        for kind, p in seq:
            out_cols.append({"key": f"c|{kind}|{p}", "label": (f"Total {p}" if kind == "qtot" else str(p)),
                             "type": "money"})
        if pv.row_total:
            out_cols.append({"key": "c|total", "label": "Total", "type": "money"})
        g = groups.get((), {})
        out_rows = []
        for vk in value_keys:
            row: dict[str, Any] = {"__measure__": vlabel(vk)}
            running = 0.0
            for kind, p in seq:
                if kind == "val":
                    v = g.get(cell_key(p, vk))
                    row[f"c|val|{p}"] = v
                    if isinstance(v, (int, float)):
                        running += v
                else:
                    qsum = [g.get(cell_key(m, vk)) for m in pvals if _QUARTER_OF[str(m)] == p]
                    nums = [x for x in qsum if isinstance(x, (int, float))]
                    row[f"c|qtot|{p}"] = round(sum(nums), 4) if nums else None
            if pv.row_total:
                row["c|total"] = round(running, 4)
            out_rows.append(row)
        return out_cols, out_rows

    # normal pivot: rows keyed by remaining dims
    for kind, p in seq:
        for vk in value_keys:
            base_label = f"Total {p}" if kind == "qtot" else str(p)
            label = f"{base_label} · {vlabel(vk)}" if multi else base_label
            key = f"{kind}|{p}|{vk}"
            out_cols.append({"key": key, "label": label, "type": col_by_key.get(vk, {}).get("type", "number")})
    if pv.row_total:
        for vk in value_keys:
            out_cols.append({"key": f"total|{vk}",
                             "label": f"Total · {vlabel(vk)}" if multi else "Total", "type": "money"})

    out_rows = []
    for g in groups.values():
        row = {c["key"]: g.get(c["key"]) for c in key_cols}
        for vk in value_keys:
            running = 0.0
            for kind, p in seq:
                if kind == "val":
                    v = g.get(cell_key(p, vk))
                    row[f"val|{p}|{vk}"] = v
                    if isinstance(v, (int, float)):
                        running += v
                else:
                    qsum = [g.get(cell_key(m, vk)) for m in pvals if _QUARTER_OF[str(m)] == p]
                    nums = [x for x in qsum if isinstance(x, (int, float))]
                    row[f"qtot|{p}|{vk}"] = round(sum(nums), 4) if nums else None
            if pv.row_total:
                row[f"total|{vk}"] = round(running, 4)
        out_rows.append(row)
    return out_cols, out_rows


def compile_field_values(dataset: str, field: str, search: Optional[str] = None,
                         limit: int = 200) -> tuple[str, dict[str, Any]]:
    """Compile SQL for the DISTINCT values of one dimension (member picker).

    Powers direct-selection filtering ("pick from the real values"). Identifier
    is whitelisted against the registry; the optional search term is bound.
    """
    ds = _ds(dataset)
    d = ds["dimensions"].get(field)
    if not d:
        raise CompileError(f"Unknown field '{field}'")
    col = d["sql"]
    base = ds["base"]
    params: dict[str, Any] = {}
    where_extra = f"{col} IS NOT NULL"
    if search:
        params["q"] = f"%{search}%"
        where_extra += f" AND {col}::text ILIKE :q"
    if " WHERE " in base:
        base = base + " AND (" + where_extra + ")"
    else:
        base = base + " WHERE " + where_extra
    lim = max(1, min(int(limit or 200), 1000))
    sql = f"SELECT DISTINCT {col} AS v {base} ORDER BY v LIMIT {lim}"
    return sql, params


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
