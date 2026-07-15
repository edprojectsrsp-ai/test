-- Furnace upgrade - ADDITIVE migration. Safe to run on existing DB.
-- 1) DPR month freeze flag (for the analyse->apply->freeze baseline workflow).
ALTER TABLE daily_actuals ADD COLUMN IF NOT EXISTS entered_via VARCHAR(10);            -- 'app' | 'web' | 'dpr'
CREATE TABLE IF NOT EXISTS dpr_month_freeze (
    freeze_id      SERIAL PRIMARY KEY,
    package_id     INTEGER NOT NULL,
    month_date     DATE    NOT NULL,           -- first-of-month
    frozen_at      TIMESTAMP DEFAULT now(),
    frozen_by      VARCHAR(80),
    UNIQUE (package_id, month_date)
);
-- 2) Optional: stage-change audit note on scheme (only if you want change-stage remarks persisted)
ALTER TABLE scheme_master ADD COLUMN IF NOT EXISTS last_status_remark TEXT;
-- (No columns dropped or altered destructively. CAPEX balance is computed at read-time - no schema change.)
