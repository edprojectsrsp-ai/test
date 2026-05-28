#!/usr/bin/env python3
"""
seed_cob7_progress.py — REVERSIBLE test seed for the S-curve / physical progress.

Creates a clean, self-consistent set of plan + monthly-planned + daily-actual
rows for COB-7 (scheme_id=74, packages 74/75/76) so the dashboard S-curve and
physical-financial table render with realistic data.

SAFETY / REVERSIBILITY:
  * Every inserted row is tagged: extra_fields/notes carry SEED_TAG below.
  * Run with  --seed   to insert,  --unseed  to delete ONLY the tagged rows,
    --status to count tagged rows. Default (no flag) prints help.
  * Idempotent: --seed first removes any existing tagged rows, then inserts,
    so re-running never duplicates.
  * Touches ONLY: progress_plans, plan_activities, monthly_plan_entries,
    daily_actuals — and ONLY rows it created. Your 74 schemes/packages and
    CAPEX are never touched.

USAGE (Windows):
  set DATABASE_URL=postgresql+psycopg2://postgres:abc123@127.0.0.1:5432/project_brain
  python seed_cob7_progress.py --seed
  python seed_cob7_progress.py --status
  python seed_cob7_progress.py --unseed     # full clean rollback
"""

import os
import sys
from datetime import date

SEED_TAG = "COB7_SCURVE_TEST_SEED"     # the marker that makes this reversible
SCHEME_ID = 74
PACKAGE_IDS = [74, 75, 76]

# A simple, realistic 12-month plan per package. Quantities chosen so a fully
# delivered plan reaches ~100%. Actuals run slightly behind plan (realistic).
MONTHS = [date(2026, m, 1) for m in range(4, 13)] + [date(2027, m, 1) for m in range(1, 4)]  # Apr-26..Mar-27

# Per package: list of (activity_name, weight_pct, scope_qty, uom-less)
PACKAGE_ACTIVITIES = {
    74: [("Civil & Foundation", 30, 100.0), ("Mechanical Erection", 40, 100.0), ("Commissioning", 30, 100.0)],
    75: [("Structural Steel", 50, 100.0), ("Piping & Utilities", 50, 100.0)],
    76: [("Refractory", 60, 100.0), ("Electricals & Instrumentation", 40, 100.0)],
}


def _engine():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: set DATABASE_URL first.")
        sys.exit(1)
    from sqlalchemy import create_engine
    return create_engine(url)


def _spread(total, n):
    """Spread `total` qty across n months as a simple ramp (front-light)."""
    if n <= 0:
        return []
    base = total / n
    return [round(base, 3)] * n


def unseed(conn):
    from sqlalchemy import text
    # delete children first (FK order): daily_actuals -> monthly_plan_entries
    # -> plan_activities -> progress_plans, all by tag.
    d1 = conn.execute(text(
        "DELETE FROM daily_actuals WHERE activity_id IN "
        "(SELECT activity_id FROM plan_activities WHERE extra_fields->>'seed_tag' = :t)"
    ), {"t": SEED_TAG}).rowcount
    d2 = conn.execute(text(
        "DELETE FROM monthly_plan_entries WHERE activity_id IN "
        "(SELECT activity_id FROM plan_activities WHERE extra_fields->>'seed_tag' = :t)"
    ), {"t": SEED_TAG}).rowcount
    d3 = conn.execute(text(
        "DELETE FROM plan_activities WHERE extra_fields->>'seed_tag' = :t"
    ), {"t": SEED_TAG}).rowcount
    d4 = conn.execute(text(
        "DELETE FROM progress_plans WHERE extra_fields->>'seed_tag' = :t"
    ), {"t": SEED_TAG}).rowcount
    print(f"  removed: daily_actuals={d1}, monthly={d2}, activities={d3}, plans={d4}")


def status(conn):
    from sqlalchemy import text
    p = conn.execute(text("SELECT count(*) FROM progress_plans WHERE extra_fields->>'seed_tag'=:t"), {"t": SEED_TAG}).scalar()
    a = conn.execute(text("SELECT count(*) FROM plan_activities WHERE extra_fields->>'seed_tag'=:t"), {"t": SEED_TAG}).scalar()
    m = conn.execute(text(
        "SELECT count(*) FROM monthly_plan_entries WHERE activity_id IN "
        "(SELECT activity_id FROM plan_activities WHERE extra_fields->>'seed_tag'=:t)"), {"t": SEED_TAG}).scalar()
    d = conn.execute(text(
        "SELECT count(*) FROM daily_actuals WHERE activity_id IN "
        "(SELECT activity_id FROM plan_activities WHERE extra_fields->>'seed_tag'=:t)"), {"t": SEED_TAG}).scalar()
    print(f"  tagged rows -> plans={p}, activities={a}, monthly={m}, daily_actuals={d}")


def seed(conn):
    from sqlalchemy import text
    import json

    # idempotent: clear any prior seed first
    unseed(conn)

    for pkg_id in PACKAGE_IDS:
        acts = PACKAGE_ACTIVITIES.get(pkg_id, [])
        if not acts:
            continue
        # 1) plan (current)
        plan_id = conn.execute(text("""
            INSERT INTO progress_plans
              (package_id, plan_name, plan_type, financial_year, plan_version,
               is_current, is_locked, plan_start_date, plan_end_date, description,
               extra_fields, is_deleted, created_at, updated_at)
            VALUES
              (:pkg, :name, 'execution', '2026-2027', 'v1',
               true, false, :start, :end, 'Synthetic test plan (reversible)',
               :ef, false, now(), now())
            RETURNING plan_id
        """), {
            "pkg": pkg_id,
            "name": f"COB-7 Pkg {pkg_id} Plan FY26-27",
            "start": MONTHS[0],
            "end": MONTHS[-1],
            "ef": json.dumps({"seed_tag": SEED_TAG}),
        }).scalar()

        for (aname, weight, scope) in acts:
            activity_id = conn.execute(text("""
                INSERT INTO plan_activities
                  (plan_id, activity_name, activity_category, scope_qty, weight_pct,
                   planned_start_date, planned_finish_date, actuals_till_last_fy,
                   sort_order, is_deleted, extra_fields, created_at, updated_at)
                VALUES
                  (:plan, :name, 'work', :scope, :w,
                   :start, :end, 0, 0, false, :ef, now(), now())
                RETURNING activity_id
            """), {
                "plan": plan_id, "name": aname, "scope": scope, "w": weight,
                "start": MONTHS[0], "end": MONTHS[-1],
                "ef": json.dumps({"seed_tag": SEED_TAG}),
            }).scalar()

            # 2) monthly planned entries: spread scope across months
            planned_each = _spread(scope, len(MONTHS))
            for m, q in zip(MONTHS, planned_each):
                conn.execute(text("""
                    INSERT INTO monthly_plan_entries
                      (activity_id, month_date, planned_qty, row_type, created_at, updated_at)
                    VALUES (:a, :m, :q, 'plan', now(), now())
                """), {"a": activity_id, "m": m, "q": q})

            # 3) daily actuals: run ~85% of plan, lagging the last 2 months
            actual_each = _spread(scope * 0.85, len(MONTHS) - 2) + [0.0, 0.0]
            for m, q in zip(MONTHS, actual_each):
                if q <= 0:
                    continue
                conn.execute(text("""
                    INSERT INTO daily_actuals
                      (activity_id, actual_date, actual_qty, area_of_work,
                       remarks, entered_via, created_at, updated_at)
                    VALUES (:a, :d, :q, 'site', 'seed', 'web', now(), now())
                """), {"a": activity_id, "d": date(m.year, m.month, 15), "q": q})

    print("  seed inserted for COB-7 packages", PACKAGE_IDS)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("--seed", "--unseed", "--status"):
        print(__doc__)
        return 0
    from sqlalchemy import create_engine  # noqa
    eng = _engine()
    mode = sys.argv[1]
    with eng.begin() as conn:   # single transaction — all-or-nothing
        if mode == "--seed":
            print("[SEED] COB-7 progress (transactional, reversible)")
            seed(conn)
        elif mode == "--unseed":
            print("[UNSEED] removing tagged COB-7 seed rows")
            unseed(conn)
        elif mode == "--status":
            status(conn)
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
