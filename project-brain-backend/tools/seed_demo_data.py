"""
Seed demo data for COB-7 (scheme_id=74, packages 74/75/76):
  1. billing_schedules — 6 milestones for package 74
  2. daily_actuals    — 30 days of actuals for the locked plan activities
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import date, timedelta
import random

DB_URL = "postgresql://postgres:abc123@127.0.0.1:5432/project_brain"

def main():
    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor(cursor_factory=RealDictCursor)

    # ── 1. Find package 74 activities from locked plan ──────────────────────
    cur.execute("""
        SELECT pa.activity_id, pa.activity_name, pa.scope_qty
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        WHERE pp.package_id = 74
          AND pp.is_locked   = TRUE
          AND pp.is_current  = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order
        LIMIT 10
    """)
    activities = cur.fetchall()
    if not activities:
        print("No locked plan activities for package 74 — run auto-distribute + lock first.")
    else:
        print(f"Found {len(activities)} activities for package 74")

        # ── 2. Seed daily_actuals for last 30 days ──────────────────────────
        today = date.today()
        inserted = 0
        for offset in range(30, 0, -1):
            d = today - timedelta(days=offset)
            for act in activities:
                scope = float(act["scope_qty"] or 100)
                daily = round(scope / 40 * (0.8 + random.random() * 0.4), 2)
                cur.execute("""
                    INSERT INTO daily_actuals
                        (activity_id, actual_date, actual_qty, area_of_work,
                         manpower_count, weather_conditions, remarks, entered_via)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s, 'web')
                    ON CONFLICT (activity_id, actual_date) DO NOTHING
                """, (
                    act["activity_id"], d, daily,
                    random.choice(["Main Bay", "Switchgear Room", "Cable Trench", "Foundation Area"]),
                    random.randint(20, 80),
                    random.choice(["Clear", "Cloudy", "Clear", "Partly Cloudy"]),
                    "Demo seed" if offset % 7 == 0 else None,
                ))
                inserted += 1
        conn.commit()
        print(f"Seeded {inserted} daily_actuals rows")

    # ── 3. Seed billing_schedules for package 74 ─────────────────────────────
    cur.execute("SELECT COUNT(*) as c FROM billing_schedules WHERE package_id=74 AND NOT is_deleted")
    existing = cur.fetchone()["c"]

    if existing >= 6:
        print(f"billing_schedules already has {existing} rows for package 74 — skipping")
    else:
        milestones = [
            (1, "Mobilisation & Site Setup",         4.50,  "2024-09-01", False, False),
            (2, "Civil Foundation Works",            12.00,  "2024-12-01", True,  True ),
            (3, "Structural Steel Erection (50%)",   18.00,  "2025-03-01", True,  False),
            (4, "Structural Steel Erection (100%)",  18.00,  "2025-08-01", False, False),
            (5, "Equipment Supply & Installation",   22.00,  "2025-12-01", False, False),
            (6, "Testing, Commissioning & Handover", 10.00,  "2026-06-01", False, False),
        ]
        for ms_no, desc, amt, sched_date, is_billed, is_paid in milestones:
            actual_amt  = amt * 0.97 if is_billed else None
            billed_date = date(int(sched_date[:4]), int(sched_date[5:7]), 15) if is_billed else None
            paid_date   = billed_date + timedelta(days=45) if is_paid and billed_date else None
            cur.execute("""
                INSERT INTO billing_schedules
                    (package_id, milestone_no, description, scheduled_amount_cr,
                     scheduled_date, actual_amount_cr, actual_billed_date,
                     payment_received_date, is_billed, is_paid)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (package_id, milestone_no) DO NOTHING
            """, (74, ms_no, desc, amt, sched_date,
                  actual_amt, billed_date, paid_date, is_billed, is_paid))
        conn.commit()
        print("Seeded 6 billing milestones for package 74")

    cur.close()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    main()
