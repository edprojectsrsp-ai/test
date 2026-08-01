-- =========================================================================
-- Drop the retired standalone scheduling-module tables.
--
-- The "/cpm Advanced" view and its backend (_scheduling_module,
-- /api/scheduling) were consolidated into the primary CPM Studio
-- (/furnace/cpm), which uses the audited api/v1/cpm engine on the
-- cpm_schedules / cpm_activities / cpm_dependencies schema. The scheduling
-- module's own tables were never populated (0 rows) and are no longer served,
-- so this removes them to match the retired code.
--
-- Verified before writing: every table below existed with 0 rows and had no
-- references from live (non-_scheduling_module) backend code. WBS, risk and
-- hindrance concepts are already covered by the keeper (cpm_activities.wbs_*,
-- risk_indicators, and DPR/CMD hindrance capture) so nothing is lost.
--
-- CASCADE handles the FKs between these tables (relationships -> activities,
-- baseline_activities -> baselines, wbs -> projects, etc.). Only the scheduling
-- module's own tables are named; nothing in the cpm_* / app schema is touched.
-- =========================================================================

DROP TABLE IF EXISTS baseline_activities CASCADE;
DROP TABLE IF EXISTS baselines          CASCADE;
DROP TABLE IF EXISTS relationships      CASCADE;
DROP TABLE IF EXISTS update_logs        CASCADE;
DROP TABLE IF EXISTS dcma_runs          CASCADE;
DROP TABLE IF EXISTS wbs                CASCADE;
DROP TABLE IF EXISTS activities         CASCADE;
DROP TABLE IF EXISTS calendars          CASCADE;
DROP TABLE IF EXISTS projects           CASCADE;
