-- =========================================================================
-- Sprint 14a — DPR Multi-Entry
-- Adds two tables:
--   * dpr_entries_v2  — one row per site visit (many per day per scheme)
--   * dpr_photos      — photos attached to a v2 entry (1-to-many)
-- The old `dpr_entries` table is left untouched and continues to work for
-- the legacy /dpr endpoint, which the UI still exposes via a toggle.
-- =========================================================================

CREATE TABLE IF NOT EXISTS dpr_entries_v2 (
    id              SERIAL PRIMARY KEY,
    scheme_id       INTEGER NOT NULL REFERENCES schemes(id),
    report_date     DATE NOT NULL,
    area_name       VARCHAR(200),                -- e.g. "Substation Bay 3"
    gps_lat         DOUBLE PRECISION NOT NULL,    -- required per Sprint 14a
    gps_lng         DOUBLE PRECISION NOT NULL,
    gps_accuracy_m  DOUBLE PRECISION,             -- accuracy in meters, optional
    work_done       TEXT,
    issues          TEXT,
    weather         VARCHAR(40) DEFAULT 'Clear',
    manpower        INTEGER DEFAULT 0,
    created_by      VARCHAR(100),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for the two queries the UI does:
--   - list last 30 days for a scheme  → (scheme_id, report_date DESC)
--   - distinct area names for autocomplete  → (scheme_id, area_name)
CREATE INDEX IF NOT EXISTS idx_dpr_v2_scheme_date
    ON dpr_entries_v2 (scheme_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_dpr_v2_scheme_area
    ON dpr_entries_v2 (scheme_id, area_name);

CREATE TABLE IF NOT EXISTS dpr_photos (
    id              SERIAL PRIMARY KEY,
    dpr_entry_id    INTEGER NOT NULL REFERENCES dpr_entries_v2(id) ON DELETE CASCADE,
    file_path       VARCHAR(500) NOT NULL,        -- relative to UPLOAD_DIR
    captured_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dpr_photos_entry
    ON dpr_photos (dpr_entry_id);
