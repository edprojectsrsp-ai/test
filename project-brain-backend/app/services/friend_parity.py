"""Canonical compatibility calculations for the imported Friend Project data.

The normalized Project Brain schema intentionally collapses the COB-7 umbrella
and its three leaf packages into one scheme.  Portfolio dashboards, however,
must retain the source application's leaf-project semantics.  This module uses
the immutable ``friend_archive`` tables for source identity/status fields and
the archived effective CAPEX sheet for the exact financial hierarchy.

New operational screens may continue to use normalized scheme/package ids;
portfolio counts and MoS figures use this service so the same fact cannot be
calculated differently by each endpoint.
"""
from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime, timedelta

from sqlalchemy import text

FY_MONTHS = ["Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26",
             "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"]


def _f(value) -> float:
    try:
        value = str(value or "").replace(",", "").strip()
        return float(value) if value else 0.0
    except (TypeError, ValueError):
        return 0.0


def _d(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    value = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%y", "%d-%b-%Y"):
        try:
            return datetime.strptime(value[:11].strip(), fmt).date()
        except ValueError:
            pass
    return None


def _base_status(p: dict) -> str:
    if str(p.get("project_dropped") or "").upper() == "Y":
        return "Project Dropped"
    if str(p.get("commissioned_marked") or "").upper() == "Y":
        return "Commissioned"
    if str(p.get("completion_marked") or "").upper() == "Y":
        return "Complete"
    if str(p.get("stage2_cleared") or "").upper() == "Y":
        return "Ongoing"
    if str(p.get("final_tod_date") or "").strip():
        return "Stage-2"
    if str(p.get("stage1_cleared") or "").upper() == "Y":
        return "Tendering"
    if str(p.get("cod_cleared") or "").upper() == "Y":
        return "Stage-1"
    return "Under Formulation"


def _norm(value) -> str:
    value = str(value or "").strip().lower().replace("-", " ").replace(".", "")
    value = re.sub(r"(\d)(yr|year)", r"\1 \2", value)
    return " ".join(value.split())


def archive_available(db) -> bool:
    return bool(db.execute(text("SELECT to_regclass('friend_archive.projects')")).scalar())


def _capex(db) -> dict:
    row = db.execute(text("""
        SELECT plan_name, financial_year, plan_type, effective_from_month, rows_json
        FROM friend_archive.capex_plans
        ORDER BY effective DESC, updated_at DESC LIMIT 1
    """)).mappings().first()
    if not row:
        return {"financials": {}, "trend": [], "be": 0.0, "re": 0.0,
                "actual": 0.0, "plan_name": "", "plan_type": "BE"}
    rows = row["rows_json"]
    while isinstance(rows, str):
        rows = json.loads(rows)
    rows = rows or []
    by_id = {r.get("row_id"): r for r in rows}
    child_ids = {cid for r in rows for cid in (r.get("children") or [])}

    def value(item, column):
        children = [by_id[c] for c in (item.get("children") or []) if c in by_id]
        if children:
            return sum(value(child, column) for child in children)
        return _f((item.get("values") or {}).get(column))

    financials = {}
    project_types = {int(row.id): row.project_type for row in db.execute(text(
        "SELECT id, project_type FROM friend_archive.projects"
    ))}
    for item in rows:
        try:
            project_id = int(item.get("source_project_id") or 0)
        except (TypeError, ValueError):
            project_id = 0
        if not project_id:
            continue
        values = item.get("values") or {}
        monthly_be = {m: _f(values.get(f"{m} BE")) for m in FY_MONTHS}
        monthly_re = {m: _f(values.get(f"{m} RE")) for m in FY_MONTHS}
        monthly_actual = {m: _f(values.get(f"{m} Actual")) for m in FY_MONTHS}
        financials[project_id] = {
            "gross_cost": _f(values.get("Gross Cost")),
            "expenditure_last_fy": _f(values.get("Cummulative Expenditure till Last FY")),
            "be_current_fy": sum(monthly_be.values()),
            "re_current_fy": sum(monthly_re.values()),
            "actual_current_fy": sum(monthly_actual.values()),
            "monthly_plan": monthly_be,
            "monthly_actual": monthly_actual,
        }
        financials[project_id]["actual_till_date"] = (
            financials[project_id]["expenditure_last_fy"]
            + financials[project_id]["actual_current_fy"]
        )

    top = [r for r in rows if int(r.get("indent") or 0) == 0]
    leaves = [r for r in rows if not (r.get("children") or [])]
    be_total = sum(value(r, "BE (FY)") for r in top)
    re_total = sum(value(r, "RE (FY)") for r in top)
    # Header rows in the source workbook intentionally have blank monthly
    # cells; the friend's dashboard recursively rolls their children up.
    actual_total = sum(value(r, f"{m} Actual") for r in top for m in FY_MONTHS)
    trend = []
    for month in FY_MONTHS:
        be = sum(_f((r.get("values") or {}).get(f"{month} BE")) for r in leaves)
        re_value = sum(_f((r.get("values") or {}).get(f"{month} RE")) for r in leaves)
        actual = sum(_f((r.get("values") or {}).get(f"{month} Actual")) for r in leaves)
        plan = re_value if str(row["plan_type"] or "BE").upper() == "RE" and re_value else be
        def project_rows(metric, total):
            result = []
            for item in leaves:
                values = item.get("values") or {}
                item_be = _f(values.get(f"{month} BE"))
                item_re = _f(values.get(f"{month} RE"))
                item_actual = _f(values.get(f"{month} Actual"))
                contribution = (item_actual if metric == "actual" else
                                item_re if str(row["plan_type"] or "BE").upper() == "RE" and item_re
                                else item_be)
                if contribution <= 0:
                    continue
                try:
                    source_id = int(item.get("source_project_id") or 0)
                except (TypeError, ValueError):
                    source_id = 0
                result.append({
                    "project_name": str(values.get("CAPEX Plan (FY)") or source_id or "").strip(),
                    "project_type": project_types.get(source_id, ""),
                    "gross_cost": round(_f(values.get("Gross Cost")), 2),
                    "plan": round(item_be, 2), "re": round(item_re, 2),
                    "actual": round(item_actual, 2), "amount": round(contribution, 2),
                    "share": round(contribution / total * 100, 2) if total else 0.0,
                })
            return sorted(result, key=lambda item: item["amount"], reverse=True)
        trend.append({"month": month[:3], "be": round(be, 2), "re": round(re_value, 2),
                      "plan": round(plan, 2), "actual": round(actual, 2),
                      "achievement": actual / plan * 100 if plan else 0.0,
                      "planProjects": project_rows("plan", plan),
                      "actualProjects": project_rows("actual", actual)})
    return {
        "financials": financials, "trend": trend,
        "be": round(be_total, 2), "re": round(re_total, 2),
        "actual": round(actual_total, 2), "plan_name": row["plan_name"],
        "plan_type": str(row["plan_type"] or "BE").upper(), "rows": rows,
    }


def _projects(db, as_of: date | None = None) -> list[dict]:
    as_of = as_of or date.today()
    rows = db.execute(text("""
        SELECT p.*, c.status_override AS corporate_status,
               c.expected_completion_date AS corporate_expected_finish,
               c.project_manager, c.executing_agency AS master_executing_agency,
               c.expenditure_upto_last_fy AS corporate_expenditure_last_fy,
               c.be_re_current_fy AS corporate_be_re_current_fy,
               c.actual_cost_current_fy AS corporate_actual_current_fy,
               c.cumulative_cost AS corporate_cumulative_cost,
               d.schedule_start AS plant_start_date,
               d.schedule_start AS amr_start_date, d.at_date AS amr_at_date,
               d.schedule_completion AS amr_finish_date,
               d.anticipated_completion AS amr_expected_finish_date,
               d.completion_date AS plant_completion_date,
               d.completion_date AS amr_completion_date,
               d.amr_status AS plant_status, d.gross_cost AS plant_gross_cost,
               a.schedule_start AS corporate_schedule_start,
               z.schedule_finish AS corporate_schedule_finish
        FROM friend_archive.projects p
        LEFT JOIN friend_archive.corporate_amr_master c ON c.project_id=p.id
        LEFT JOIN friend_archive.plant_level_amr_details d ON d.project_id=p.id
        LEFT JOIN (SELECT project_id,MIN(schedule_start) schedule_start
                   FROM friend_archive.appendix2 WHERE COALESCE(schedule_start,'')<>'' GROUP BY project_id) a ON a.project_id=p.id
        LEFT JOIN (SELECT project_id,MAX(schedule_finish) schedule_finish
                   FROM friend_archive.appendix2 WHERE COALESCE(schedule_finish,'')<>'' GROUP BY project_id) z ON z.project_id=p.id
        WHERE COALESCE(p.project_archived,'N')<>'Y'
        ORDER BY p.id
    """)).mappings().all()
    out = [dict(r) for r in rows]
    parent_ids = {int(p.get("parent_project_id") or 0) for p in out if int(p.get("parent_project_id") or 0)}
    by_id = {int(p["id"]): p for p in out}
    for p in out:
        p["is_parent"] = int(p["id"]) in parent_ids
        parent = by_id.get(int(p.get("parent_project_id") or 0), {})
        p["parent_project_name"] = parent.get("project_name") or ""
        p["project_display_name"] = (f"{p['parent_project_name']} - {p['project_name']}"
                                     if p["parent_project_name"] and p["project_name"] != p["parent_project_name"]
                                     else p.get("project_name") or "")
        p["base_status"] = _base_status(p)
        p["status"] = (str(p.get("plant_status") or "").strip() if p.get("project_type") == "Plant Level AMR"
                       else str(p.get("corporate_status") or "").strip()) or p["base_status"]
        p["completed"] = _is_completed(p)
    return out


def _is_completed(p: dict) -> bool:
    values = " ".join(str(p.get(k) or "") for k in
                      ("status", "base_status", "corporate_status", "plant_status")).lower()
    return (str(p.get("completion_marked") or "").upper() == "Y"
            or str(p.get("commissioned_marked") or "").upper() == "Y"
            or bool(p.get("completion_date")) or bool(p.get("plant_completion_date"))
            or "completed" in values or "commissioned" in values or "complete" in values)


def _cost(p: dict, fin: dict[int, dict]) -> float:
    f = fin.get(int(p.get("id") or 0), {})
    return next((_f(v) for v in (f.get("gross_cost"), p.get("stage2_cost"), p.get("stage1_cost"),
                                  p.get("formulation_cost"), p.get("master_gross_cost"))
                 if v not in (None, "")), 0.0)


def _delay(p: dict, label_long: bool = True) -> str:
    if p.get("project_type") == "Plant Level AMR":
        finish = _d(p.get("amr_finish_date") or p.get("schedule_completion"))
        expected = _d(p.get("amr_expected_finish_date") or p.get("expected_finish") or finish)
    else:
        finish = _d(p.get("schedule_completion") or p.get("corporate_schedule_finish"))
        expected = _d(p.get("expected_finish") or p.get("corporate_expected_finish") or finish)
    if not finish or not expected:
        return ""
    days = (expected - finish).days
    if days > 365:
        return "Delay > 1 Year" if label_long else "Delay > 1 Yr."
    if days > 0:
        return "Delay < 1 Year" if label_long else "Delay < 1 Yr."
    return "On Time"


def _implementation_start(p: dict):
    if p.get("project_type") == "Plant Level AMR":
        return _d(p.get("plant_start_date"))
    return (_d(p.get("corporate_schedule_start")) or _d(p.get("effective_date"))
            or _d(p.get("stage2_date")) or _d(p.get("registration_date")))


def dashboard_model(db, as_of: date | None = None) -> dict:
    as_of = as_of or date.today()
    cap = _capex(db)
    fin = cap["financials"]
    projects = _projects(db, as_of)
    leaves = [p for p in projects if not p["is_parent"]]
    fy_start = date(as_of.year if as_of.month >= 4 else as_of.year - 1, 4, 1)
    fy_end = date(fy_start.year + 1, 3, 31)
    ongoing_labels = {"ongoing", "on time", "delay < 1 yr", "delay < 1 year",
                      "delay > 1 yr", "delay > 1 year"}

    corp = [p for p in leaves if p.get("project_type") == "Corporate AMR"]
    plant = [p for p in leaves if p.get("project_type") == "Plant Level AMR"]
    corp_active = [p for p in corp if _norm(p.get("status")) in ongoing_labels and not p["completed"]]

    # Plant dashboard status uses its own schedule/expected/completion fields.
    plant_status = {}
    for p in plant:
        if _d(p.get("plant_completion_date")) and _d(p.get("plant_completion_date")) <= as_of:
            plant_status[p["id"]] = "Completed"
        elif not _d(p.get("plant_start_date")) or not _d(p.get("amr_finish_date")):
            plant_status[p["id"]] = "Yet to Start"
        else:
            # The source dashboard defaults to Apr-26.  At that point no
            # monthly revised completion was recorded, so plant delay is
            # measured against the original schedule completion itself.
            # ``anticipated_completion`` belongs to the later detail report
            # and must not leak into this dashboard classification.
            plant_status[p["id"]] = "On Time"
    plant_active = [p for p in plant if plant_status[p["id"]] in {"On Time", "Delay < 1 Year", "Delay > 1 Year"}]

    status_rows = []
    for label in ("On Time", "Delay < 1 Year", "Delay > 1 Year"):
        cp = [p for p in corp_active if (_delay(p) or "On Time") == label]
        pp = [p for p in plant_active if plant_status[p["id"]] == label]
        status_rows.append({"label": label, "value": len(cp) + len(pp),
                            "cost": round(sum(_cost(p, fin) for p in cp + pp), 2),
                            "corporateValue": len(cp), "plantValue": len(pp),
                            "corporateCost": round(sum(_cost(p, fin) for p in cp), 2),
                            "plantCost": round(sum(_cost(p, fin) for p in pp), 2)})

    completed_corp = [p for p in corp if _d(p.get("completion_date")) and fy_start <= _d(p["completion_date"]) <= fy_end and p["completed"]]
    completed_plant = [p for p in plant if _d(p.get("plant_completion_date")) and fy_start <= _d(p["plant_completion_date"]) <= fy_end]
    status_rows.append({"label": "Completed this FY", "value": len(completed_corp) + len(completed_plant),
                        "cost": round(sum(_cost(p, fin) for p in completed_corp + completed_plant), 2),
                        "corporateValue": len(completed_corp),
                        "corporateCost": round(sum(_cost(p, fin) for p in completed_corp), 2),
                        "plantValue": len(completed_plant),
                        "plantCost": round(sum(_cost(p, fin) for p in completed_plant), 2)})

    stage = {k: [] for k in ("Formulation", "Stage - 1", "Tendering", "Stage - 2")}
    for p in leaves:
        s = p["status"]
        key = "Formulation" if s == "Under Formulation" else "Stage - 1" if s == "Stage-1" else "Tendering" if s == "Tendering" else "Stage - 2"
        stage[key].append(p)
    stage_rows = [{"stage": k, "projects": len(v), "cost": round(sum(_cost(p, fin) for p in v), 2)} for k, v in stage.items()]

    fy_counts = {f"Started during FY {fy_start.year}-{str(fy_start.year+1)[-2:]}": 0,
                 "Ongoing Since Last FY": 0, "-": 0}
    for p in leaves:
        # Dashboard FY grouping uses only the implementation schedule start;
        # it does not fall back to contract effective/approval dates.
        start = _d(p.get("corporate_schedule_start") or p.get("plant_start_date"))
        label = "-" if not start else (f"Started during FY {fy_start.year}-{str(fy_start.year+1)[-2:]}" if start >= fy_start else "Ongoing Since Last FY")
        if not p["completed"]:
            fy_counts[label] += 1

    corporate_upcoming = [
        p for p in corp
        if not _d(p.get("completion_date"))
        and _norm(p.get("status")) in {"under formulation", "stage 1", "tendering", "stage 2"}
    ]
    plant_upcoming = [p for p in plant if not _d(p.get("amr_at_date"))]
    corporate_scheduled = []
    for p in corp:
        expected = _d(p.get("corporate_expected_finish") or p.get("expected_finish"))
        if not _d(p.get("completion_date")) and expected and fy_start <= expected <= fy_end:
            corporate_scheduled.append(p)
    # The source plant dashboard resolves monthly expected-finish revisions.
    # The archived Apr-26 snapshot has no qualifying revisions in this FY.
    plant_scheduled = []

    total_cost = round(sum(_cost(p, fin) for p in leaves), 2)
    active_plan = cap["re"] if cap["plan_type"] == "RE" and cap["re"] else cap["be"]
    heatmap_rows = []
    for key, rows in stage.items():
        counts = {"On Time": 0, "Delay < 1 Year": 0, "Delay > 1 Year": 0,
                  "Completed This FY": 0}
        for p in rows:
            label = _delay(p) if p.get("project_type") == "Corporate AMR" else ""
            counts[label if label in counts else "On Time"] += 1
        heatmap_rows.append({"Stage": key, **counts})

    return {
        "cards": {"totalProjects": len(leaves),
                  "ongoingProjects": sum(1 for p in leaves if str(p.get("stage2_cleared") or "").upper() == "Y" and str(p.get("completion_marked") or "").upper() != "Y"),
                  "completedProjects": sum(1 for p in leaves if str(p.get("completion_marked") or "").upper() == "Y"),
                  "droppedProjects": sum(1 for p in leaves if str(p.get("project_dropped") or "").upper() == "Y"),
                  "totalProjectCost": total_cost},
        "kpis": {"totalCapex": active_plan, "actualCapex": cap["actual"],
                 "achievementPercent": round(cap["actual"] / active_plan * 100, 2) if active_plan else 0,
                 "totalProjects": len(leaves), "totalProjectCost": total_cost,
                 "completedProjects": len(completed_corp) + len(completed_plant),
                 "corporateCompletedProjects": len(completed_corp),
                 "corporateCompletedCost": round(sum(_cost(p, fin) for p in completed_corp), 2),
                 "completedCorporateProjects": len(completed_corp),
                 "completedCorporateCost": round(sum(_cost(p, fin) for p in completed_corp), 2),
                 "plantLevelCompletedProjects": len(completed_plant),
                 "plantLevelCompletedCost": round(sum(_cost(p, fin) for p in completed_plant), 2),
                 "completedPlantLevelProjects": len(completed_plant),
                 "completedPlantLevelCost": round(sum(_cost(p, fin) for p in completed_plant), 2),
                 "corporateProjects": len(corp), "plantLevelProjects": len(plant),
                 "corporateCost": round(sum(_cost(p, fin) for p in corp), 2),
                 "plantLevelCost": round(sum(_cost(p, fin) for p in plant), 2),
                 "corporateOngoingProjects": len(corp_active),
                 "corporateOngoingCost": round(sum(_cost(p, fin) for p in corp_active), 2),
                 "plantLevelOngoingProjects": len(plant_active),
                 "plantLevelOngoingCost": round(sum(_cost(p, fin) for p in plant_active), 2),
                 "corporateScheduledThisFyProjects": len(corporate_scheduled),
                 "corporateScheduledThisFyCost": round(sum(_cost(p, fin) for p in corporate_scheduled), 2),
                 "plantLevelScheduledThisFyProjects": len(plant_scheduled),
                 "plantLevelScheduledThisFyCost": round(sum(_cost(p, fin) for p in plant_scheduled), 2),
                 "corporateUpcomingProjects": len(corporate_upcoming),
                 "corporateUpcomingCost": round(sum(_cost(p, fin) for p in corporate_upcoming), 2),
                 "plantLevelUpcomingProjects": len(plant_upcoming),
                 "plantLevelUpcomingCost": round(sum(_cost(p, fin) for p in plant_upcoming), 2)},
        "financialYear": f"{fy_start.year}-{str(fy_start.year+1)[-2:]}",
        "statusRows": status_rows, "stageRows": stage_rows,
        "scheduleCompletionRows": [
            {"type": "Corporate AMR", "value": len(corporate_scheduled),
             "cost": round(sum(_cost(p, fin) for p in corporate_scheduled), 2)},
            {"type": "Plant Level AMR", "value": len(plant_scheduled),
             "cost": round(sum(_cost(p, fin) for p in plant_scheduled), 2)},
        ],
        "upcomingRows": [
            {"type": "Corporate AMR", "value": len(corporate_upcoming),
             "cost": round(sum(_cost(p, fin) for p in corporate_upcoming), 2)},
            {"type": "Plant Level AMR", "value": len(plant_upcoming),
             "cost": round(sum(_cost(p, fin) for p in plant_upcoming), 2)},
        ],
        "completedRows": [
            {"type": "Corporate AMR", "value": len(completed_corp),
             "cost": round(sum(_cost(p, fin) for p in completed_corp), 2), "projects": []},
            {"type": "Plant Level AMR", "value": len(completed_plant),
             "cost": round(sum(_cost(p, fin) for p in completed_plant), 2), "projects": []},
        ],
        "fyStartClassification": [{"label": k, "value": v} for k, v in fy_counts.items()],
        "heatmapRows": heatmap_rows,
        "capexTrend": cap["trend"],
        "capexSummary": {"totalBe": cap["be"], "totalRe": cap["re"],
                         "totalBeRe": active_plan, "effectivePlanType": cap["plan_type"],
                         "effectivePlanName": cap["plan_name"], "totalActual": cap["actual"],
                         "variance": round(active_plan-cap["actual"], 2),
                         "variancePercent": round((active_plan-cap["actual"]) / active_plan * 100, 2) if active_plan else 0},
    }


def _summary(no, category, rows, fin, tone=""):
    result = {"no": no, "category": category, "tone": tone, "section": False,
              "projects": len(rows), "totalCost": 0.0, "expenditureLastFy": 0.0,
              "capexCurrentFy": 0.0, "expenditureCurrentFy": 0.0,
              "totalExpenditure": 0.0, "childRows": [], "statusGroups": [], "projectRows": []}
    for p in rows:
        f = fin.get(int(p["id"]), {})
        cost = _cost(p, fin)
        last = _f(f.get("expenditure_last_fy") if f else p.get("corporate_expenditure_last_fy"))
        plan = _f(f.get("be_current_fy") if f else p.get("corporate_be_re_current_fy"))
        actual = _f(f.get("actual_current_fy") if f else p.get("corporate_actual_current_fy"))
        total = _f(f.get("actual_till_date") if f else p.get("corporate_cumulative_cost")) or last + actual
        result["totalCost"] += cost; result["expenditureLastFy"] += last
        result["capexCurrentFy"] += plan; result["expenditureCurrentFy"] += actual
        result["totalExpenditure"] += total
        result["projectRows"].append({"id": p["id"], "category": p["project_display_name"],
                                      "projectName": p["project_display_name"], "projectType": p["project_type"],
                                      "totalCost": round(cost, 2), "expenditureLastFy": round(last, 2),
                                      "capexCurrentFy": round(plan, 2), "expenditureCurrentFy": round(actual, 2),
                                      "totalExpenditure": round(total, 2), "derivedStatus": _delay(p, False),
                                      "approvalDate": p.get("stage2_date") if p.get("project_type") == "Corporate AMR" else None,
                                      "awardDate": p.get("effective_date") if p.get("project_type") == "Corporate AMR" else None,
                                      "originalCompletionDate": p.get("schedule_completion") or p.get("corporate_schedule_finish"),
                                      "revisedCompletionDate": p.get("expected_finish") or p.get("corporate_expected_finish"),
                                      "anticipatedCompletionDate": p.get("expected_finish") or p.get("corporate_expected_finish"),
                                      "physical": None})
    for key in ("totalCost", "expenditureLastFy", "capexCurrentFy", "expenditureCurrentFy", "totalExpenditure"):
        result[key] = round(result[key], 2)
    return result


def mos_model(db, report_month: str | None = None) -> dict:
    report_date = date.today()
    if report_month:
        y, m = map(int, report_month[:7].split("-")); report_date = date(y, m, calendar.monthrange(y, m)[1])
    fy_start = date(report_date.year if report_date.month >= 4 else report_date.year - 1, 4, 1)
    fy_end = date(fy_start.year + 1, 3, 31)
    cap = _capex(db); fin = cap["financials"]; projects = _projects(db, report_date)

    ongoing = [p for p in projects if (p["project_type"] == "Plant Level AMR" or not p["completed"])
               and str(p.get("project_dropped") or "").upper() != "Y" and not p["is_parent"]]
    completed = [p for p in projects if p["completed"]]
    def bucket(p):
        start = _implementation_start(p)
        if start and start < fy_start: return "last"
        if start and fy_start <= start <= fy_end: return "current"
        return "future"
    last = [p for p in ongoing if bucket(p) == "last"]
    current = [p for p in ongoing if bucket(p) == "current"]
    report_ongoing = last + current
    candidates = [p for p in projects if not p["completed"] and str(p.get("project_dropped") or "").upper() != "Y" and not p["is_parent"]]
    corp_tender = [p for p in candidates if p["project_type"] == "Corporate AMR" and _norm(p["base_status"]) == "tendering"]
    corp_s2 = [p for p in candidates if p["project_type"] == "Corporate AMR" and _norm(p["base_status"]) == "stage 2"]
    plant_yts = [p for p in candidates if p["project_type"] == "Plant Level AMR" and (not _d(p.get("plant_start_date")) or not _d(p.get("amr_finish_date")))]
    corp_s1 = [p for p in candidates if p["project_type"] == "Corporate AMR" and _norm(p["base_status"]) in {"under formulation", "stage 1"}]
    new_tender = corp_tender + corp_s2 + plant_yts; new_s1 = corp_s1

    rows = []
    rows.append({**_summary("1", "Being Implemented from Last FY", last, fin, "blue"), "section": True})
    rows.append(_summary("1.1", "Corporate AMR", [p for p in last if p["project_type"] == "Corporate AMR"], fin))
    rows.append(_summary("1.2", "Plant Level AMR (<30 Cr.)", [p for p in last if p["project_type"] == "Plant Level AMR"], fin))
    rows.append({**_summary("2", f"Implementation Started During FY {fy_start.year}-{str(fy_start.year+1)[-2:]}", current, fin, "teal"), "section": True})
    rows.append(_summary("2.1", "Corporate AMR", [p for p in current if p["project_type"] == "Corporate AMR"], fin))
    rows.append(_summary("2.2", "Plant Level AMR (<30 Cr.)", [p for p in current if p["project_type"] == "Plant Level AMR"], fin))
    total_ongoing = {**_summary("3", "Total Ongoing projects", report_ongoing, fin, "purple"), "section": True}
    rows.append(total_ongoing)
    completed_row = _summary("", "Milestone payments in completed projects incl. MEP", completed, fin, "soft-purple")
    # Friend report includes the fixed Plant EDC/IDC financial row here.
    edc = db.execute(text("SELECT COALESCE(SUM(be_cr),0) be,COALESCE(SUM(actual_cr),0) actual FROM friend_archive.plant_level_amr_edc_idc")).mappings().first()
    completed_row["totalCost"] = round(completed_row["totalCost"] + _f(edc["be"]), 2)
    completed_row["capexCurrentFy"] = round(completed_row["capexCurrentFy"] + _f(edc["be"]), 2)
    completed_row["expenditureCurrentFy"] = round(completed_row["expenditureCurrentFy"] + _f(edc["actual"]), 2)
    completed_row["totalExpenditure"] = round(completed_row["totalExpenditure"] + _f(edc["actual"]), 2)
    rows.append(completed_row)
    rows.append(_summary("3a", "New Projects under tendering/ final approval and contract award", new_tender, fin, "soft-blue"))
    rows.append(_summary("3b", "New Projects under Stage-1 approval", new_s1, fin, "soft-green"))
    total_new = _summary("", "Total New projects under consideration (3a+3b)", new_tender + new_s1, fin, "soft-orange")
    rows.append(total_new)
    spares_item = next((r for r in cap.get("rows", []) if "capital repairs" in _norm((r.get("values") or {}).get("CAPEX Plan (FY)")) and "spares" in _norm((r.get("values") or {}).get("CAPEX Plan (FY)"))), None)
    sv = (spares_item or {}).get("values") or {}
    spares = {"no": "", "category": "Spares & Capital Repairs", "tone": "soft-red", "section": False,
              "projects": 0, "totalCost": round(_f(sv.get("BE (FY)")), 2),
              "expenditureLastFy": round(_f(sv.get("Cummulative Expenditure till Last FY")), 2),
              "capexCurrentFy": round(_f(sv.get("BE (FY)")), 2),
              "expenditureCurrentFy": round(sum(_f(sv.get(f"{m} Actual")) for m in FY_MONTHS), 2),
              "totalExpenditure": round(_f(sv.get("Cummulative Expenditure till Last FY")) + sum(_f(sv.get(f"{m} Actual")) for m in FY_MONTHS), 2),
              "childRows": [], "statusGroups": [], "projectRows": []}
    rows.append(spares)
    rows.append({"no": "", "category": "Other schemes/ JVs", "tone": "soft-gray", "section": False,
                 "projects": 0, "totalCost": 0.0, "expenditureLastFy": 0.0, "capexCurrentFy": 0.0,
                 "expenditureCurrentFy": 0.0, "totalExpenditure": 0.0, "childRows": [], "statusGroups": [], "projectRows": []})
    sources = [total_ongoing, completed_row, total_new, spares]
    grand = {"no": "", "category": "Total", "tone": "total", "section": True,
             "projects": total_ongoing["projects"] + total_new["projects"],
             "totalCost": total_ongoing["totalCost"] + total_new["totalCost"] + spares["totalCost"],
             "expenditureLastFy": total_ongoing["expenditureLastFy"] + total_new["expenditureLastFy"] + spares["expenditureLastFy"],
             "capexCurrentFy": sum(r["capexCurrentFy"] for r in sources),
             "expenditureCurrentFy": sum(r["expenditureCurrentFy"] for r in sources),
             "totalExpenditure": sum(r["totalExpenditure"] for r in sources),
             "childRows": [], "statusGroups": [], "projectRows": []}
    for k in ("totalCost", "expenditureLastFy", "capexCurrentFy", "expenditureCurrentFy", "totalExpenditure"):
        grand[k] = round(grand[k], 2)
    rows.append(grand)
    return {"financialYear": f"{fy_start.year}-{str(fy_start.year+1)[-2:]}",
            "asOn": report_date.isoformat(), "rows": rows,
            "detailProjects": total_ongoing["projectRows"]}


def capex_detail_model(db, report_month: str | None = None) -> dict:
    """Source-compatible physical/financial project list and <50 Cr rollup."""
    report = mos_model(db, report_month)
    ongoing = sorted(report["detailProjects"], key=lambda row: row["totalCost"], reverse=True)
    high = [row for row in ongoing if row["totalCost"] >= 50]
    low = [row for row in ongoing if row["totalCost"] < 50]
    high_rows = [{
        "schemeId": row["id"], "name": row["projectName"], "totalCost": row["totalCost"],
        "approvalDate": row["approvalDate"], "awardDate": row["awardDate"],
        "originalCompletionDate": row["originalCompletionDate"],
        "revisedCompletionDate": row["revisedCompletionDate"],
        "anticipatedCompletionDate": row["anticipatedCompletionDate"],
        "expenditureLastFy": row["expenditureLastFy"], "capexCurrentFy": row["capexCurrentFy"],
        "expenditureCurrentFy": row["expenditureCurrentFy"],
        "cumulativeExpenditure": row["totalExpenditure"],
        "physical": row["physical"], "reasonForDelay": "",
    } for row in high]
    return {
        "month": report["asOn"][:7], "financialYear": report["financialYear"],
        "detailProjectCount": len(ongoing), "highCostProjects": high_rows,
        "lowCostSummary": {
            "count": len(low), "totalCost": round(sum(r["totalCost"] for r in low), 2),
            "expenditureLastFy": round(sum(r["expenditureLastFy"] for r in low), 2),
            "capexCurrentFy": round(sum(r["capexCurrentFy"] for r in low), 2),
            "expenditureCurrentFy": round(sum(r["expenditureCurrentFy"] for r in low), 2),
            "cumulativeExpenditure": round(sum(r["totalExpenditure"] for r in low), 2),
        },
    }
