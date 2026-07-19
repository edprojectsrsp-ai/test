-- =========================================================================
-- Matrix Engine M2 — Trust.
--   rs_dq_checks: configurable data-quality rules (spec §11) — a violation
--   is a record matching the check's condition (formula expr over fields).
--   error-severity violations gate snapshot freezing (override = audited).
--   Snapshots now store per-row scheme_ids so comparisons can explain WHICH
--   records entered/left a cell, not just that a number moved.
-- Idempotent.
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_dq_checks (
    check_key   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    dataset_key TEXT NOT NULL DEFAULT 'schemes',
    severity    TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','error')),
    expr        TEXT NOT NULL,        -- formula over record fields; true = VIOLATION
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rs_dq_checks (check_key, name, severity, expr, description) VALUES
('missing_completion', 'Ongoing scheme without any completion date', 'error',
 'current_status = ''ongoing'' and planned_completion = null and revised_completion = null',
 'Timeline classification impossible without a completion date'),
('exp_exceeds_cost', 'Total expenditure exceeds applicable cost', 'error',
 'applicable_cost != null and total_exp > applicable_cost',
 'Cumulative expenditure above sanctioned/estimated cost'),
('completed_no_actual', 'Completed scheme without actual completion date', 'warning',
 'current_status = ''completed'' and actual_completion = null', NULL),
('negative_exp', 'Negative FY expenditure', 'error', 'exp_fy != null and exp_fy < 0', NULL),
('be_missing_ongoing', 'Ongoing scheme with zero BE for selected FY', 'warning',
 'current_status = ''ongoing'' and coalesce(be_fy, 0) = 0', NULL),
('revised_before_original', 'Revised completion earlier than original', 'warning',
 'revised_completion != null and planned_completion != null and revised_completion < planned_completion', NULL)
ON CONFLICT (check_key) DO NOTHING;
