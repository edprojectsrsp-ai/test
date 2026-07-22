"""
Targeted friend DB sync for project-wise operational values.

This intentionally avoids the broad legacy importer wipe. It updates/creates
project masters plus the report-driving operational data only:

- scheme_master / packages project details
- Stage-I / Stage-II approvals
- contracts
- plant physical progress snapshots
- CAPEX plan values and monthly BE/RE/actual values
- DPR manpower rows

Rows created by this tool are tagged with extra_fields.source =
"friend_project_values_sync" or entered_via = "friend_project_values_sync".
Manual/local approval and contract rows are preserved.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor, Json

from import_friend_data import MONTH_ABBR, PROJECT_TARGETS, dt, month_to_date

SRC_URL = os.getenv("FRIEND_DB_URL", "postgresql://postgres:postgres@127.0.0.1:5432/friend_brain")
DST_URL = os.getenv("PROJECT_BRAIN_DB_URL", "postgresql://postgres:postgres@127.0.0.1:5432/project_brain")
SOURCE_TAG = "friend_project_values_sync"
FRIEND_SOURCES = ("friend_import", SOURCE_TAG)


def num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def int_or_none(value: Any) -> int | None:
    value = num(value)
    return int(value) if value is not None else None


def yes(value: Any) -> bool:
    return str(value or "").strip().upper() == "Y"


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def friend_status(project: dict[str, Any]) -> str:
    status = norm(project.get("stage_override") or project.get("master_current_status"))
    if yes(project.get("project_dropped")):
        return "dropped"
    if yes(project.get("completion_marked")) or yes(project.get("commissioned_marked")):
        return "closed"
    if status in {"under formulation", "formulation"}:
        return "under_formulation"
    if "stage 1" in status:
        return "under_stage1"
    if "stage 2" in status:
        return "under_stage2"
    if "tender" in status:
        return "under_tendering"
    if yes(project.get("stage2_cleared")) and (
        dt(project.get("effective_date")) or dt(project.get("master_effective_date_contract"))
    ):
        return "ongoing"
    if yes(project.get("stage2_cleared")):
        return "under_tendering"
    if yes(project.get("stage1_cleared")):
        return "under_stage2"
    return "under_stage1"


def project_cost(project: dict[str, Any], plant_detail: dict[str, Any] | None = None) -> float:
    for key in ("master_gross_cost", "stage2_cost", "stage1_cost", "formulation_cost"):
        value = num(project.get(key))
        if value is not None:
            return value
    if plant_detail:
        value = num(plant_detail.get("gross_cost"))
        if value is not None:
            return value
    return 0.0


def scheme_type(project: dict[str, Any]) -> str:
    return "plant" if norm(project.get("project_type")).startswith("plant") else "corporate"


def merge_extra(existing: dict[str, Any] | None, project_ids: list[int]) -> dict[str, Any]:
    data = dict(existing or {})
    old_ids = data.get("friend_project_ids") or []
    ids = sorted({int(x) for x in old_ids + project_ids})
    data["friend_project_ids"] = ids
    data["friend_source"] = "friend_brain"
    data["source"] = SOURCE_TAG
    data["synced_at"] = datetime.now().isoformat(timespec="seconds")
    return data


def fetch_all(cursor, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cursor.execute(sql, params)
    return list(cursor.fetchall())


def ensure_scheme_and_package(d, project: dict[str, Any], plant_detail: dict[str, Any] | None) -> tuple[int, int]:
    project_id = int(project["id"])
    target = PROJECT_TARGETS.get(project_id)
    scheme_id = target[0] if target else None
    package_id = target[1] if target else None

    if not scheme_id:
        d.execute(
            """
            SELECT scheme_id
            FROM scheme_master
            WHERE extra_fields->'friend_project_ids' @> %s::jsonb AND NOT is_deleted
            ORDER BY scheme_id
            LIMIT 1
            """,
            (json.dumps([project_id]),),
        )
        row = d.fetchone()
        scheme_id = row["scheme_id"] if row else None

    start = dt(project.get("effective_date")) or dt(project.get("master_effective_date_contract"))
    finish = (
        dt(project.get("expected_finish"))
        or dt(project.get("master_expected_completion_date"))
        or dt(project.get("schedule_completion"))
        or dt(project.get("master_schedule_completion_date"))
    )
    actual_finish = dt(project.get("completion_date")) or dt(project.get("master_actual_completion_date"))
    plant_start = dt((plant_detail or {}).get("schedule_start"))
    plant_finish = dt((plant_detail or {}).get("anticipated_completion")) or dt((plant_detail or {}).get("schedule_completion"))
    if plant_detail and not start:
        start = plant_start
    if plant_detail and not finish:
        finish = plant_finish

    cost = project_cost(project, plant_detail)
    name = (project.get("project_name") or project.get("master_description") or f"Friend Project {project_id}").strip()
    status = friend_status(project)
    stype = scheme_type(project)
    extra = merge_extra({}, [project_id])

    if scheme_id:
        d.execute("SELECT extra_fields FROM scheme_master WHERE scheme_id=%s", (scheme_id,))
        existing = d.fetchone()
        extra = merge_extra((existing or {}).get("extra_fields"), [project_id])
        d.execute(
            """
            UPDATE scheme_master
            SET scheme_name=%s, scheme_type=%s, current_status=%s,
                estimated_cost_cr=%s, sanctioned_cost_cr=COALESCE(%s, sanctioned_cost_cr),
                anticipated_cost_cr=COALESCE(%s, anticipated_cost_cr),
                planned_start_date=COALESCE(%s, planned_start_date),
                planned_completion_date=COALESCE(%s, planned_completion_date),
                actual_start_date=COALESCE(%s, actual_start_date),
                actual_completion_date=COALESCE(%s, actual_completion_date),
                is_active=TRUE, is_deleted=FALSE, extra_fields=%s, updated_at=CURRENT_TIMESTAMP
            WHERE scheme_id=%s
            """,
            (
                name,
                stype,
                status,
                cost,
                num(project.get("stage2_cost")),
                num(project.get("master_gross_cost")) or cost,
                start,
                finish,
                start,
                actual_finish,
                Json(extra),
                scheme_id,
            ),
        )
    else:
        d.execute(
            """
            INSERT INTO scheme_master (
                scheme_code, scheme_name, scheme_type, current_status,
                estimated_cost_cr, sanctioned_cost_cr, anticipated_cost_cr,
                planned_start_date, planned_completion_date, actual_start_date,
                actual_completion_date, is_active, is_deleted, extra_fields
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,FALSE,%s)
            RETURNING scheme_id
            """,
            (
                project.get("unique_id") or f"FRIEND-{project_id}",
                name,
                stype,
                status,
                cost,
                num(project.get("stage2_cost")),
                num(project.get("master_gross_cost")) or cost,
                start,
                finish,
                start,
                actual_finish,
                Json(extra),
            ),
        )
        scheme_id = d.fetchone()["scheme_id"]

    if package_id:
        d.execute("SELECT extra_fields FROM packages WHERE package_id=%s", (package_id,))
        existing = d.fetchone()
        pkg_extra = merge_extra((existing or {}).get("extra_fields"), [project_id])
        d.execute(
            """
            UPDATE packages
            SET package_name=%s, package_type=%s, package_status=%s,
                package_estimate_cr=%s, package_value_cr=COALESCE(%s, package_value_cr),
                executing_agency=COALESCE(%s, executing_agency),
                planned_start_date=COALESCE(%s, planned_start_date),
                planned_end_date=COALESCE(%s, planned_end_date),
                start_date_actual=COALESCE(%s, start_date_actual),
                completion_date_actual=COALESCE(%s, completion_date_actual),
                is_deleted=FALSE, extra_fields=%s, updated_at=CURRENT_TIMESTAMP
            WHERE package_id=%s
            """,
            (
                name,
                project.get("project_type"),
                "closed" if status == "closed" else ("tendering" if status in {"under_tendering", "under_stage2", "under_stage1"} else "in_progress"),
                cost,
                num(project.get("stage2_cost")) or cost,
                project.get("master_executing_agency") or (plant_detail or {}).get("executing_agency"),
                start,
                finish,
                start,
                actual_finish,
                Json(pkg_extra),
                package_id,
            ),
        )
    else:
        d.execute(
            """
            SELECT package_id, extra_fields FROM packages
            WHERE scheme_id=%s AND NOT is_deleted
            ORDER BY is_scheme_mirror DESC, package_id
            LIMIT 1
            """,
            (scheme_id,),
        )
        pkg = d.fetchone()
        if pkg:
            package_id = pkg["package_id"]
            pkg_extra = merge_extra(pkg.get("extra_fields"), [project_id])
            d.execute(
                """
                UPDATE packages
                SET package_name=%s, package_estimate_cr=%s,
                    planned_start_date=COALESCE(%s, planned_start_date),
                    planned_end_date=COALESCE(%s, planned_end_date),
                    start_date_actual=COALESCE(%s, start_date_actual),
                    completion_date_actual=COALESCE(%s, completion_date_actual),
                    extra_fields=%s, updated_at=CURRENT_TIMESTAMP
                WHERE package_id=%s
                """,
                (name, cost, start, finish, start, actual_finish, Json(pkg_extra), package_id),
            )
        else:
            d.execute(
                """
                INSERT INTO packages (
                    scheme_id, package_no, package_code, package_name,
                    package_type, package_status, package_estimate_cr, package_value_cr,
                    executing_agency, planned_start_date, planned_end_date,
                    start_date_actual, completion_date_actual, is_scheme_mirror,
                    is_deleted, extra_fields
                )
                VALUES (%s,1,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,FALSE,%s)
                RETURNING package_id
                """,
                (
                    scheme_id,
                    project.get("unique_id") or f"FRIEND-{project_id}",
                    name,
                    project.get("project_type"),
                    "closed" if status == "closed" else ("tendering" if status in {"under_tendering", "under_stage2", "under_stage1"} else "in_progress"),
                    cost,
                    num(project.get("stage2_cost")) or cost,
                    project.get("master_executing_agency") or (plant_detail or {}).get("executing_agency"),
                    start,
                    finish,
                    start,
                    actual_finish,
                    Json(extra),
                ),
            )
            package_id = d.fetchone()["package_id"]
    return scheme_id, package_id


def sync_approvals_contracts(d, project: dict[str, Any], scheme_id: int, package_id: int) -> tuple[int, int, int]:
    s1 = s2 = contracts = 0
    project_id = int(project["id"])
    tag = Json({"source": SOURCE_TAG, "friend_project_id": project_id})

    stage1_date = dt(project.get("stage1_final_date")) or dt(project.get("stage1_date"))
    stage1_cost = num(project.get("stage1_cost"))
    cod = dt(project.get("cod_date"))
    if stage1_date or stage1_cost or cod:
        d.execute(
            "DELETE FROM stage1_approvals WHERE scheme_id=%s AND extra_fields->>'source'=ANY(%s)",
            (scheme_id, list(FRIEND_SOURCES)),
        )
        d.execute(
            """
            INSERT INTO stage1_approvals (
                scheme_id, revision_no, revision_label, is_current, cod_date,
                corporate_pag_date, chairman_approval_date, sail_board_date,
                sanction_date, cost_gross_cr, is_deleted, extra_fields
            )
            VALUES (%s,1,'Friend DB',TRUE,%s,%s,%s,%s,%s,%s,FALSE,%s)
            """,
            (
                scheme_id,
                cod,
                dt(project.get("corporate_pag_date")),
                dt(project.get("chairman_approval_date")),
                dt(project.get("board_approval_date")),
                stage1_date,
                stage1_cost,
                tag,
            ),
        )
        s1 = 1

    stage2_date = dt(project.get("stage2_approval_date")) or dt(project.get("stage2_date"))
    stage2_cost = num(project.get("stage2_cost")) or num(project.get("master_gross_cost"))
    if stage2_date or stage2_cost:
        d.execute(
            "DELETE FROM stage2_approvals WHERE scheme_id=%s AND extra_fields->>'source'=ANY(%s)",
            (scheme_id, list(FRIEND_SOURCES)),
        )
        d.execute(
            """
            INSERT INTO stage2_approvals (
                scheme_id, revision_no, revision_label, is_current,
                sanction_date, order_date, firmed_up_cost_gross_cr,
                is_deleted, extra_fields
            )
            VALUES (%s,1,'Friend DB',TRUE,%s,%s,%s,FALSE,%s)
            """,
            (
                scheme_id,
                stage2_date,
                dt(project.get("loa_issue_date")) or dt(project.get("loa_date")),
                stage2_cost,
                tag,
            ),
        )
        s2 = 1

    effective = dt(project.get("effective_date")) or dt(project.get("master_effective_date_contract"))
    loa = dt(project.get("loa_date")) or dt(project.get("loa_issue_date")) or dt(project.get("master_loa_loi"))
    contractor = (project.get("contractor_name") or project.get("master_executing_agency") or "").strip()
    if effective or loa or contractor:
        d.execute(
            "DELETE FROM contracts WHERE package_id=%s AND extra_fields->>'source'=ANY(%s)",
            (package_id, list(FRIEND_SOURCES)),
        )
        d.execute(
            """
            INSERT INTO contracts (
                package_id, contract_no, contractor_name, contract_value_cr,
                loa_date, effective_date, contract_duration_months,
                schedule_completion_date, expected_completion_date,
                is_active, is_deleted, extra_fields
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,FALSE,%s)
            """,
            (
                package_id,
                project.get("unique_id") or f"FRIEND-{project['id']}",
                contractor[:500],
                stage2_cost,
                loa,
                effective,
                int_or_none(project.get("schedule_months") or project.get("master_schedule_months")),
                dt(project.get("schedule_completion")) or dt(project.get("master_schedule_completion_date")),
                dt(project.get("expected_finish")) or dt(project.get("master_expected_completion_date")),
                tag,
            ),
        )
        contracts = 1

    return s1, s2, contracts


def sync_physical(d, package_id: int, detail: dict[str, Any] | None) -> int:
    if not detail:
        return 0
    physical = num(detail.get("physical_progress"))
    if physical is None:
        return 0
    month = dt(detail.get("anticipated_completion")) or dt(detail.get("schedule_completion")) or date.today()
    month_date = date(month.year, month.month, 1)
    d.execute(
        """
        INSERT INTO plant_progress_monthly (
            package_id, month_date, planned_progress_pct, actual_progress_pct,
            cumulative_planned_pct, cumulative_actual_pct, risk_level, notes
        )
        VALUES (%s,%s,0,%s,0,%s,'unknown',%s)
        ON CONFLICT (package_id, month_date) DO UPDATE SET
            actual_progress_pct=EXCLUDED.actual_progress_pct,
            cumulative_actual_pct=EXCLUDED.cumulative_actual_pct,
            notes=EXCLUDED.notes,
            computed_at=CURRENT_TIMESTAMP
        """,
        (
            package_id,
            month_date,
            min(physical, 100),
            min(physical, 100),
            f"{SOURCE_TAG}; friend project {detail['project_id']}; {detail.get('remarks') or ''}"[:2000],
        ),
    )
    return 1


def sync_dpr_manpower(d, source_rows: list[dict[str, Any]], project_to_scheme: dict[int, int]) -> int:
    d.execute("DELETE FROM daily_progress_manpower WHERE remarks LIKE %s", (f"%{SOURCE_TAG}%",))
    inserted = 0
    for row in source_rows:
        scheme_id = project_to_scheme.get(int(row["project_id"]))
        if not scheme_id:
            continue
        d.execute(
            """
            INSERT INTO daily_progress_manpower (
                scheme_id, report_date, section_name, category_name, contractor_name,
                role_name, qty, sort_order, month_target, last_month_average, remarks
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                scheme_id,
                row["report_date"],
                row.get("section_name"),
                row.get("category_name"),
                row.get("contractor_name") or "",
                row.get("role_name") or "",
                row.get("qty") or 0,
                row.get("sort_order"),
                row.get("month_target") or "",
                row.get("last_month_average"),
                f"{row.get('remarks') or ''} [{SOURCE_TAG}; friend project {row['project_id']}]",
            ),
        )
        inserted += 1
    return inserted


def sync_capex_plan(d, capex_plan: dict[str, Any] | None, project_to_scheme: dict[int, int]) -> tuple[int, int, int]:
    if not capex_plan:
        return 0, 0, 0
    fy = re.sub(r"^FY\s*", "", capex_plan.get("financial_year") or "").strip()
    match = re.match(r"^(\d{4})-(\d{4})$", fy)
    fy_year = f"{match.group(1)}-{match.group(2)[-2:]}" if match else (fy or "2026-27")
    effective_from_month = int_or_none(capex_plan.get("effective_from_month"))

    d.execute(
        """
        UPDATE capex_plan_header
        SET is_effective=0
        WHERE fy_year=%s
        """,
        (fy_year,),
    )
    d.execute(
        """
        SELECT id FROM capex_plan_header
        WHERE fy_year=%s
        ORDER BY id DESC
        LIMIT 1
        """,
        (fy_year,),
    )
    existing = d.fetchone()
    if existing:
        plan_id = existing["id"]
        d.execute(
            """
            UPDATE capex_plan_header
            SET plan_type='BE', plan_version=%s, plan_status='Draft',
                is_effective=1, effective_from_month=%s
            WHERE id=%s
            """,
            (capex_plan.get("plan_version") or "friend", effective_from_month, plan_id),
        )
    else:
        d.execute(
            """
            INSERT INTO capex_plan_header (
                fy_year, plan_type, plan_version, plan_status, is_effective, effective_from_month
            )
            VALUES (%s,'BE',%s,'Draft',1,%s)
            RETURNING id
            """,
            (fy_year, capex_plan.get("plan_version") or "friend", effective_from_month),
        )
        plan_id = d.fetchone()["id"]

    d.execute(
        "DELETE FROM capex_plan_rows WHERE plan_id=%s AND is_imported=1",
        (plan_id,),
    )

    rows = json.loads(capex_plan.get("rows_json") or "[]")
    parent_by_child = {}
    for row in rows:
        for child_id in row.get("children") or []:
            parent_by_child[child_id] = row.get("row_id")

    row_map: dict[Any, int] = {}
    row_count = value_count = month_count = 0
    for order, source_row in enumerate(rows):
        values = source_row.get("values") or {}
        source_row_id = source_row.get("row_id")
        parent_id = row_map.get(parent_by_child.get(source_row_id))
        project_id = source_row.get("source_project_id")
        try:
            scheme_id = project_to_scheme.get(int(project_id)) if project_id else None
        except (TypeError, ValueError):
            scheme_id = None
        d.execute(
            """
            INSERT INTO capex_plan_rows (
                plan_id, parent_row_id, scheme_id, row_name, row_level,
                indent_level, display_order, is_imported
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,1)
            RETURNING id
            """,
            (
                plan_id,
                parent_id,
                scheme_id,
                values.get("CAPEX Plan (FY)") or f"Friend CAPEX Row {source_row_id}",
                source_row.get("level") or "Item",
                int(source_row.get("indent") or 0),
                order,
            ),
        )
        row_id = d.fetchone()["id"]
        row_map[source_row_id] = row_id
        row_count += 1

        d.execute(
            """
            INSERT INTO capex_plan_values (
                plan_row_id, gross_cost, cumulative_exp_till_last_fy, be_fy, re_fy
            )
            VALUES (%s,%s,%s,%s,%s)
            """,
            (
                row_id,
                num(values.get("Gross Cost")) or 0,
                num(values.get("Cummulative Expenditure till Last FY")) or 0,
                num(values.get("BE (FY)")) or 0,
                num(values.get("RE (FY)")) or 0,
            ),
        )
        value_count += 1

        month_cells: dict[int, dict[str, float]] = {}
        for key, raw_value in values.items():
            match = re.match(r"^([A-Za-z]{3})-(\d{2}) (BE|RE|Actual)$", key)
            if not match:
                continue
            month_no = MONTH_ABBR.get(match.group(1).title())
            if not month_no:
                continue
            month_cells.setdefault(month_no, {"BE": 0.0, "RE": 0.0, "Actual": 0.0})[match.group(3)] = num(raw_value) or 0
        for month_no, cell in month_cells.items():
            d.execute(
                """
                INSERT INTO capex_month_values (
                    plan_row_id, month_no, be_amount, re_amount, actual_amount
                )
                VALUES (%s,%s,%s,%s,%s)
                """,
                (row_id, month_no, cell["BE"], cell["RE"], cell["Actual"]),
            )
            d.execute(
                """
                INSERT INTO capex_actuals (
                    plan_row_id, month_no, fy_year, amount, created_by, updated_by
                )
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                (row_id, month_no, fy_year, cell["Actual"], SOURCE_TAG, SOURCE_TAG),
            )
            month_count += 1
    return row_count, value_count, month_count


def main() -> None:
    src = psycopg2.connect(SRC_URL)
    dst = psycopg2.connect(DST_URL)
    s = src.cursor(cursor_factory=RealDictCursor)
    d = dst.cursor(cursor_factory=RealDictCursor)

    projects = {int(row["id"]): row for row in fetch_all(s, "SELECT * FROM projects ORDER BY id")}
    plant_details = {
        int(row["project_id"]): row
        for row in fetch_all(s, "SELECT * FROM plant_level_amr_details ORDER BY project_id")
    }
    manpower = fetch_all(s, "SELECT * FROM daily_progress_manpower ORDER BY project_id, report_date, sort_order, id")
    capex_plan = fetch_all(
        s,
        """
        SELECT * FROM capex_plans
        ORDER BY effective DESC, updated_at DESC
        LIMIT 1
        """,
    )
    capex_plan = capex_plan[0] if capex_plan else None

    d.execute(
        """
        SELECT scheme_id, extra_fields->'friend_project_ids' AS ids
        FROM scheme_master
        WHERE extra_fields ? 'friend_project_ids' AND NOT is_deleted
        """
    )
    mapped_before = {int(pid): row["scheme_id"] for row in d.fetchall() for pid in (row["ids"] or [])}

    project_to_scheme: dict[int, int] = {}
    project_to_package: dict[int, int] = {}
    created_or_updated = physical = s1 = s2 = contracts = 0
    for project_id, project in projects.items():
        detail = plant_details.get(project_id)
        scheme_id, package_id = ensure_scheme_and_package(d, project, detail)
        project_to_scheme[project_id] = scheme_id
        project_to_package[project_id] = package_id
        created_or_updated += 1
        a, b, c = sync_approvals_contracts(d, project, scheme_id, package_id)
        s1 += a
        s2 += b
        contracts += c
        physical += sync_physical(d, package_id, detail)

    capex_rows, capex_values, capex_months = sync_capex_plan(d, capex_plan, project_to_scheme)
    manpower_rows = sync_dpr_manpower(d, manpower, project_to_scheme)

    missing_before = sorted(set(projects) - set(mapped_before))
    dst.commit()
    src.close()
    dst.close()
    print(json.dumps({
        "projects_seen": len(projects),
        "projects_created_or_updated": created_or_updated,
        "projects_missing_before_sync": missing_before,
        "stage1_rows_synced": s1,
        "stage2_rows_synced": s2,
        "contracts_synced": contracts,
        "physical_progress_rows_synced": physical,
        "capex_plan_rows_synced": capex_rows,
        "capex_plan_values_synced": capex_values,
        "capex_month_values_synced": capex_months,
        "dpr_manpower_rows_synced": manpower_rows,
    }, indent=2))


if __name__ == "__main__":
    main()
