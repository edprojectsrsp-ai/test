-- =========================================================================
-- 4D BIM — model store + element↔activity links (retro-migration).
-- These tables were first created live on 2026-07-15; this file makes the
-- schema reproducible on a fresh DB restore.
-- =========================================================================

CREATE TABLE IF NOT EXISTS bim_models (
    model_id      SERIAL PRIMARY KEY,
    scheme_id     INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
    package_id    INTEGER REFERENCES packages(package_id),
    model_name    TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    file_format   TEXT NOT NULL CHECK (file_format IN ('ifc','glb','gltf')),
    file_size_mb  DOUBLE PRECISION,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by   INTEGER,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bim_element_links (
    link_id       SERIAL PRIMARY KEY,
    model_id      INTEGER NOT NULL REFERENCES bim_models(model_id) ON DELETE CASCADE,
    element_key   TEXT NOT NULL,
    element_name  TEXT,
    activity_id   INTEGER NOT NULL REFERENCES plan_activities(activity_id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_id, element_key, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_bim_links_model ON bim_element_links(model_id);
CREATE INDEX IF NOT EXISTS idx_bim_links_activity ON bim_element_links(activity_id);
