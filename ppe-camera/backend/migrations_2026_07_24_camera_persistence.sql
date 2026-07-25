-- =========================================================================
-- Camera config persistence.
--
-- CameraRecord already claimed "the CameraManager rehydrates these at startup
-- so cameras no longer vanish on restart", and upsert_camera/all_cameras were
-- both written — but neither was ever called. Every camera, every zone mask
-- and every tuned threshold was lost on restart.
--
-- These columns store what was previously only in memory. SQLite has no
-- ADD COLUMN IF NOT EXISTS, so re-running this will error harmlessly on the
-- second pass; on Postgres it is idempotent.
-- =========================================================================

ALTER TABLE cameras ADD COLUMN monitoring_zones JSON DEFAULT '[]';
ALTER TABLE cameras ADD COLUMN detection_rule   JSON DEFAULT '{}';
ALTER TABLE cameras ADD COLUMN priority         VARCHAR(16) DEFAULT 'normal';

-- monitoring_zones are PPE masks and regions of interest. Distinct from the
-- existing `zones` column, which holds hazard restricted areas — a different
-- question ("nobody should be here at all" vs "judge PPE here, and against
-- what gear").
--
-- detection_rule holds per-camera tuning. min_person_px matters most: 64 suits
-- 1080p, but a gantry camera looking down a 200 m yard gates out most workers
-- at that value, so it cannot be a global setting.
