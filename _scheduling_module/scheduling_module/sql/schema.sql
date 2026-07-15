-- ============================================================================
-- Scheduling & Project Control Module  --  PostgreSQL schema
-- All PKs are UUID (gen_random_uuid via pgcrypto). Durations are in working
-- days. Dates are calendar dates; working-time logic lives in the CPM engine.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---- enumerated types ------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE rel_type      AS ENUM ('FS','SS','FF','SF');
  CREATE TYPE constraint_t  AS ENUM ('NONE','ASAP','ALAP','SNET','FNET',
                                     'SNLT','FNLT','MSO','MFO');
  CREATE TYPE activity_status AS ENUM ('not_started','in_progress','completed');
  CREATE TYPE alert_severity AS ENUM ('info','warning','critical');
  CREATE TYPE risk_status    AS ENUM ('open','mitigating','closed','realised');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- projects --------------------------------------------------------------
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    code            TEXT UNIQUE,
    description     TEXT,
    start_date      DATE NOT NULL,
    data_date       DATE,                          -- status / cutoff date
    default_calendar_id UUID,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- calendars -------------------------------------------------------------
CREATE TABLE calendars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    working_weekdays INT[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- ISO 1=Mon
    holidays        DATE[] NOT NULL DEFAULT '{}',
    exceptions_work DATE[] NOT NULL DEFAULT '{}',            -- forced working
    hours_per_day   NUMERIC(4,2) NOT NULL DEFAULT 8.0
);
ALTER TABLE projects
  ADD CONSTRAINT fk_proj_cal FOREIGN KEY (default_calendar_id)
  REFERENCES calendars(id) ON DELETE SET NULL;

-- ---- WBS (self-referential tree) -------------------------------------------
CREATE TABLE wbs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES wbs(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,                 -- e.g. 1.2.3
    name            TEXT NOT NULL,
    sequence        INT NOT NULL DEFAULT 0,
    UNIQUE (project_id, code)
);
CREATE INDEX idx_wbs_parent ON wbs(parent_id);

-- ---- activities ------------------------------------------------------------
CREATE TABLE activities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wbs_id          UUID REFERENCES wbs(id) ON DELETE SET NULL,
    calendar_id     UUID REFERENCES calendars(id) ON DELETE SET NULL,
    code            TEXT NOT NULL,                 -- activity ID, e.g. A1020
    name            TEXT NOT NULL,
    duration        INT NOT NULL DEFAULT 0,        -- original, working days
    remaining_duration INT,                        -- null -> derive from %
    percent_complete NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_milestone    BOOLEAN NOT NULL DEFAULT false,
    status          activity_status NOT NULL DEFAULT 'not_started',
    actual_start    DATE,
    actual_finish   DATE,
    constraint_type constraint_t NOT NULL DEFAULT 'NONE',
    constraint_date DATE,
    -- grouping dimensions for delay analysis
    agency          TEXT,
    discipline      TEXT,
    package         TEXT,
    area            TEXT,
    -- computed (cached) CPM outputs
    early_start     DATE, early_finish DATE,
    late_start      DATE, late_finish  DATE,
    total_float     INT,  free_float    INT,
    is_critical     BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (project_id, code)
);
CREATE INDEX idx_act_project ON activities(project_id);
CREATE INDEX idx_act_wbs     ON activities(wbs_id);
CREATE INDEX idx_act_crit    ON activities(project_id, is_critical);

-- ---- relationships (logic links) -------------------------------------------
CREATE TABLE relationships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    predecessor_id  UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    successor_id    UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    rel_type        rel_type NOT NULL DEFAULT 'FS',
    lag             INT NOT NULL DEFAULT 0,        -- working days; <0 = lead
    UNIQUE (predecessor_id, successor_id, rel_type)
);
CREATE INDEX idx_rel_pred ON relationships(predecessor_id);
CREATE INDEX idx_rel_succ ON relationships(successor_id);

-- ---- resources & assignments -----------------------------------------------
CREATE TABLE resources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    type            TEXT,                          -- labour / equipment / material
    unit            TEXT,
    rate            NUMERIC(14,2)
);
CREATE TABLE resource_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id     UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    units           NUMERIC(14,2) NOT NULL DEFAULT 1,
    budgeted_cost   NUMERIC(16,2)
);

-- ---- baselines -------------------------------------------------------------
CREATE TABLE baselines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    project_finish  DATE,                          -- baseline planned finish
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    captured_by     TEXT
);
CREATE TABLE baseline_activities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baseline_id     UUID NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
    activity_id     UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    bl_start        DATE, bl_finish DATE,
    bl_duration     INT,  bl_total_float INT,
    UNIQUE (baseline_id, activity_id)
);

-- ---- schedule update log ---------------------------------------------------
CREATE TABLE update_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id     UUID REFERENCES activities(id) ON DELETE SET NULL,
    update_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
    data_date       DATE,
    changed_by      TEXT,
    field_name      TEXT,
    previous_value  TEXT,
    revised_value   TEXT,
    remarks         TEXT
);
CREATE INDEX idx_upd_activity ON update_logs(activity_id);

-- ---- hindrance register ----------------------------------------------------
CREATE TABLE hindrances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id     UUID REFERENCES activities(id) ON DELETE SET NULL,
    hindrance_type  TEXT,                          -- weather/design/material...
    start_date      DATE, end_date DATE,
    responsibility  TEXT,                          -- owner/contractor/external
    impact_days     INT,
    remarks         TEXT,
    documents       JSONB DEFAULT '[]',            -- [{name,url}]
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hind_activity ON hindrances(activity_id);

-- ---- risk register ---------------------------------------------------------
CREATE TABLE risks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id     UUID REFERENCES activities(id) ON DELETE SET NULL,
    wbs_id          UUID REFERENCES wbs(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    category        TEXT,
    probability     NUMERIC(4,2),                  -- 0..1
    impact_days     INT,
    impact_cost     NUMERIC(16,2),
    severity_score  NUMERIC(6,2),                  -- prob * impact (derived)
    mitigation      TEXT,
    owner           TEXT,
    status          risk_status NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- DCMA assessment runs --------------------------------------------------
CREATE TABLE dcma_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    score           NUMERIC(5,1),
    passed_count    INT, applicable_count INT,
    detail          JSONB NOT NULL DEFAULT '[]'    -- list of check results
);

-- ---- alerts ----------------------------------------------------------------
CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id     UUID REFERENCES activities(id) ON DELETE CASCADE,
    category        TEXT NOT NULL,                 -- delayed/negative_float/...
    severity        alert_severity NOT NULL DEFAULT 'warning',
    message         TEXT NOT NULL,
    is_resolved     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_project ON alerts(project_id, is_resolved);

-- ---- imported file audit ---------------------------------------------------
CREATE TABLE schedule_imports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    file_name       TEXT,
    file_format     TEXT,                          -- xml/xer/mpp
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    activities_count INT, relationships_count INT,
    warnings        JSONB DEFAULT '[]'
);
