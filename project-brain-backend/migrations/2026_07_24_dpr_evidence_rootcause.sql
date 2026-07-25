-- =========================================================================
-- DPR evidence integrity + root-cause taxonomy.
--
-- Two gaps this closes:
--
--  1. dpr_entries_v2 captures GPS live from the browser and dpr_photos stores
--     an image, but nothing ties the two together. A gallery photo taken three
--     weeks ago at another site attaches to a live-GPS entry and is
--     indistinguishable from one taken on the spot. Since the photo is the
--     evidence behind a billing claim, it needs to carry its own provenance.
--
--  2. There is no root-cause field anywhere in the schema, so "why did we
--     slip" lives in free text if it is recorded at all and cannot be
--     aggregated. Three engineers write "rain", "heavy rains" and "weather"
--     and no grouping recovers the number.
--
-- Idempotent.
-- =========================================================================

-- ---- 1. photo provenance ------------------------------------------------
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS exif_lat          DOUBLE PRECISION;
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS exif_lng          DOUBLE PRECISION;
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS exif_taken_at     TIMESTAMP;
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS camera_model      VARCHAR(120);
-- verified | unverified | suspect | conflicted
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS verification      VARCHAR(16) DEFAULT 'unverified';
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS distance_m        DOUBLE PRECISION;
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS time_delta_s      INTEGER;
-- why it was classified that way, so a disputed claim can be argued from record
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS verification_note TEXT;
ALTER TABLE dpr_photos ADD COLUMN IF NOT EXISTS sha256            VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_dpr_photos_verification
    ON dpr_photos (verification);
-- Identical file uploaded against two entries is the clearest evidence of
-- recycling, and only findable if the hash is indexed.
CREATE INDEX IF NOT EXISTS idx_dpr_photos_sha
    ON dpr_photos (sha256);

-- ---- 2. root cause on deviations ----------------------------------------
ALTER TABLE dpr_entries_v2 ADD COLUMN IF NOT EXISTS root_cause      VARCHAR(32);
ALTER TABLE dpr_entries_v2 ADD COLUMN IF NOT EXISTS root_cause_note TEXT;
ALTER TABLE dpr_entries_v2 ADD COLUMN IF NOT EXISTS days_lost       NUMERIC(6,2) DEFAULT 0;
-- Who the site believes is answerable. Defaulted from the taxonomy but
-- overridable, because attribution is a judgement and not a lookup.
ALTER TABLE dpr_entries_v2 ADD COLUMN IF NOT EXISTS responsibility  VARCHAR(16);
-- Which sub-agency actually did the work, so a claim can be attributed.
ALTER TABLE dpr_entries_v2 ADD COLUMN IF NOT EXISTS subcontractor   VARCHAR(160);

CREATE INDEX IF NOT EXISTS idx_dpr_v2_root_cause
    ON dpr_entries_v2 (scheme_id, root_cause);
CREATE INDEX IF NOT EXISTS idx_dpr_v2_subcontractor
    ON dpr_entries_v2 (scheme_id, subcontractor);

-- root_cause is intentionally nullable and NOT back-filled. Existing rows have
-- no recorded cause and inventing one would fabricate history; the summary
-- endpoint reports them as "unclassified" instead, so the gap stays visible.
