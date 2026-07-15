-- =========================================================================
-- Report Studio — self-service KPI / metric builder
-- Stores saved metric definitions (a curated-dataset query spec + a viz type).
-- The query spec is compiled to safe parameterized SQL server-side against the
-- dataset registry in app/services/report_studio.py — no raw SQL is stored or
-- executed from user input.
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_metrics (
    metric_id    SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    dataset      TEXT NOT NULL,               -- registry dataset key
    spec         JSONB NOT NULL,              -- QueryIn: dimensions, measures, computed, filters, sort, limit
    viz          TEXT NOT NULL DEFAULT 'kpi', -- kpi | table | bar | line | pie
    folder       TEXT,                        -- optional grouping label
    is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by   INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rs_metrics_dataset ON rs_metrics(dataset);
CREATE INDEX IF NOT EXISTS idx_rs_metrics_pinned ON rs_metrics(is_pinned) WHERE is_pinned;
