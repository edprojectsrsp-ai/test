-- =========================================================================
-- Matrix Engine — metadata-driven report platform (Report Studio spec).
--   rs_rules            reusable, versioned business rules (JSON trees)
--   rs_matrix_reports   report definitions (hierarchy + measure columns)
--   rs_matrix_snapshots frozen approved runs (grid + definition + rules)
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_rules (
    rule_id      SERIAL PRIMARY KEY,
    rule_key     TEXT NOT NULL UNIQUE,
    rule_name    TEXT NOT NULL,
    description  TEXT,
    condition    JSONB NOT NULL,           -- {op, conditions:[{field,op,value}|{rule}|group]}
    version      INTEGER NOT NULL DEFAULT 1,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by   VARCHAR(100),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_rule_versions (
    id         SERIAL PRIMARY KEY,
    rule_key   TEXT NOT NULL,
    version    INTEGER NOT NULL,
    condition  JSONB NOT NULL,
    saved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_matrix_reports (
    report_id   SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    definition  JSONB NOT NULL,            -- {columns:[...], rows:[tree]}
    updated_by  VARCHAR(100),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_matrix_snapshots (
    snapshot_id  SERIAL PRIMARY KEY,
    report_id    INTEGER REFERENCES rs_matrix_reports(report_id) ON DELETE CASCADE,
    report_date  DATE NOT NULL,
    fy           TEXT,
    status       TEXT NOT NULL DEFAULT 'approved',   -- draft|submitted|approved|locked
    result       JSONB NOT NULL,           -- full run output (grid + reconciliation)
    definition   JSONB NOT NULL,           -- definition as-of freeze
    rules_used   JSONB NOT NULL,           -- verbatim rule conditions + versions
    frozen_by    VARCHAR(100),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matrix_snap_report ON rs_matrix_snapshots(report_id, report_date DESC);
