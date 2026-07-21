-- =========================================================================
-- DPR-2 — Teach-the-AI cell mapping.
--   dpr_column_maps  : learned field -> source-column-index maps, per DPR
--                      format (template) with optional per-scheme override.
--   dpr_activity_maps: learned "this DPR row label -> this activity_id",
--                      per scheme, so re-uploads auto-match what you corrected.
-- Precedence at read time: per-scheme row wins over template-global row.
-- Idempotent.
-- =========================================================================

CREATE TABLE IF NOT EXISTS dpr_column_maps (
    id          SERIAL PRIMARY KEY,
    dpr_format  TEXT NOT NULL,            -- parsed format id (rsp_dpr/weekly/site_progress/…)
    scheme_id   INTEGER,                  -- NULL = template-global default
    field       TEXT NOT NULL,            -- target field: dayActual, cumActualToDate, scope, uom, …
    col_index   INTEGER NOT NULL,         -- 0-based source column the value should be read from
    updated_by  VARCHAR(100),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dpr_format, scheme_id, field)
);
CREATE INDEX IF NOT EXISTS idx_dpr_colmap ON dpr_column_maps(dpr_format, scheme_id);

CREATE TABLE IF NOT EXISTS dpr_activity_maps (
    id           SERIAL PRIMARY KEY,
    scheme_id    INTEGER NOT NULL,
    row_label    TEXT NOT NULL,           -- normalised DPR row label (workType/activity)
    activity_id  INTEGER NOT NULL,
    updated_by   VARCHAR(100),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scheme_id, row_label)
);
CREATE INDEX IF NOT EXISTS idx_dpr_actmap ON dpr_activity_maps(scheme_id);
