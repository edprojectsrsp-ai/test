-- ===========================================================================
-- Sprint 15.5 (Half A) — CAPEX BE / RE / Actuals separation
-- ===========================================================================
--
-- Goal: Stop mixing BE, RE and Actuals on one row of capex_month_values.
--
-- New model:
--   * capex_plan_header.plan_type already exists ('BE' or 'RE'). One plan
--     per (fy_year, plan_type, plan_version). RE plans gain an
--     effective_from_month column so the UI can show "RE locked before X".
--   * capex_actuals (NEW) — independent table holding the actual spent
--     amount per (plan_row_id, month_no). Actuals are NOT versioned with
--     plans; they're physical reality and live as long as the row does.
--   * actuals_month_lock (NEW) — admin-managed lock per (fy_year, month_no).
--     A locked month rejects further actual edits unless the admin unlocks.
--   * Backfill from capex_month_values.actual_amount → capex_actuals where
--     the column was non-zero, so existing data isn't lost.
--
-- Idempotent: re-runnable. All CREATE statements use IF NOT EXISTS or
-- ADD COLUMN IF NOT EXISTS.
-- ===========================================================================

-- 1. Header gets an effective_from_month column for RE plans.
ALTER TABLE capex_plan_header
    ADD COLUMN IF NOT EXISTS effective_from_month INTEGER;

-- 2. Independent actuals table.
CREATE TABLE IF NOT EXISTS capex_actuals (
    id               SERIAL PRIMARY KEY,
    plan_row_id      INTEGER NOT NULL REFERENCES capex_plan_rows(id) ON DELETE CASCADE,
    month_no         INTEGER NOT NULL CHECK (month_no BETWEEN 1 AND 12),
    fy_year          VARCHAR(20) NOT NULL,             -- denormalized for fast filter
    amount           NUMERIC(15, 4) NOT NULL DEFAULT 0,
    created_by       VARCHAR(100),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by       VARCHAR(100),
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT capex_actuals_unique UNIQUE (plan_row_id, month_no)
);

CREATE INDEX IF NOT EXISTS idx_capex_actuals_row    ON capex_actuals (plan_row_id);
CREATE INDEX IF NOT EXISTS idx_capex_actuals_fy_mo  ON capex_actuals (fy_year, month_no);

-- 3. Admin-managed month locks.
CREATE TABLE IF NOT EXISTS actuals_month_lock (
    id            SERIAL PRIMARY KEY,
    fy_year       VARCHAR(20) NOT NULL,
    month_no      INTEGER NOT NULL CHECK (month_no BETWEEN 1 AND 12),
    locked_by     VARCHAR(100),
    locked_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    note          TEXT,
    CONSTRAINT actuals_month_lock_unique UNIQUE (fy_year, month_no)
);

-- 4. Back-fill: copy non-zero actuals from capex_month_values into capex_actuals.
-- Best effort — if duplicates exist they're skipped via ON CONFLICT.
INSERT INTO capex_actuals (plan_row_id, month_no, fy_year, amount, created_by)
SELECT
    cmv.plan_row_id,
    cmv.month_no,
    cph.fy_year,
    cmv.actual_amount,
    'backfill_sprint155'
FROM capex_month_values cmv
JOIN capex_plan_rows cpr ON cpr.id = cmv.plan_row_id
JOIN capex_plan_header cph ON cph.id = cpr.plan_id
WHERE COALESCE(cmv.actual_amount, 0) <> 0
ON CONFLICT (plan_row_id, month_no) DO NOTHING;

-- ===========================================================================
-- Sanity probe
-- ===========================================================================
DO $$
DECLARE
    actuals_count INTEGER;
    locks_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO actuals_count FROM capex_actuals;
    SELECT COUNT(*) INTO locks_count FROM actuals_month_lock;
    RAISE NOTICE 'Sprint 15.5 migration done. capex_actuals=%, actuals_month_lock=%',
                 actuals_count, locks_count;
END $$;
