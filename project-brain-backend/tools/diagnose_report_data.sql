-- ============================================================
--  Project Brain - REPORT DATA DIAGNOSTIC
--  Run:  psql -d project_brain -f diagnose_report_data.sql
--  Prints row counts for every table the reports read from,
--  in pipeline order. The FIRST stage that shows 0 rows is
--  why your reports are blank. Safe: missing tables are skipped.
-- ============================================================
DO $$
DECLARE
  t text;
  n bigint;
  arr text[] := ARRAY[
    '# 1. MASTERS  (must exist first)',
    'scheme_master', 'packages', 'activity_master_global', 'uom_master',
    '# 2. APPENDIX-2 / ACTIVITIES  (the WBS that everything hangs off)',
    'plan_activities', 'progress_plans',
    '# 3. PLANNED PROGRESS  (S-curve / physical planned %)',
    'monthly_plan_entries',
    '# 4. ACTUAL PROGRESS  (DPR - physical actual %)',
    'daily_actuals', 'plant_progress_monthly',
    '# 5. CAPEX  (financial report source)',
    'capex_plan_header', 'capex_plan_rows', 'capex_plan_values',
    'capex_month_values', 'capex_actuals', 'actuals_month_lock',
    '# 6. APPROVAL TIMELINE  (stages / multiple dates)',
    'scheme_formulation', 'stage1_approvals', 'stage2_approvals', 'tender_cycles',
    '# 7. CONTRACTS / TENDERING',
    'contracts', 'tender_cycles', 'completion_details'
  ];
BEGIN
  RAISE NOTICE '==================================================';
  RAISE NOTICE ' REPORT DATA PIPELINE - row counts';
  RAISE NOTICE '==================================================';
  FOREACH t IN ARRAY arr LOOP
    IF left(t, 1) = '#' THEN
      RAISE NOTICE '';
      RAISE NOTICE '%', substr(t, 2);
      CONTINUE;
    END IF;
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      RAISE NOTICE '   %  %  %', rpad(t, 26), lpad(n::text, 8),
        CASE WHEN n = 0 THEN '<-- EMPTY (blank reports start here)' ELSE '' END;
    ELSE
      RAISE NOTICE '   %  %  (table not found - name differs?)', rpad(t, 26), lpad('-', 8);
    END IF;
  END LOOP;
  RAISE NOTICE '';
  RAISE NOTICE '==================================================';
  RAISE NOTICE ' Read top-to-bottom: the first EMPTY stage is the';
  RAISE NOTICE ' break. e.g. masters full but monthly_plan_entries';
  RAISE NOTICE ' = 0 -> no plan saved -> S-curve/PMC are blank.';
  RAISE NOTICE '==================================================';
END $$;

-- Bonus: per-scheme readiness (which schemes actually have a full chain)
SELECT
  s.scheme_id,
  left(s.scheme_name, 40)                                   AS scheme,
  (SELECT count(*) FROM packages p WHERE p.scheme_id = s.scheme_id)            AS pkgs,
  (SELECT count(*) FROM progress_plans pp
      JOIN packages p ON p.package_id = pp.package_id
     WHERE p.scheme_id = s.scheme_id)                                          AS plans,
  (SELECT count(*) FROM plan_activities pa
      JOIN progress_plans pp ON pp.plan_id = pa.plan_id
      JOIN packages p ON p.package_id = pp.package_id
     WHERE p.scheme_id = s.scheme_id)                                         AS activities,
  (SELECT count(*) FROM daily_actuals da
      JOIN plan_activities pa ON pa.activity_id = da.activity_id
      JOIN progress_plans pp ON pp.plan_id = pa.plan_id
      JOIN packages p ON p.package_id = pp.package_id
     WHERE p.scheme_id = s.scheme_id)                                         AS dpr_rows
FROM scheme_master s
ORDER BY s.scheme_id
LIMIT 25;
