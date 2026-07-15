"""Synchronize one friend's DPR project into one normalized package.

This intentionally updates only the selected package's current plan, DPR
actuals, monthly plans, and package-level CAPEX snapshot.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def source_connection(env: dict[str, str]):
    return psycopg2.connect(
        host=env.get("PROJECT_BRAIN_DB_HOST", "localhost"),
        port=env.get("PROJECT_BRAIN_DB_PORT", "5432"),
        dbname=env.get("PROJECT_BRAIN_DB_NAME", "project_brain"),
        user=env.get("PROJECT_BRAIN_DB_USER", "postgres"),
        password=env.get("PROJECT_BRAIN_DB_PASSWORD", ""),
        sslmode=env.get("PROJECT_BRAIN_DB_SSLMODE", "prefer"),
        cursor_factory=RealDictCursor,
    )


def normalize(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def split_activity(value: object) -> tuple[str, str]:
    full = str(value or "Activity").strip()
    if "->" not in full:
        return "", full
    parent, name = full.split("->", 1)
    return parent.strip(), name.strip()


def number(value: object) -> float:
    try:
        return float(str(value or "0").replace(",", "").strip())
    except ValueError:
        return 0.0


def month_date(value: object) -> date:
    return datetime.strptime(str(value).strip(), "%b-%y").date().replace(day=1)


def capex_snapshot(source_cursor, project_id: int) -> tuple[str, dict]:
    source_cursor.execute(
        """SELECT financial_year, rows_json FROM capex_plans
           ORDER BY effective DESC, updated_at DESC LIMIT 1"""
    )
    plan = source_cursor.fetchone()
    if not plan:
        return "", {}
    rows = json.loads(plan.get("rows_json") or "[]")
    row = next(
        (item for item in rows if str(item.get("source_project_id") or "") == str(project_id)),
        None,
    )
    if not row:
        return "", {}
    values = row.get("values") or {}
    fy_match = re.search(r"(\d{4})-(\d{4})", str(plan.get("financial_year") or ""))
    if not fy_match:
        return "", {}
    fy_key = f"{fy_match.group(1)}-{fy_match.group(2)[-2:]}"
    monthly_plan: dict[str, float] = {}
    monthly_actual: dict[str, float] = {}
    for label in re.findall(r"[A-Z][a-z]{2}-\d{2}", " ".join(values.keys())):
        parsed = month_date(label)
        monthly_plan[str(parsed.month)] = number(values.get(f"{label} RE") or values.get(f"{label} BE"))
        monthly_actual[str(parsed.month)] = number(values.get(f"{label} Actual"))
    return fy_key, {
        "source_project_id": project_id,
        "gross_cost": number(values.get("Gross Cost")),
        "exp_last_fy": number(values.get("Cummulative Expenditure till Last FY")),
        "monthly_plan": monthly_plan,
        "monthly_actual": monthly_actual,
    }


def sync(source_root: Path, destination_root: Path, project_id: int, package_id: int) -> dict:
    source_env = load_env(source_root / ".env.local")
    destination_env = load_env(destination_root / ".env")
    destination_url = destination_env.get("DATABASE_URL")
    if not destination_url:
        raise RuntimeError("DATABASE_URL is missing from the destination .env")

    source = source_connection(source_env)
    destination = psycopg2.connect(destination_url, cursor_factory=RealDictCursor)
    try:
        sc = source.cursor()
        dc = destination.cursor()
        sc.execute(
            """SELECT * FROM plans WHERE project_id=%s
               AND COALESCE(is_active, 'N')='Y' AND COALESCE(is_locked, 'N')='Y'
               ORDER BY id DESC LIMIT 1""",
            (project_id,),
        )
        source_plan = sc.fetchone()
        if not source_plan:
            raise RuntimeError(f"No active locked source plan for project {project_id}")

        sc.execute(
            "SELECT * FROM activities WHERE project_id=%s AND plan_name=%s ORDER BY id",
            (project_id, source_plan["plan_name"]),
        )
        source_activities = sc.fetchall()
        dc.execute(
            """SELECT pp.plan_id, pa.* FROM progress_plans pp
               JOIN plan_activities pa ON pa.plan_id=pp.plan_id AND NOT pa.is_deleted
               WHERE pp.package_id=%s AND pp.is_current AND pp.is_locked AND NOT pp.is_deleted
               ORDER BY pa.sort_order, pa.activity_id""",
            (package_id,),
        )
        destination_activities = dc.fetchall()
        if not destination_activities:
            raise RuntimeError(f"No current locked destination plan for package {package_id}")

        destination_by_key = {
            (normalize(row["activity_category"]), normalize(row["activity_name"])): row
            for row in destination_activities
        }
        activity_map: dict[int, int] = {}
        for source_activity in source_activities:
            parent, name = split_activity(source_activity["activity_type"])
            destination_activity = destination_by_key.get((normalize(parent), normalize(name)))
            if not destination_activity:
                raise RuntimeError(f"Unmatched source activity: {source_activity['activity_type']}")
            source_id = int(source_activity["id"])
            destination_id = int(destination_activity["activity_id"])
            activity_map[source_id] = destination_id
            dc.execute(
                """UPDATE plan_activities SET scope_qty=%s, weight_pct=%s,
                   planned_start_date=%s, planned_finish_date=%s,
                   expected_finish_date=%s, actuals_till_last_fy=%s,
                   extra_fields=COALESCE(extra_fields, '{}'::jsonb) || %s::jsonb,
                   updated_at=CURRENT_TIMESTAMP WHERE activity_id=%s""",
                (
                    source_activity.get("scope_qty") or 0,
                    source_activity.get("weight_percent") or 0,
                    source_activity.get("start_date") or None,
                    source_activity.get("finish_date") or None,
                    source_activity.get("expected_finish") or None,
                    source_activity.get("actuals_till_last_fy") or 0,
                    json.dumps({"friend_source_activity_id": source_id}),
                    destination_id,
                ),
            )

        destination_ids = list(activity_map.values())
        dc.execute("DELETE FROM monthly_plan_entries WHERE activity_id = ANY(%s)", (destination_ids,))
        sc.execute(
            """SELECT activity_type, month, SUM(planned_qty) AS planned_qty
               FROM monthly_plans WHERE project_id=%s AND plan_name=%s
               GROUP BY activity_type, month""",
            (project_id, source_plan["plan_name"]),
        )
        source_by_type = {str(row["activity_type"]).strip(): sid for sid, row in ((int(a["id"]), a) for a in source_activities)}
        monthly_count = 0
        for row in sc.fetchall():
            source_id = source_by_type.get(str(row["activity_type"]).strip())
            if source_id not in activity_map:
                continue
            dc.execute(
                """INSERT INTO monthly_plan_entries
                   (activity_id, month_date, planned_qty, row_type)
                   VALUES (%s,%s,%s,'plan')""",
                (activity_map[source_id], month_date(row["month"]), row["planned_qty"] or 0),
            )
            monthly_count += 1

        dc.execute("DELETE FROM daily_actuals WHERE activity_id = ANY(%s)", (destination_ids,))
        sc.execute(
            """SELECT activity_id, actual_date, SUM(actual_qty) AS actual_qty,
                      MAX(COALESCE(area_of_work,'')) AS area_of_work,
                      MAX(COALESCE(remarks,'')) AS remarks
               FROM daily_actuals WHERE activity_id = ANY(%s)
               GROUP BY activity_id, actual_date ORDER BY activity_id, actual_date""",
            (list(activity_map.keys()),),
        )
        actual_count = 0
        for row in sc.fetchall():
            dc.execute(
                """INSERT INTO daily_actuals
                   (activity_id, actual_date, actual_qty, area_of_work, remarks, entered_via)
                   VALUES (%s,%s,%s,%s,%s,'friend_sync')""",
                (
                    activity_map[int(row["activity_id"])], row["actual_date"],
                    row["actual_qty"] or 0, row["area_of_work"], row["remarks"],
                ),
            )
            actual_count += 1

        fy_key, capex = capex_snapshot(sc, project_id)
        if capex:
            dc.execute(
                """UPDATE packages SET extra_fields=COALESCE(extra_fields, '{}'::jsonb)
                   || jsonb_build_object('friend_capex_by_fy',
                      COALESCE(extra_fields->'friend_capex_by_fy', '{}'::jsonb)
                      || jsonb_build_object(%s, %s::jsonb)), updated_at=CURRENT_TIMESTAMP
                   WHERE package_id=%s""",
                (fy_key, json.dumps(capex), package_id),
            )

        destination.commit()
        return {
            "source_project_id": project_id,
            "package_id": package_id,
            "plan": source_plan["plan_name"],
            "activities": len(activity_map),
            "monthly_plan_rows": monthly_count,
            "daily_actual_rows": actual_count,
            "capex_financial_year": fy_key,
        }
    except Exception:
        destination.rollback()
        raise
    finally:
        source.close()
        destination.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--destination-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--source-project", type=int, required=True)
    parser.add_argument("--package", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(sync(args.source_root, args.destination_root, args.source_project, args.package), indent=2))


if __name__ == "__main__":
    main()
