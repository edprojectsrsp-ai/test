-- =========================================================================
-- CPM work calendars — working-day / holiday awareness for the schedule engine.
--
-- Durations in cpm_activities are expressed in *working days*. These columns
-- let a schedule declare which weekdays are working days and which specific
-- dates are holidays, so the CPM engine skips non-working days when computing
-- Early/Late dates and float (Primavera P6 / Synchro behaviour).
--
--   working_weekdays : Python weekday() ints that are working days
--                      (Mon=0 .. Sun=6). NULL => 7-day (all days work), which
--                      preserves the engine's original behaviour.
--   holidays         : specific non-working dates regardless of weekday.
--
-- Example (Indian 6-day construction week, Sunday off, with two holidays):
--   UPDATE cpm_schedules
--      SET working_weekdays = ARRAY[0,1,2,3,4,5],
--          holidays = ARRAY['2026-01-26','2026-08-15']::date[]
--    WHERE schedule_id = 42;
-- =========================================================================

ALTER TABLE cpm_schedules
    ADD COLUMN IF NOT EXISTS working_weekdays INTEGER[],
    ADD COLUMN IF NOT EXISTS holidays         DATE[];

COMMENT ON COLUMN cpm_schedules.working_weekdays IS
    'Working weekdays as Python weekday() ints (Mon=0..Sun=6); NULL = 7-day calendar (all days work).';
COMMENT ON COLUMN cpm_schedules.holidays IS
    'Specific non-working dates (holidays), skipped by the CPM engine regardless of weekday.';
