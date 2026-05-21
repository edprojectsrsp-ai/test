-- ============================================================================
-- SPRINT 9B — CPM Schedule Engine
-- ============================================================================
-- Full project schedule with multiple date dimensions, dependencies, baselines,
-- and CPM calculations (early/late start/finish, total/free float, critical path).
--
-- DATE DIMENSIONS PER ACTIVITY:
--   - planned_*       : original planner intent
--   - baseline_*      : frozen snapshot (when DPR/contract signed)
--   - estimated_*     : current estimate (most recent re-projection)
--   - actual_*        : what really happened
--   - early_start/finish : CPM forward pass
--   - late_start/finish  : CPM backward pass
--   - forecast_*      : AI-projected based on current actuals
--
-- This 7-dimension date model is what friend's app cannot match. ANY field can
-- be queried, filtered, charted independently.
-- ============================================================================

-- ENUMS
DO $$ BEGIN
    CREATE TYPE schedule_status_enum AS ENUM (
        'draft', 'active', 'baselined', 'revised', 'closed', 'archived'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE schedule_source_enum AS ENUM (
        'manual', 'csv_import', 'xer_import', 'mpp_import', 'json_import', 'api'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cpm_activity_status_enum AS ENUM (
        'not_started', 'in_progress', 'completed', 'on_hold', 'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cpm_activity_type_enum AS ENUM (
        'task',           -- normal activity
        'milestone',      -- zero-duration marker (start_milestone, finish_milestone)
        'summary',        -- grouping/wbs node
        'hammock',        -- spans across other activities
        'level_of_effort' -- continuous effort like project management
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cpm_dependency_type_enum AS ENUM (
        'FS',  -- Finish to Start (most common, default)
        'SS',  -- Start to Start
        'FF',  -- Finish to Finish
        'SF'   -- Start to Finish (rare)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cpm_constraint_type_enum AS ENUM (
        'none',
        'start_no_earlier_than', 'start_no_later_than',
        'finish_no_earlier_than', 'finish_no_later_than',
        'must_start_on', 'must_finish_on',
        'as_late_as_possible'  -- ALAP (default is ASAP)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- SCHEDULES — one per package (multiple versions = revisions over time)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cpm_schedules (
    schedule_id         SERIAL PRIMARY KEY,
    package_id          INTEGER NOT NULL REFERENCES packages(package_id),
    schedule_name       VARCHAR(200) NOT NULL,
    schedule_version    VARCHAR(50) DEFAULT 'v1',
    description         TEXT,
    status              schedule_status_enum NOT NULL DEFAULT 'draft',
    source              schedule_source_enum DEFAULT 'manual',

    -- DATES (project-level)
    project_start_date  DATE,
    data_date           DATE,                    -- current "as of" date for CPM
    project_finish_date DATE,                    -- planned overall finish

    -- BASELINE (frozen snapshot when project starts)
    baseline_set_at     TIMESTAMP,
    baseline_set_by     INTEGER REFERENCES users(user_id),
    is_current_baseline BOOLEAN DEFAULT FALSE,

    -- METRICS (cached - recomputed on update)
    total_activities    INTEGER DEFAULT 0,
    completed_activities INTEGER DEFAULT 0,
    critical_path_length_days INTEGER,
    schedule_pct_complete NUMERIC(5,2),
    schedule_health_score NUMERIC(5,2),  -- 0-100, computed metric

    -- IMPORT META
    source_file_name    VARCHAR(255),
    source_file_path    VARCHAR(500),
    imported_at         TIMESTAMP,
    import_warnings     JSONB,             -- list of warnings during import

    -- META
    created_by          INTEGER REFERENCES users(user_id),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted          BOOLEAN DEFAULT FALSE,
    last_cpm_run_at     TIMESTAMP,
    last_cpm_run_status VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_cpm_sched_package ON cpm_schedules(package_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_cpm_sched_active ON cpm_schedules(status) WHERE NOT is_deleted;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_baseline_per_pkg ON cpm_schedules(package_id)
    WHERE is_current_baseline = TRUE AND NOT is_deleted;


-- ============================================================================
-- ACTIVITIES — the heart of CPM (with 7 date dimensions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cpm_activities (
    activity_id         SERIAL PRIMARY KEY,
    schedule_id         INTEGER NOT NULL REFERENCES cpm_schedules(schedule_id) ON DELETE CASCADE,
    activity_code       VARCHAR(50),       -- A1010, A1020 (Primavera-style)
    activity_name       VARCHAR(500) NOT NULL,
    activity_type       cpm_activity_type_enum NOT NULL DEFAULT 'task',
    wbs_code            VARCHAR(100),      -- 1.2.3 hierarchy
    wbs_level           INTEGER DEFAULT 0,
    parent_activity_id  INTEGER REFERENCES cpm_activities(activity_id),
    sort_order          INTEGER DEFAULT 0,

    -- DURATIONS (in days)
    planned_duration_days   NUMERIC(8,2),
    baseline_duration_days  NUMERIC(8,2),
    estimated_duration_days NUMERIC(8,2),    -- current re-estimate
    remaining_duration_days NUMERIC(8,2),
    actual_duration_days    NUMERIC(8,2),

    -- DATE DIMENSION 1: PLANNED (original planner intent)
    planned_start_date      DATE,
    planned_finish_date     DATE,

    -- DATE DIMENSION 2: BASELINE (frozen snapshot)
    baseline_start_date     DATE,
    baseline_finish_date    DATE,

    -- DATE DIMENSION 3: ESTIMATED (current re-projection)
    estimated_start_date    DATE,
    estimated_finish_date   DATE,

    -- DATE DIMENSION 4: ACTUAL (what really happened)
    actual_start_date       DATE,
    actual_finish_date      DATE,

    -- DATE DIMENSION 5: EARLY (CPM forward pass)
    early_start_date        DATE,
    early_finish_date       DATE,

    -- DATE DIMENSION 6: LATE (CPM backward pass)
    late_start_date         DATE,
    late_finish_date        DATE,

    -- DATE DIMENSION 7: FORECAST (AI projection from actuals)
    forecast_start_date     DATE,
    forecast_finish_date    DATE,

    -- CPM CALCULATED FIELDS
    total_float_days        NUMERIC(8,2),   -- LF - EF (or LS - ES)
    free_float_days         NUMERIC(8,2),
    is_critical             BOOLEAN DEFAULT FALSE,
    is_near_critical        BOOLEAN DEFAULT FALSE,  -- total_float < 5 days

    -- PROGRESS
    physical_pct_complete   NUMERIC(5,2) DEFAULT 0,
    duration_pct_complete   NUMERIC(5,2) DEFAULT 0,
    activity_status         cpm_activity_status_enum NOT NULL DEFAULT 'not_started',

    -- CONSTRAINTS
    constraint_type         cpm_constraint_type_enum DEFAULT 'none',
    constraint_date         DATE,

    -- RESOURCES (lightweight - can be expanded later)
    primary_resource_name   VARCHAR(200),
    resource_count          INTEGER,
    cost_estimate_cr        NUMERIC(14,4),
    cost_actual_cr          NUMERIC(14,4),

    -- META
    notes                   TEXT,
    is_deleted              BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schedule_id, activity_code)
);

CREATE INDEX IF NOT EXISTS idx_cpm_act_sched ON cpm_activities(schedule_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_cpm_act_critical ON cpm_activities(is_critical) WHERE is_critical AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_cpm_act_status ON cpm_activities(activity_status);
CREATE INDEX IF NOT EXISTS idx_cpm_act_parent ON cpm_activities(parent_activity_id);
CREATE INDEX IF NOT EXISTS idx_cpm_act_planned_dates ON cpm_activities(planned_start_date, planned_finish_date);
CREATE INDEX IF NOT EXISTS idx_cpm_act_actual_dates ON cpm_activities(actual_start_date, actual_finish_date);


-- ============================================================================
-- DEPENDENCIES — predecessor/successor relationships
-- ============================================================================
CREATE TABLE IF NOT EXISTS cpm_dependencies (
    dependency_id       SERIAL PRIMARY KEY,
    predecessor_id      INTEGER NOT NULL REFERENCES cpm_activities(activity_id) ON DELETE CASCADE,
    successor_id        INTEGER NOT NULL REFERENCES cpm_activities(activity_id) ON DELETE CASCADE,
    dependency_type     cpm_dependency_type_enum NOT NULL DEFAULT 'FS',
    lag_days            NUMERIC(8,2) DEFAULT 0,  -- can be negative for lead
    is_driving          BOOLEAN DEFAULT FALSE,    -- determines successor's early start
    notes               TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(predecessor_id, successor_id),
    CHECK (predecessor_id <> successor_id)
);

CREATE INDEX IF NOT EXISTS idx_cpm_dep_pred ON cpm_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_cpm_dep_succ ON cpm_dependencies(successor_id);


-- ============================================================================
-- DELAY ANALYSIS — variance snapshots
-- ============================================================================
CREATE TABLE IF NOT EXISTS cpm_delay_analysis (
    analysis_id             SERIAL PRIMARY KEY,
    schedule_id             INTEGER NOT NULL REFERENCES cpm_schedules(schedule_id),
    activity_id             INTEGER REFERENCES cpm_activities(activity_id),
    analysis_date           DATE NOT NULL DEFAULT CURRENT_DATE,

    -- DELAYS (in days)
    delay_vs_baseline_days  NUMERIC(8,2),   -- actual_finish - baseline_finish
    delay_vs_planned_days   NUMERIC(8,2),
    forecast_slip_days      NUMERIC(8,2),

    -- ATTRIBUTION
    delay_cause             VARCHAR(200),   -- weather/material/manpower/design/external
    delay_attributable_to   VARCHAR(50),    -- owner/contractor/external/force_majeure/joint
    cost_impact_cr          NUMERIC(14,4),

    -- IMPACT
    affects_critical_path   BOOLEAN DEFAULT FALSE,
    pushes_project_finish_days NUMERIC(8,2),   -- how many days end date moves

    remarks                 TEXT,
    analyzed_by             INTEGER REFERENCES users(user_id),
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delay_sched ON cpm_delay_analysis(schedule_id);
CREATE INDEX IF NOT EXISTS idx_delay_activity ON cpm_delay_analysis(activity_id);


-- ============================================================================
-- BASELINE SNAPSHOTS — frozen schedules for variance comparison
-- ============================================================================
CREATE TABLE IF NOT EXISTS cpm_baseline_snapshots (
    snapshot_id         SERIAL PRIMARY KEY,
    schedule_id         INTEGER NOT NULL REFERENCES cpm_schedules(schedule_id),
    snapshot_name       VARCHAR(200) NOT NULL,
    snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    activities_snapshot JSONB NOT NULL,  -- full snapshot of all activity dates
    is_active           BOOLEAN DEFAULT TRUE,
    created_by          INTEGER REFERENCES users(user_id),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_snap_sched ON cpm_baseline_snapshots(schedule_id) WHERE is_active;


-- ============================================================================
-- VIEWS
-- ============================================================================

-- The critical path
CREATE OR REPLACE VIEW v_cpm_critical_path AS
SELECT
    a.activity_id, a.schedule_id, a.activity_code, a.activity_name,
    a.early_start_date, a.early_finish_date,
    a.late_start_date, a.late_finish_date,
    a.total_float_days, a.planned_duration_days,
    a.physical_pct_complete, a.activity_status::text AS activity_status
FROM cpm_activities a
WHERE a.is_critical = TRUE AND NOT a.is_deleted
ORDER BY a.schedule_id, a.early_start_date;


-- Schedule summary
CREATE OR REPLACE VIEW v_cpm_schedule_summary AS
SELECT
    s.schedule_id, s.package_id, p.package_name,
    sm.scheme_id, sm.scheme_name, sm.scheme_code,
    s.schedule_name, s.schedule_version, s.status::text AS status,
    s.project_start_date, s.project_finish_date, s.data_date,
    COUNT(a.activity_id) FILTER (WHERE NOT a.is_deleted) AS total_activities,
    COUNT(a.activity_id) FILTER (WHERE a.is_critical AND NOT a.is_deleted) AS critical_activities,
    COUNT(a.activity_id) FILTER (WHERE a.activity_status='completed' AND NOT a.is_deleted) AS completed,
    COUNT(a.activity_id) FILTER (WHERE a.activity_status='in_progress' AND NOT a.is_deleted) AS in_progress,
    COUNT(a.activity_id) FILTER (WHERE a.activity_status='not_started' AND NOT a.is_deleted) AS not_started,
    ROUND(AVG(a.physical_pct_complete) FILTER (WHERE NOT a.is_deleted)::numeric, 2) AS avg_pct_complete,
    s.is_current_baseline,
    s.last_cpm_run_at
FROM cpm_schedules s
LEFT JOIN cpm_activities a ON a.schedule_id = s.schedule_id
LEFT JOIN packages p ON p.package_id = s.package_id
LEFT JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
WHERE NOT s.is_deleted
GROUP BY s.schedule_id, p.package_name, sm.scheme_id, sm.scheme_name, sm.scheme_code;


-- Activities with delay info
CREATE OR REPLACE VIEW v_cpm_activities_with_delays AS
SELECT
    a.activity_id, a.schedule_id, a.activity_code, a.activity_name,
    a.activity_type::text AS activity_type,
    a.wbs_code, a.wbs_level,
    -- Dates
    a.planned_start_date, a.planned_finish_date,
    a.baseline_start_date, a.baseline_finish_date,
    a.estimated_start_date, a.estimated_finish_date,
    a.actual_start_date, a.actual_finish_date,
    a.early_start_date, a.early_finish_date,
    a.late_start_date, a.late_finish_date,
    a.forecast_start_date, a.forecast_finish_date,
    -- Durations
    a.planned_duration_days, a.baseline_duration_days,
    a.estimated_duration_days, a.actual_duration_days,
    -- CPM
    a.total_float_days, a.free_float_days, a.is_critical, a.is_near_critical,
    -- Progress
    a.physical_pct_complete, a.activity_status::text AS activity_status,
    -- Delays (computed)
    CASE WHEN a.actual_finish_date IS NOT NULL AND a.baseline_finish_date IS NOT NULL
         THEN a.actual_finish_date - a.baseline_finish_date END AS delay_vs_baseline_days,
    CASE WHEN a.actual_start_date IS NOT NULL AND a.baseline_start_date IS NOT NULL
         THEN a.actual_start_date - a.baseline_start_date END AS start_delay_vs_baseline_days,
    CASE WHEN a.forecast_finish_date IS NOT NULL AND a.baseline_finish_date IS NOT NULL
         THEN a.forecast_finish_date - a.baseline_finish_date END AS forecast_slip_days
FROM cpm_activities a
WHERE NOT a.is_deleted;


-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_cpm_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cpm_sched_touch ON cpm_schedules;
CREATE TRIGGER trg_cpm_sched_touch BEFORE UPDATE ON cpm_schedules
    FOR EACH ROW EXECUTE FUNCTION fn_cpm_touch_updated_at();

DROP TRIGGER IF EXISTS trg_cpm_act_touch ON cpm_activities;
CREATE TRIGGER trg_cpm_act_touch BEFORE UPDATE ON cpm_activities
    FOR EACH ROW EXECUTE FUNCTION fn_cpm_touch_updated_at();


-- Auto-update schedule stats when activities change
CREATE OR REPLACE FUNCTION fn_cpm_update_sched_stats()
RETURNS TRIGGER AS $$
DECLARE
    sid INTEGER;
BEGIN
    sid := COALESCE(NEW.schedule_id, OLD.schedule_id);
    UPDATE cpm_schedules SET
        total_activities = (SELECT COUNT(*) FROM cpm_activities WHERE schedule_id=sid AND NOT is_deleted),
        completed_activities = (SELECT COUNT(*) FROM cpm_activities
                               WHERE schedule_id=sid AND activity_status='completed' AND NOT is_deleted),
        schedule_pct_complete = (SELECT ROUND(AVG(physical_pct_complete)::numeric, 2) FROM cpm_activities
                                 WHERE schedule_id=sid AND NOT is_deleted),
        updated_at = CURRENT_TIMESTAMP
    WHERE schedule_id = sid;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cpm_sched_stats ON cpm_activities;
CREATE TRIGGER trg_cpm_sched_stats
    AFTER INSERT OR UPDATE OR DELETE ON cpm_activities
    FOR EACH ROW EXECUTE FUNCTION fn_cpm_update_sched_stats();


-- Auto-set actual_finish when status → completed
CREATE OR REPLACE FUNCTION fn_cpm_auto_complete()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.activity_status = 'completed' AND OLD.activity_status <> 'completed' THEN
        NEW.actual_finish_date := COALESCE(NEW.actual_finish_date, CURRENT_DATE);
        NEW.physical_pct_complete := 100;
        NEW.remaining_duration_days := 0;
    END IF;
    IF NEW.activity_status = 'in_progress' AND OLD.activity_status = 'not_started' THEN
        NEW.actual_start_date := COALESCE(NEW.actual_start_date, CURRENT_DATE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cpm_auto_complete ON cpm_activities;
CREATE TRIGGER trg_cpm_auto_complete BEFORE UPDATE ON cpm_activities
    FOR EACH ROW EXECUTE FUNCTION fn_cpm_auto_complete();


COMMENT ON TABLE cpm_activities IS '7-dimension dates: planned, baseline, estimated, actual, early(CPM), late(CPM), forecast. Friend''s app cannot match.';
COMMENT ON COLUMN cpm_activities.is_critical IS 'True when total_float_days <= 0 (CPM definition of critical path)';
