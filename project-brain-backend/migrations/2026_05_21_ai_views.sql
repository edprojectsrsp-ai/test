-- ===========================================================================
-- Sprint AI-DB — Views that the AI tools query
-- ===========================================================================
-- The AI service was built against an "ideal" schema that includes 6 views
-- which were never materialized. This migration creates 5 of them (the 6th,
-- v_active_lifecycle, already exists in your DB). Each view maps directly to
-- your real tables — no extra logic, just the joins the tool code expected.
--
-- These are CREATE OR REPLACE so re-running this file is safe.
-- Run order: this file once. After that the AI tools that previously crashed
-- with "relation does not exist" will return data.
--
-- Also installs pg_trgm for `similarity()` in find_scheme, gated behind
-- IF NOT EXISTS so it's idempotent.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- v_scheme_portfolio — one row per scheme, all the headline KPIs joined
-- Used by: get_scheme_details
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_scheme_portfolio AS
SELECT
    sm.scheme_id,
    sm.scheme_name,
    sm.scheme_type,
    sm.current_status,
    sm.wbs_element,
    sm.ipm_fa_code,
    sm.amr_no,
    sm.estimated_cost_cr,
    sm.sanctioned_cost_cr,
    sm.anticipated_cost_cr,
    sm.scheme_owner_name,
    sm.scheme_owner_designation,
    sm.steering_committee_chair,
    sm.has_multiple_packages,
    sm.created_at,
    sm.updated_at,
    -- Latest stage1 cost (gross/net) for quick KPI display
    (SELECT s1.stage_1_cost_gross FROM scheme_stage1 s1
       WHERE s1.scheme_id = sm.scheme_id
       ORDER BY s1.id DESC LIMIT 1) AS stage1_cost_gross,
    (SELECT s1.stage_1_cost_net FROM scheme_stage1 s1
       WHERE s1.scheme_id = sm.scheme_id
       ORDER BY s1.id DESC LIMIT 1) AS stage1_cost_net,
    -- Latest stage2 firmed cost
    (SELECT s2.firmed_cost_gross FROM scheme_stage2 s2
       WHERE s2.scheme_id = sm.scheme_id
       ORDER BY s2.id DESC LIMIT 1) AS stage2_cost_gross,
    (SELECT s2.firmed_cost_net FROM scheme_stage2 s2
       WHERE s2.scheme_id = sm.scheme_id
       ORDER BY s2.id DESC LIMIT 1) AS stage2_cost_net,
    -- Package counts
    (SELECT COUNT(*) FROM packages p
       WHERE p.scheme_id = sm.scheme_id AND NOT p.is_deleted) AS package_count,
    (SELECT COUNT(*) FROM packages p
       WHERE p.scheme_id = sm.scheme_id AND NOT p.is_deleted
         AND p.package_status = 'under_execution') AS packages_under_execution,
    (SELECT COUNT(*) FROM packages p
       WHERE p.scheme_id = sm.scheme_id AND NOT p.is_deleted
         AND p.package_status = 'completed') AS packages_completed
FROM scheme_master sm
WHERE NOT sm.is_deleted;

-- ---------------------------------------------------------------------------
-- v_scheme_timeline — flattened, chronologically ordered event list for a scheme
-- Used by: get_scheme_timeline
-- Stitches formulation, stage1, tender, stage2, order, closure into one stream.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_scheme_timeline AS
WITH events AS (
    -- ----- Formulation events
    SELECT
        f.formulation_id AS event_id,
        f.scheme_id,
        'formulation'::text AS stage,
        'consultant_acceptance'::text AS event_type,
        f.consultant_acceptance_date AS event_date,
        'Consultant accepted'::text AS event_label,
        NULL::numeric AS cost_cr,
        f.consultant_name AS party_name,
        NULL::integer AS package_id,
        NULL::integer AS document_id,
        f.revision_reason AS notes
    FROM scheme_formulation f
    WHERE f.consultant_acceptance_date IS NOT NULL
    UNION ALL
    SELECT
        f.formulation_id, f.scheme_id, 'formulation', 'draft_fr',
        f.draft_fr_ts_date, 'Draft FR/TS issued',
        NULL, f.consultant_name, NULL, NULL, NULL
    FROM scheme_formulation f WHERE f.draft_fr_ts_date IS NOT NULL
    UNION ALL
    SELECT
        f.formulation_id, f.scheme_id, 'formulation', 'final_fr',
        f.final_fr_ts_ce_ec_date, 'Final FR/TS by CE/EC',
        NULL, NULL, NULL, NULL, NULL
    FROM scheme_formulation f WHERE f.final_fr_ts_ce_ec_date IS NOT NULL
    UNION ALL
    SELECT
        f.formulation_id, f.scheme_id, 'formulation', 'dic_approval',
        f.dic_approval_date, 'DIC approval',
        NULL, NULL, NULL, NULL, NULL
    FROM scheme_formulation f WHERE f.dic_approval_date IS NOT NULL

    -- ----- Stage 1 events
    UNION ALL
    SELECT s1.id, s1.scheme_id, 'stage1', 'assignment',
           s1.assignment_date, 'Stage-I assignment',
           NULL, NULL, NULL, NULL, NULL
    FROM scheme_stage1 s1 WHERE s1.assignment_date IS NOT NULL
    UNION ALL
    SELECT s1.id, s1.scheme_id, 'stage1', 'draft_fr',
           s1.draft_fr_date, 'Stage-I draft FR',
           NULL, NULL, NULL, NULL, NULL
    FROM scheme_stage1 s1 WHERE s1.draft_fr_date IS NOT NULL
    UNION ALL
    SELECT s1.id, s1.scheme_id, 'stage1', 'pag_meeting',
           s1.pag_meeting_date, 'PAG meeting',
           NULL, NULL, NULL, NULL, NULL
    FROM scheme_stage1 s1 WHERE s1.pag_meeting_date IS NOT NULL
    UNION ALL
    SELECT s1.id, s1.scheme_id, 'stage1', 'sanction',
           s1.sanction_date, 'Stage-I sanction',
           s1.stage_1_cost_gross, NULL, NULL, NULL, NULL
    FROM scheme_stage1 s1 WHERE s1.sanction_date IS NOT NULL

    -- ----- Tender events (legacy single-row table — newer multi-cycle data
    -- lives in tender_cycles per-package; this view stays scheme-level)
    UNION ALL
    SELECT t.id, t.scheme_id, 'tender', 'pr_initiation',
           t.pr_initiation_date, 'PR initiated',
           NULL, NULL, NULL, NULL, NULL
    FROM scheme_tender t WHERE t.pr_initiation_date IS NOT NULL
    UNION ALL
    SELECT t.id, t.scheme_id, 'tender', 'nit',
           t.nit_date, COALESCE('NIT ' || t.nit_number, 'NIT issued'),
           NULL, NULL, NULL, NULL, NULL
    FROM scheme_tender t WHERE t.nit_date IS NOT NULL
    UNION ALL
    SELECT t.id, t.scheme_id, 'tender', 'tod',
           t.tod_actual, 'Tenders opened',
           t.l1_cost, t.l1_name, NULL, NULL, NULL
    FROM scheme_tender t WHERE t.tod_actual IS NOT NULL

    -- ----- Stage 2 events
    UNION ALL
    SELECT s2.id, s2.scheme_id, 'stage2', 'sanction',
           s2.stage_2_sanction_date, 'Stage-II sanction',
           s2.firmed_cost_gross, NULL, NULL, NULL, NULL
    FROM scheme_stage2 s2 WHERE s2.stage_2_sanction_date IS NOT NULL

    -- ----- Order events
    UNION ALL
    SELECT o.id, o.scheme_id, 'order', 'loi',
           o.loi_date, 'LoI issued',
           NULL, o.party_name, NULL, NULL, NULL
    FROM scheme_order o WHERE o.loi_date IS NOT NULL
    UNION ALL
    SELECT o.id, o.scheme_id, 'order', 'po',
           o.effective_date, COALESCE('PO ' || o.po_number, 'PO issued'),
           NULL, o.party_name, NULL, NULL, NULL
    FROM scheme_order o WHERE o.effective_date IS NOT NULL

    -- ----- Closure events (package level — bubble up to scheme via the package)
    UNION ALL
    SELECT c.completion_id, p.scheme_id, 'closure', 'pac',
           c.pac_date, 'Provisional acceptance',
           NULL, NULL, c.package_id, NULL, c.remarks
    FROM completion_details c
    JOIN packages p ON p.package_id = c.package_id
    WHERE c.pac_date IS NOT NULL AND NOT p.is_deleted
    UNION ALL
    SELECT c.completion_id, p.scheme_id, 'closure', 'commissioning',
           c.commissioning_date, 'Commissioned',
           NULL, NULL, c.package_id, NULL, c.remarks
    FROM completion_details c
    JOIN packages p ON p.package_id = c.package_id
    WHERE c.commissioning_date IS NOT NULL AND NOT p.is_deleted
    UNION ALL
    SELECT c.completion_id, p.scheme_id, 'closure', 'closure',
           c.closure_date, 'Scheme closed',
           NULL, NULL, c.package_id, NULL, c.remarks
    FROM completion_details c
    JOIN packages p ON p.package_id = c.package_id
    WHERE c.closure_date IS NOT NULL AND NOT p.is_deleted
)
SELECT * FROM events;

-- ---------------------------------------------------------------------------
-- v_package_health — one row per package with the latest progress KPI joined
-- Used by: get_progress_status, analyze_delays (indirectly)
-- ---------------------------------------------------------------------------
-- Note: plant_progress_monthly only stores `cumulative_progress_pct` — it does
-- not track planned-vs-actual separately. We compute planned% from the
-- progress_plans + monthly_plan_entries when available; otherwise we set
-- planned_pct = NULL and variance = NULL (caller should treat as "no plan
-- baselined yet").
CREATE OR REPLACE VIEW public.v_package_health AS
WITH latest_actual AS (
    SELECT DISTINCT ON (ppm.package_id)
        ppm.package_id,
        ppm.progress_month,
        ppm.cumulative_progress_pct,
        ppm.progress_remark
    FROM plant_progress_monthly ppm
    ORDER BY ppm.package_id, ppm.progress_month DESC
),
latest_plan AS (
    SELECT DISTINCT ON (pp.package_id)
        pp.package_id,
        pp.progress_plan_id,
        pp.plan_name,
        pp.financial_year,
        pp.plan_status,
        pp.expected_completion_month
    FROM progress_plans pp
    WHERE pp.plan_status = 'approved'
    ORDER BY pp.package_id, pp.created_at DESC
),
planned_at_latest_actual AS (
    -- For each package, the planned cumulative % at the actual's progress_month
    SELECT
        la.package_id,
        la.progress_month,
        SUM(mpe.planned_qty * pa.weightage / NULLIF(pa.scope_qty, 0))
            FILTER (WHERE mpe.plan_month <= la.progress_month)
          / NULLIF(SUM(pa.weightage), 0) * 100 AS planned_pct
    FROM latest_actual la
    LEFT JOIN plan_activities pa ON pa.package_id = la.package_id
    LEFT JOIN monthly_plan_entries mpe ON mpe.plan_activity_id = pa.plan_activity_id
    GROUP BY la.package_id, la.progress_month
)
SELECT
    p.package_id,
    p.scheme_id,
    p.package_no,
    p.package_name,
    p.package_status,
    p.package_estimate_cr,
    p.package_value_cr,
    p.project_manager_name,
    p.is_scheme_mirror,
    sm.scheme_name,
    sm.scheme_type,
    sm.current_status AS scheme_status,
    la.progress_month AS latest_progress_month,
    la.cumulative_progress_pct AS cumulative_actual_pct,
    la.progress_remark,
    pp.plan_name AS active_plan_name,
    pp.financial_year AS active_plan_fy,
    pp.expected_completion_month,
    pal.planned_pct AS cumulative_planned_pct,
    CASE
      WHEN pal.planned_pct IS NULL OR la.cumulative_progress_pct IS NULL THEN NULL
      ELSE (la.cumulative_progress_pct - pal.planned_pct)::numeric
    END AS variance_pct
FROM packages p
JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
LEFT JOIN latest_actual la ON la.package_id = p.package_id
LEFT JOIN latest_plan pp ON pp.package_id = p.package_id
LEFT JOIN planned_at_latest_actual pal ON pal.package_id = p.package_id
WHERE NOT p.is_deleted AND NOT sm.is_deleted;

-- ---------------------------------------------------------------------------
-- v_at_risk_packages — packages where actual lags planned by 5%+, or status on_hold
-- Used by: get_today_dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_at_risk_packages AS
SELECT
    package_id,
    scheme_id,
    scheme_name,
    package_name,
    package_status,
    cumulative_planned_pct,
    cumulative_actual_pct,
    variance_pct,
    latest_progress_month,
    project_manager_name,
    CASE
      WHEN package_status = 'on_hold' THEN 'on_hold'
      WHEN variance_pct IS NULL THEN 'no_baseline'
      WHEN variance_pct <= -10 THEN 'severe'
      WHEN variance_pct <= -5 THEN 'amber'
      ELSE 'minor'
    END AS risk_bucket
FROM v_package_health
WHERE package_status NOT IN ('completed', 'dropped')
  AND (
      package_status = 'on_hold'
      OR (variance_pct IS NOT NULL AND variance_pct <= -5)
  )
ORDER BY
    CASE
      WHEN package_status = 'on_hold' THEN 1
      WHEN variance_pct <= -10 THEN 2
      WHEN variance_pct <= -5 THEN 3
      ELSE 4
    END,
    variance_pct ASC NULLS LAST;

-- ---------------------------------------------------------------------------
-- v_open_commitments — TOD/payment/extension actions that are pending or overdue
-- Used by: list_open_commitments, get_today_dashboard
-- ---------------------------------------------------------------------------
-- Your schema doesn't have a dedicated commitments table; commitments are
-- inferred from contracts (likely_completion_date past today with no PAC),
-- tender_cycles (tod_original_date scheduled but no offers), and
-- monitoring_log (overdue action_taken entries). This view normalizes them
-- into a single shape the tool expects.
CREATE OR REPLACE VIEW public.v_open_commitments AS
-- Late contracts (scheduled completion passed, no PAC yet)
SELECT
    'contract'::text AS source,
    c.contract_id AS source_id,
    p.scheme_id,
    c.package_id,
    sm.scheme_name,
    p.package_name,
    COALESCE('Contract ' || c.contract_no, 'Contract overdue') AS title,
    c.scheduled_completion_date AS due_date,
    CASE
      WHEN c.scheduled_completion_date < CURRENT_DATE - INTERVAL '30 days' THEN 'overdue'
      WHEN c.scheduled_completion_date < CURRENT_DATE THEN 'due_soon'
      ELSE 'open'
    END AS urgency,
    c.contractor_name AS counterparty,
    c.delay_reason AS notes
FROM contracts c
JOIN packages p ON p.package_id = c.package_id
JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
LEFT JOIN completion_details cd ON cd.package_id = c.package_id AND cd.pac_date IS NOT NULL
WHERE c.scheduled_completion_date IS NOT NULL
  AND cd.completion_id IS NULL
  AND NOT p.is_deleted AND NOT sm.is_deleted

UNION ALL

-- Open tender cycles whose TOD has passed but no offers logged
SELECT
    'tender_cycle'::text AS source,
    tc.tender_cycle_id AS source_id,
    p.scheme_id,
    tc.package_id,
    sm.scheme_name,
    p.package_name,
    COALESCE('TOD ' || tc.nit_number, 'Tender opening pending') AS title,
    tc.tod_original_date AS due_date,
    CASE
      WHEN tc.tod_original_date < CURRENT_DATE - INTERVAL '14 days' THEN 'overdue'
      WHEN tc.tod_original_date < CURRENT_DATE THEN 'due_soon'
      ELSE 'open'
    END AS urgency,
    NULL::varchar AS counterparty,
    tc.remarks AS notes
FROM tender_cycles tc
JOIN packages p ON p.package_id = tc.package_id
JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
WHERE tc.is_current
  AND tc.cycle_status = 'active'
  AND tc.tod_original_date IS NOT NULL
  AND COALESCE(tc.offers_received_count, 0) = 0
  AND NOT p.is_deleted AND NOT sm.is_deleted

UNION ALL

-- Monitoring log entries flagged with progress_status != 'on_track' as commitments
SELECT
    'monitoring_log'::text AS source,
    ml.log_id AS source_id,
    ml.scheme_id,
    ml.package_id,
    sm.scheme_name,
    p.package_name,
    COALESCE(ml.action_taken, 'Pending action from monitoring log') AS title,
    ml.log_date AS due_date,
    CASE
      WHEN ml.log_date < CURRENT_DATE - INTERVAL '14 days' THEN 'overdue'
      WHEN ml.log_date < CURRENT_DATE THEN 'due_soon'
      ELSE 'open'
    END AS urgency,
    NULL::varchar AS counterparty,
    ml.issues AS notes
FROM monitoring_log ml
JOIN scheme_master sm ON sm.scheme_id = ml.scheme_id
LEFT JOIN packages p ON p.package_id = ml.package_id
WHERE ml.progress_status IS NOT NULL
  AND ml.progress_status <> 'on_track'
  AND NOT sm.is_deleted;

-- ---------------------------------------------------------------------------
-- v_hub_tiers — top-level rollup used by the dashboard tool
-- Used by: get_today_dashboard
-- ---------------------------------------------------------------------------
-- Returns three rows, one per tier (corporate / plant / dummy), with counts
-- and aggregate KPIs. If the tool needs a different shape later, edit here.
CREATE OR REPLACE VIEW public.v_hub_tiers AS
SELECT
    sm.scheme_type AS tier,
    COUNT(*) FILTER (WHERE NOT sm.is_deleted) AS total_schemes,
    COUNT(*) FILTER (WHERE sm.current_status = 'ongoing'
                       AND NOT sm.is_deleted) AS ongoing_schemes,
    COUNT(*) FILTER (WHERE sm.current_status = 'closed'
                       AND NOT sm.is_deleted) AS closed_schemes,
    COUNT(*) FILTER (WHERE sm.current_status IN ('under_formulation', 'under_stage1',
                                                  'under_tendering', 'under_stage2')
                       AND NOT sm.is_deleted) AS pipeline_schemes,
    COALESCE(SUM(sm.sanctioned_cost_cr) FILTER (WHERE NOT sm.is_deleted), 0) AS sanctioned_cr,
    COALESCE(SUM(sm.anticipated_cost_cr) FILTER (WHERE NOT sm.is_deleted), 0) AS anticipated_cr
FROM scheme_master sm
GROUP BY sm.scheme_type;

-- ===========================================================================
-- Sanity verification
-- ===========================================================================
DO $$
BEGIN
    -- Each view should have at least one row OR be queryable without error.
    -- We don't fail on empty results — empty just means no data yet.
    PERFORM 1 FROM v_scheme_portfolio LIMIT 1;
    PERFORM 1 FROM v_scheme_timeline LIMIT 1;
    PERFORM 1 FROM v_package_health LIMIT 1;
    PERFORM 1 FROM v_at_risk_packages LIMIT 1;
    PERFORM 1 FROM v_open_commitments LIMIT 1;
    PERFORM 1 FROM v_hub_tiers LIMIT 1;
    RAISE NOTICE 'All AI views created successfully';
END $$;
