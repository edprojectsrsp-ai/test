-- =========================================================================
-- CACHE — materialised population cache (Cube-inspired pre-aggregation).
--   A run's population (base SQL + derived fields) for a (dataset, report_date)
--   is expensive to recompute every time. Cache the fully-derived rows keyed
--   by dataset + date + a fingerprint of the dataset config, so a config edit
--   auto-invalidates. Row-level security is applied AFTER cache read (never
--   cached per-user), so the cache stays user-agnostic and safe.
-- Idempotent.
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_population_cache (
    id           SERIAL PRIMARY KEY,
    dataset_key  TEXT NOT NULL,
    report_date  DATE NOT NULL,
    fingerprint  TEXT NOT NULL,          -- hash of dataset base_sql+fields+derived
    population   JSONB NOT NULL,         -- fully-derived rows
    row_count    INTEGER NOT NULL,
    built_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    hits         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (dataset_key, report_date, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_popcache_lookup
    ON rs_population_cache(dataset_key, report_date);
