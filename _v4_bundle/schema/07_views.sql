-- ============================================================================
-- 07 VIEWS — single source of truth for all read paths
-- ============================================================================
BEGIN;

CREATE OR REPLACE VIEW v_scheme_portfolio AS
SELECT
    sm.scheme_id, sm.scheme_code, sm.scheme_name, sm.scheme_type, sm.current_status,
    COALESCE(s2.firmed_up_cost_net_itc_cr, s1.cost_net_itc_cr,
             f.cost_net_itc_cr, sm.estimated_cost_cr) AS current_cost_cr,
    sm.sanctioned_cost_cr, sm.anticipated_cost_cr,
    (SELECT COUNT(*) FROM packages p WHERE p.scheme_id=sm.scheme_id AND NOT p.is_deleted) AS package_count,
    (SELECT COUNT(*) FROM packages p WHERE p.scheme_id=sm.scheme_id AND NOT p.is_deleted
        AND NOT p.is_scheme_mirror) AS real_package_count,
    (SELECT ROUND(AVG(ppm.actual_progress_pct)::numeric, 2)
        FROM plant_progress_monthly ppm JOIN packages p ON p.package_id=ppm.package_id
        WHERE p.scheme_id=sm.scheme_id AND ppm.month_date=(
            SELECT MAX(month_date) FROM plant_progress_monthly
            WHERE package_id IN (SELECT package_id FROM packages WHERE scheme_id=sm.scheme_id))
    ) AS latest_actual_progress_pct,
    (SELECT MAX(CASE risk_level WHEN 'red' THEN 4 WHEN 'amber' THEN 3 WHEN 'green' THEN 2 ELSE 1 END)
        FROM risk_indicators ri WHERE (ri.scheme_id=sm.scheme_id
            OR ri.package_id IN (SELECT package_id FROM packages WHERE scheme_id=sm.scheme_id))
        AND ri.is_active=TRUE) AS worst_risk_rank,
    sm.planned_start_date, sm.planned_completion_date,
    sm.actual_start_date, sm.actual_completion_date,
    sm.scheme_owner_id, sm.scheme_owner_name,
    (SELECT array_agg(t.tag_name ORDER BY t.tag_name) FROM scheme_tag_links stl
        JOIN scheme_tags t ON t.tag_id=stl.tag_id WHERE stl.scheme_id=sm.scheme_id) AS tags,
    (SELECT COUNT(*) FROM documents d WHERE d.scheme_id=sm.scheme_id AND NOT d.is_deleted) AS doc_count,
    sm.created_at, sm.updated_at
FROM scheme_master sm
LEFT JOIN scheme_formulation f ON f.scheme_id=sm.scheme_id AND f.is_current=TRUE
LEFT JOIN stage1_approvals s1 ON s1.scheme_id=sm.scheme_id AND s1.is_current=TRUE
LEFT JOIN stage2_approvals s2 ON s2.scheme_id=sm.scheme_id AND s2.is_current=TRUE
WHERE NOT sm.is_deleted;

CREATE OR REPLACE VIEW v_hub_tiers AS
WITH base AS (
    SELECT scheme_type::text AS tier_key, current_status::text AS status,
        COUNT(*) AS scheme_count,
        COALESCE(SUM(current_cost_cr), 0) AS total_cost_cr,
        COUNT(*) FILTER (WHERE worst_risk_rank>=4) AS red_count,
        COUNT(*) FILTER (WHERE worst_risk_rank=3) AS amber_count,
        COUNT(*) FILTER (WHERE worst_risk_rank<=2) AS green_count
    FROM v_scheme_portfolio GROUP BY scheme_type, current_status)
SELECT tier_key,
    SUM(scheme_count) AS total_count,
    SUM(scheme_count) FILTER (WHERE status NOT IN ('closed','dropped')) AS ongoing_count,
    SUM(scheme_count) FILTER (WHERE status='closed') AS closed_count,
    SUM(scheme_count) FILTER (WHERE status='dropped') AS dropped_count,
    SUM(total_cost_cr) AS total_cost_cr,
    SUM(total_cost_cr) FILTER (WHERE status NOT IN ('closed','dropped')) AS ongoing_cost_cr,
    SUM(red_count) AS red_count, SUM(amber_count) AS amber_count, SUM(green_count) AS green_count
FROM base GROUP BY tier_key;

CREATE OR REPLACE VIEW v_package_health AS
SELECT p.package_id, p.scheme_id, sm.scheme_code, sm.scheme_name,
    p.package_no, p.package_code, p.package_name, p.package_status, p.package_value_cr,
    p.is_scheme_mirror, p.planned_start_date, p.planned_end_date,
    p.start_date_actual, p.completion_date_actual,
    ppm.planned_progress_pct, ppm.actual_progress_pct, ppm.variance_pct,
    ppm.risk_level AS latest_risk, ppm.month_date AS latest_progress_month,
    fs.forecast_completion_date, fs.confidence_pct, fs.explainer AS forecast_explainer,
    p.project_manager_id, p.project_manager_name,
    (SELECT COUNT(*) FROM plan_activities pa JOIN progress_plans pp ON pp.plan_id=pa.plan_id
        WHERE pp.package_id=p.package_id AND pp.is_current=TRUE AND NOT pa.is_deleted) AS active_activity_count,
    (SELECT COUNT(*) FROM field_observations fo
        WHERE fo.package_id=p.package_id AND NOT fo.is_resolved AND NOT fo.is_deleted) AS unresolved_obs_count,
    p.created_at, p.updated_at
FROM packages p
JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
LEFT JOIN LATERAL (
    SELECT * FROM plant_progress_monthly WHERE package_id=p.package_id ORDER BY month_date DESC LIMIT 1
) ppm ON TRUE
LEFT JOIN LATERAL (
    SELECT * FROM forecast_snapshots WHERE package_id=p.package_id AND is_current=TRUE ORDER BY snapshot_date DESC LIMIT 1
) fs ON TRUE
WHERE NOT p.is_deleted AND NOT sm.is_deleted;

CREATE OR REPLACE VIEW v_active_lifecycle AS
SELECT sm.scheme_id, sm.scheme_code, sm.scheme_name, sm.current_status, sm.scheme_type,
    f.formulation_id AS active_formulation_id, f.cost_gross_cr AS formulation_cost_gross_cr,
    f.cost_net_itc_cr AS formulation_cost_net_itc_cr,
    s1.stage1_id AS active_stage1_id, s1.cost_gross_cr AS stage1_cost_gross_cr,
    s1.cost_net_itc_cr AS stage1_cost_net_itc_cr, s1.sanction_date AS stage1_sanction_date,
    s2.stage2_id AS active_stage2_id, s2.firmed_up_cost_gross_cr AS stage2_cost_gross_cr,
    s2.firmed_up_cost_net_itc_cr AS stage2_cost_net_itc_cr, s2.sanction_date AS stage2_sanction_date,
    so.order_id AS active_order_id, so.loa_date, so.effective_date, so.schedule_completion_date,
    so.contract_value_cr, sc.closure_id, sc.commissioning_date, sc.final_cost_cr
FROM scheme_master sm
LEFT JOIN scheme_formulation f ON f.scheme_id=sm.scheme_id AND f.is_current=TRUE
LEFT JOIN stage1_approvals s1 ON s1.scheme_id=sm.scheme_id AND s1.is_current=TRUE
LEFT JOIN stage2_approvals s2 ON s2.scheme_id=sm.scheme_id AND s2.is_current=TRUE
LEFT JOIN scheme_orders so ON so.scheme_id=sm.scheme_id AND so.is_current=TRUE
LEFT JOIN scheme_closure sc ON sc.scheme_id=sm.scheme_id
WHERE NOT sm.is_deleted;

-- THE TIMELINE VIEW — every dated event ever, scheme-by-scheme
CREATE OR REPLACE VIEW v_scheme_timeline AS
SELECT le.event_id, le.scheme_id, sm.scheme_code, sm.scheme_name,
    le.package_id, p.package_name,
    le.stage, le.event_type, le.event_date, le.event_label,
    le.source_revision_id, le.source_table,
    le.cost_cr, le.party_name, le.notes, le.document_id,
    d.title AS document_title, d.document_type,
    le.created_at, le.created_by
FROM lifecycle_events le
JOIN scheme_master sm ON sm.scheme_id=le.scheme_id
LEFT JOIN packages p ON p.package_id=le.package_id
LEFT JOIN documents d ON d.document_id=le.document_id
WHERE NOT le.is_deleted
ORDER BY le.event_date DESC, le.event_id DESC;

CREATE OR REPLACE VIEW v_appendix2_tree AS
SELECT rev.revision_id, rev.scheme_id, rev.package_id, rev.revision_label, rev.is_current,
    cat.item_id AS category_id, cat.category AS category_name, cat.sort_order AS category_sort,
    itm.item_id, itm.s_no, itm.item_name, itm.commencement_months, itm.completion_months,
    itm.schedule_start, itm.schedule_finish, itm.weight_pct, itm.sort_order AS item_sort,
    itm.source AS item_source
FROM appendix2_revisions rev
JOIN appendix2_items cat ON cat.revision_id=rev.revision_id AND cat.is_category=TRUE
LEFT JOIN appendix2_items itm ON itm.parent_item_id=cat.item_id AND itm.is_category=FALSE
WHERE NOT rev.is_deleted;

CREATE OR REPLACE VIEW v_at_risk_packages AS
SELECT p.package_id, p.scheme_id, sm.scheme_code, sm.scheme_name, p.package_name,
    ri.indicator_key, ri.indicator_label, ri.risk_level, ri.risk_score,
    ri.contributing_factors, ri.suggested_action, ri.computed_at, ri.acknowledged_at
FROM risk_indicators ri
JOIN packages p ON p.package_id=ri.package_id
JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
WHERE ri.is_active=TRUE AND ri.risk_level IN ('amber','red') AND NOT p.is_deleted
ORDER BY CASE ri.risk_level WHEN 'red' THEN 1 WHEN 'amber' THEN 2 ELSE 3 END,
    ri.risk_score DESC NULLS LAST;

CREATE OR REPLACE VIEW v_user_inbox AS
SELECT n.notification_id, n.user_id, n.title, n.body, n.severity,
    n.related_scheme_id, sm.scheme_name AS related_scheme_name,
    n.related_package_id, p.package_name AS related_package_name,
    n.related_url, n.is_read, n.created_at
FROM notifications n
LEFT JOIN scheme_master sm ON sm.scheme_id=n.related_scheme_id
LEFT JOIN packages p ON p.package_id=n.related_package_id
WHERE n.channel='in_app';

-- S-CURVE source view (Sprint 5)
CREATE OR REPLACE VIEW v_scurve_data AS
SELECT ppm.package_id, p.package_name, p.scheme_id, sm.scheme_code,
    ppm.month_date, ppm.planned_progress_pct, ppm.actual_progress_pct,
    ppm.cumulative_planned_pct, ppm.cumulative_actual_pct, ppm.variance_pct, ppm.risk_level
FROM plant_progress_monthly ppm
JOIN packages p ON p.package_id=ppm.package_id
JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
WHERE NOT p.is_deleted AND NOT sm.is_deleted
ORDER BY p.package_id, ppm.month_date;

-- COMMITMENT inbox (overdue + due-soon)
CREATE OR REPLACE VIEW v_open_commitments AS
SELECT c.*, sm.scheme_name, sm.scheme_code, p.package_name,
    CASE
        WHEN c.due_date < CURRENT_DATE THEN 'overdue'
        WHEN c.due_date < CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
        WHEN c.due_date < CURRENT_DATE + INTERVAL '30 days' THEN 'upcoming'
        ELSE 'future'
    END AS urgency,
    (c.due_date - CURRENT_DATE) AS days_remaining
FROM commitments c
JOIN scheme_master sm ON sm.scheme_id=c.scheme_id
LEFT JOIN packages p ON p.package_id=c.package_id
WHERE c.status IN ('open','in_progress') AND NOT c.is_deleted
ORDER BY c.due_date ASC;

COMMIT;
