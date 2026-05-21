"""
Sprint 7 — Risk indicator nightly job

Computes 5 risk rules for every active package and persists results to
risk_indicators table. Run via cron or scheduled task.

Rules:
  1. schedule_slip      — cumulative actual vs cumulative planned diverging
  2. cost_overrun       — anticipated cost > sanctioned cost by ≥5%
  3. no_progress_30d    — no daily_actuals or progress entries in 30 days
  4. retender_imminent  — tender_cycle is cancelled/rpn_issued without next cycle
  5. missing_actuals    — gap > 14 days between planned start and any actuals

Usage:
    python compute_risks.py --db "postgresql://postgres:abc123@127.0.0.1:5433/project_brain"
    # Or schedule:  0 2 * * *   /usr/bin/python3 /opt/pb/compute_risks.py
"""
import argparse, json
from datetime import date, timedelta
import psycopg2
import psycopg2.extras


RULES = [
    {
        'key': 'schedule_slip',
        'label': 'Schedule Slip',
        'sql': """
            SELECT p.package_id,
                CASE
                    WHEN ppm.variance_pct <= -10 THEN 'red'
                    WHEN ppm.variance_pct <= -3 THEN 'amber'
                    ELSE 'green'
                END AS level,
                ABS(ppm.variance_pct) AS score,
                jsonb_build_object(
                    'cumulative_planned_pct', ppm.cumulative_planned_pct,
                    'cumulative_actual_pct', ppm.cumulative_actual_pct,
                    'variance_pct', ppm.variance_pct,
                    'month', ppm.month_date
                ) AS factors,
                CASE
                    WHEN ppm.variance_pct <= -10
                        THEN 'Schedule slipped by ' || ABS(ppm.variance_pct) || '%. Recovery plan required.'
                    WHEN ppm.variance_pct <= -3
                        THEN 'Schedule trending behind. Monitor closely.'
                    ELSE 'On track or ahead of schedule.'
                END AS action
            FROM packages p
            JOIN LATERAL (
                SELECT * FROM plant_progress_monthly
                WHERE package_id=p.package_id ORDER BY month_date DESC LIMIT 1
            ) ppm ON TRUE
            WHERE NOT p.is_deleted AND NOT p.is_scheme_mirror
              AND p.package_status='in_progress'::package_status_enum
        """
    },
    {
        'key': 'cost_overrun',
        'label': 'Cost Overrun',
        'sql': """
            SELECT sm.scheme_id::int AS package_id, -- store scheme-level
                CASE
                    WHEN COALESCE(sm.anticipated_cost_cr, 0) >= 1.10 * COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr) THEN 'red'
                    WHEN COALESCE(sm.anticipated_cost_cr, 0) >= 1.05 * COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr) THEN 'amber'
                    ELSE 'green'
                END AS level,
                ROUND(((COALESCE(sm.anticipated_cost_cr, 0) - COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr))
                       / NULLIF(COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr), 0) * 100)::numeric, 2) AS score,
                jsonb_build_object(
                    'sanctioned_cr', sm.sanctioned_cost_cr,
                    'estimated_cr', sm.estimated_cost_cr,
                    'anticipated_cr', sm.anticipated_cost_cr
                ) AS factors,
                'Anticipated cost exceeds baseline. Review CAPEX revision.' AS action
            FROM scheme_master sm
            WHERE NOT sm.is_deleted AND sm.current_status NOT IN ('closed','dropped')
              AND COALESCE(sm.anticipated_cost_cr, 0) >= 1.05 * COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr)
              AND COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr, 0) > 0
        """,
        'scope': 'scheme'
    },
    {
        'key': 'no_progress_30d',
        'label': 'No Progress Reported in 30 Days',
        'sql': """
            SELECT p.package_id, 'red' AS level, 30 AS score,
                jsonb_build_object(
                    'last_actual_date', last_actual_date,
                    'days_since', CURRENT_DATE - last_actual_date
                ) AS factors,
                'No daily actuals in 30+ days. Confirm work is happening on site.' AS action
            FROM packages p
            LEFT JOIN LATERAL (
                SELECT MAX(da.actual_date) AS last_actual_date
                FROM plan_activities pa
                JOIN progress_plans pp ON pp.plan_id=pa.plan_id
                LEFT JOIN daily_actuals da ON da.activity_id=pa.activity_id
                WHERE pp.package_id=p.package_id AND pp.is_current=TRUE
            ) la ON TRUE
            WHERE NOT p.is_deleted AND NOT p.is_scheme_mirror
              AND p.package_status='in_progress'::package_status_enum
              AND (last_actual_date IS NULL OR CURRENT_DATE - last_actual_date > 30)
              AND p.start_date_actual IS NOT NULL
              AND CURRENT_DATE - p.start_date_actual > 30
        """
    },
    {
        'key': 'retender_imminent',
        'label': 'Retender Imminent',
        'sql': """
            SELECT tc.package_id, 'amber' AS level, 50 AS score,
                jsonb_build_object(
                    'tender_cycle_id', tc.tender_cycle_id,
                    'cycle_status', tc.cycle_status,
                    'cancellation_date', tc.cancellation_date,
                    'rpn_date', tc.rpn_date
                ) AS factors,
                'Tender cycle ended without award. Initiate retender process.' AS action
            FROM tender_cycles tc
            WHERE tc.cycle_status IN ('cancelled','rpn_issued')
              AND NOT EXISTS (
                  SELECT 1 FROM tender_cycles tc2
                  WHERE tc2.package_id=tc.package_id AND tc2.cycle_no > tc.cycle_no
              )
              AND tc.is_current=TRUE
        """
    },
    {
        'key': 'missing_actuals',
        'label': 'Missing Actuals After Planned Start',
        'sql': """
            SELECT pp.package_id, 'amber' AS level,
                (CURRENT_DATE - MIN(pa.planned_start_date)) AS score,
                jsonb_build_object(
                    'earliest_planned_start', MIN(pa.planned_start_date),
                    'days_overdue', CURRENT_DATE - MIN(pa.planned_start_date)
                ) AS factors,
                'Activities planned to start but no actuals reported. Update site diary.' AS action
            FROM plan_activities pa
            JOIN progress_plans pp ON pp.plan_id=pa.plan_id
            WHERE pp.is_current=TRUE AND NOT pa.is_deleted
              AND pa.planned_start_date < CURRENT_DATE - INTERVAL '14 days'
              AND NOT EXISTS (SELECT 1 FROM daily_actuals da WHERE da.activity_id=pa.activity_id)
            GROUP BY pp.package_id
            HAVING COUNT(*) > 0
        """
    },
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--db', required=True)
    p.add_argument('--verbose', action='store_true')
    args = p.parse_args()

    conn = psycopg2.connect(args.db)
    cur = conn.cursor()

    # Deactivate previous indicators
    cur.execute("UPDATE risk_indicators SET is_active=FALSE WHERE is_active=TRUE")
    print(f"Deactivated {cur.rowcount} previous indicators")

    total_inserted = 0
    for rule in RULES:
        scope = rule.get('scope', 'package')
        try:
            cur.execute(rule['sql'])
            results = cur.fetchall()
            cols = [d[0] for d in cur.description]
            for r in results:
                row = dict(zip(cols, r))
                pid = row['package_id']
                cur.execute("""
                    INSERT INTO risk_indicators(
                        scheme_id, package_id, indicator_key, indicator_label,
                        risk_level, risk_score, contributing_factors, suggested_action,
                        is_active)
                    VALUES(%s, %s, %s, %s, %s::risk_level_enum, %s, %s::jsonb, %s, TRUE)
                """, (
                    pid if scope == 'scheme' else None,
                    pid if scope == 'package' else None,
                    rule['key'], rule['label'],
                    row['level'], row.get('score'),
                    json.dumps(row.get('factors', {}), default=str),
                    row.get('action'),
                ))
                total_inserted += 1
                if args.verbose:
                    print(f"  {rule['key']}: id={pid} level={row['level']} score={row.get('score')}")
        except Exception as e:
            print(f"  ! Rule {rule['key']} failed: {str(e)[:150]}")
            conn.rollback()
            continue
        conn.commit()
        print(f"Rule '{rule['key']}': {len(results)} indicators")

    # Log to monitoring
    cur.execute("""
        INSERT INTO monitoring_log(event_type, severity, source, message, payload)
        VALUES('risk_computation', 'info', 'compute_risks.py',
               'Nightly risk indicators computed',
               jsonb_build_object('total_indicators', %s, 'date', CURRENT_DATE::text))
    """, (total_inserted,))
    conn.commit()

    print(f"\n✅ Total: {total_inserted} active risk indicators")
    conn.close()


if __name__ == '__main__':
    main()
