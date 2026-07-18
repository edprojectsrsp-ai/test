-- =========================================================================
-- Report Studio — Dashboard Canvas (Power BI-style report pages)
-- A dashboard is a set of pages; each page holds slicers (page-level filter
-- visuals) and visuals (each a QueryIn spec + viz type + grid layout).
-- Specs are compiled server-side by app/services/report_studio.py — no raw
-- SQL is ever stored or executed from user input.
--
-- pages JSONB shape:
-- [
--   { "id": "pg1", "title": "Overview",
--     "slicers": [ { "id": "...", "dataset": "...", "field": "...",
--                    "label": "...", "type": "list" | "daterange" } ],
--     "visuals": [ { "id": "...", "title": "...", "dataset": "...",
--                    "viz": "bar", "spec": { ...QueryIn... },
--                    "layout": { "x": 0, "y": 0, "w": 6, "h": 5 },
--                    "options": { "stacked": false, "legend": true, ... } } ] }
-- ]
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_dashboards (
    dashboard_id SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    pages        JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by   INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rs_dashboards_pinned
    ON rs_dashboards(is_pinned) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_rs_dashboards_updated
    ON rs_dashboards(updated_at DESC);
