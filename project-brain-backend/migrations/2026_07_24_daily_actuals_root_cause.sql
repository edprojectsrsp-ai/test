-- =========================================================================
-- Root cause on activity-level actuals.
--
-- The earlier migration (2026_07_24_dpr_evidence_rootcause.sql) put these
-- columns on dpr_entries_v2, which is fed by the site-visit screen. The Data
-- Entry tab — where an engineer records the day's quantities and is asked why
-- a figure fell short — writes to daily_actuals instead. Without these
-- columns the cause is accepted by the API and silently dropped, which is the
-- worst kind of failure: the form looks like it saved.
--
-- Both tables carry the field, because both capture a shortfall.
-- =========================================================================

ALTER TABLE daily_actuals ADD COLUMN IF NOT EXISTS root_cause      VARCHAR(32);
ALTER TABLE daily_actuals ADD COLUMN IF NOT EXISTS root_cause_note TEXT;
ALTER TABLE daily_actuals ADD COLUMN IF NOT EXISTS days_lost       NUMERIC(6,2);

CREATE INDEX IF NOT EXISTS idx_daily_actuals_root_cause
    ON daily_actuals (root_cause);

-- Nullable and not back-filled: rows recorded before the field existed have no
-- cause, and inventing one would fabricate history. The summary endpoint
-- reports them as "unclassified" so the gap stays visible in the totals.
