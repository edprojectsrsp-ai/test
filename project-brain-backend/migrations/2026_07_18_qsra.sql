-- =========================================================================
-- QSRA — Quantitative Schedule Risk Analysis (Monte Carlo).
-- 3-point duration estimates per CPM activity; activities without a row use
-- default optimistic/pessimistic % spreads around deterministic duration.
-- Run summaries are stored for trend-over-time ("is P80 improving?").
-- =========================================================================

CREATE TABLE IF NOT EXISTS cpm_risk_estimates (
    activity_id      INTEGER PRIMARY KEY REFERENCES cpm_activities(activity_id) ON DELETE CASCADE,
    optimistic_days  NUMERIC(10,2),
    most_likely_days NUMERIC(10,2),
    pessimistic_days NUMERIC(10,2),
    note             TEXT,
    updated_by       VARCHAR(100),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qsra_runs (
    run_id                 SERIAL PRIMARY KEY,
    schedule_id            INTEGER NOT NULL,
    iterations             INTEGER NOT NULL,
    seed                   BIGINT,
    deterministic_finish   DATE,
    p50_finish             DATE,
    p80_finish             DATE,
    p90_finish             DATE,
    prob_meet_det_pct      NUMERIC(6,2),
    std_dev_days           NUMERIC(10,1),
    run_by                 VARCHAR(100),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qsra_runs_schedule ON qsra_runs(schedule_id, created_at DESC);
