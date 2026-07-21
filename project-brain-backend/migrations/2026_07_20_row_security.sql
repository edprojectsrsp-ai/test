-- =========================================================================
-- M5-RLS — row-level security for the Matrix Engine (spec §12).
--   rs_row_scopes: per-role (and/or per-user) allow-lists over scoping
--   dimensions. A scope row grants visibility to schemes matching a
--   dimension value (scheme_type, department, plant, or explicit scheme_id).
--   Absence of ANY scope row for a principal = unrestricted (back-compat);
--   presence of scope rows = restricted to their union. admin bypasses.
-- Idempotent.
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_row_scopes (
    id          SERIAL PRIMARY KEY,
    role        TEXT,                     -- match by role (NULL if user-specific)
    user_id     INTEGER,                  -- match by user (NULL if role-wide)
    dimension   TEXT NOT NULL,            -- scheme_type | department | plant | scheme_id
    value       TEXT NOT NULL,            -- allowed value (or scheme_id as text)
    created_by  VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (role IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_rowscope_role ON rs_row_scopes(role);
CREATE INDEX IF NOT EXISTS idx_rowscope_user ON rs_row_scopes(user_id);
