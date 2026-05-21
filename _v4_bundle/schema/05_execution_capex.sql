-- ============================================================================
-- 05 EXECUTION + APPENDIX-2 + CAPEX
-- ============================================================================
BEGIN;

-- Appendix-2 templates (system + user-extensible)
CREATE TABLE appendix2_templates (
    template_id SERIAL PRIMARY KEY,
    template_name VARCHAR(200) UNIQUE NOT NULL,
    description TEXT,
    scope_keywords TEXT[],
    target_scheme_type scheme_type_enum,
    is_global BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_appendix2_tpl_keywords ON appendix2_templates USING gin(scope_keywords);
CREATE TRIGGER trg_appendix2_tpl_updated_at BEFORE UPDATE ON appendix2_templates
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE appendix2_template_items (
    template_item_id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES appendix2_templates(template_id) ON DELETE CASCADE,
    parent_template_item_id INTEGER REFERENCES appendix2_template_items(template_item_id) ON DELETE CASCADE,
    is_category BOOLEAN NOT NULL DEFAULT FALSE,
    category_label VARCHAR(200),
    item_label VARCHAR(300),
    default_commencement_months NUMERIC(5,1) DEFAULT 0,
    default_completion_months NUMERIC(5,1) DEFAULT 0,
    default_weight_pct NUMERIC(5,2) DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    notes TEXT);
CREATE INDEX idx_tpl_items_tpl ON appendix2_template_items(template_id, sort_order);
CREATE INDEX idx_tpl_items_parent ON appendix2_template_items(parent_template_item_id);

-- Appendix-2 revisions (per scheme, optionally per package)
CREATE TABLE appendix2_revisions (
    revision_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE CASCADE,
    revision_label VARCHAR(50) NOT NULL,
    revision_no INTEGER NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    supersedes_revision_id INTEGER REFERENCES appendix2_revisions(revision_id),
    source VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_template_id INTEGER REFERENCES appendix2_templates(template_id),
    description TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, package_id, revision_no),
    CONSTRAINT rev_source_valid CHECK (source IN ('manual','template','imported','copied')));
CREATE INDEX idx_appendix2_rev_scheme ON appendix2_revisions(scheme_id) WHERE NOT is_deleted;
CREATE INDEX idx_appendix2_rev_pkg ON appendix2_revisions(package_id) WHERE NOT is_deleted;
CREATE INDEX idx_appendix2_rev_current ON appendix2_revisions(scheme_id, package_id) WHERE is_current=TRUE;
CREATE TRIGGER trg_appendix2_rev_updated_at BEFORE UPDATE ON appendix2_revisions
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE appendix2_items (
    item_id SERIAL PRIMARY KEY,
    revision_id INTEGER NOT NULL REFERENCES appendix2_revisions(revision_id) ON DELETE CASCADE,
    parent_item_id INTEGER REFERENCES appendix2_items(item_id) ON DELETE CASCADE,
    is_category BOOLEAN NOT NULL DEFAULT FALSE,
    s_no VARCHAR(20),
    category VARCHAR(120),
    item_name VARCHAR(300) NOT NULL,
    commencement_months NUMERIC(5,1) NOT NULL DEFAULT 0,
    completion_months NUMERIC(5,1) NOT NULL DEFAULT 0,
    schedule_start DATE,
    schedule_finish DATE,
    weight_pct NUMERIC(5,2) DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    source VARCHAR(30) DEFAULT 'manual',
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT month_order CHECK (completion_months >= commencement_months),
    CONSTRAINT category_consistency CHECK (
        (is_category=TRUE AND parent_item_id IS NULL) OR
        (is_category=FALSE AND parent_item_id IS NOT NULL)));
CREATE INDEX idx_items_rev_sort ON appendix2_items(revision_id, sort_order);
CREATE INDEX idx_items_parent ON appendix2_items(parent_item_id);
CREATE TRIGGER trg_appendix2_items_updated_at BEFORE UPDATE ON appendix2_items
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Progress plans
CREATE TABLE progress_plans (
    plan_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    plan_name VARCHAR(200) NOT NULL,
    plan_type VARCHAR(50) NOT NULL DEFAULT 'execution',
    financial_year VARCHAR(10),
    plan_version VARCHAR(20),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    plan_start_date DATE,
    plan_end_date DATE,
    appendix2_revision_id INTEGER REFERENCES appendix2_revisions(revision_id),
    description TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, plan_name, plan_version));
CREATE INDEX idx_plans_pkg ON progress_plans(package_id) WHERE NOT is_deleted;
CREATE INDEX idx_plans_current ON progress_plans(package_id) WHERE is_current=TRUE;
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON progress_plans
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE plan_activities (
    activity_id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES progress_plans(plan_id) ON DELETE CASCADE,
    activity_master_id INTEGER REFERENCES activity_master_global(activity_master_id),
    appendix2_item_id INTEGER REFERENCES appendix2_items(item_id),
    activity_name VARCHAR(255) NOT NULL,
    activity_category VARCHAR(100),
    uom_id INTEGER REFERENCES uom_master(uom_id),
    scope_qty NUMERIC(15,3),
    weight_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    planned_start_date DATE,
    planned_finish_date DATE,
    actual_start_date DATE,
    actual_finish_date DATE,
    actuals_till_last_fy NUMERIC(15,3) NOT NULL DEFAULT 0,
    expected_finish_date DATE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_activities_plan ON plan_activities(plan_id, sort_order) WHERE NOT is_deleted;
CREATE INDEX idx_activities_appx2 ON plan_activities(appendix2_item_id);
CREATE TRIGGER trg_activities_updated_at BEFORE UPDATE ON plan_activities
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE monthly_plan_entries (
    monthly_entry_id SERIAL PRIMARY KEY,
    activity_id INTEGER NOT NULL REFERENCES plan_activities(activity_id) ON DELETE CASCADE,
    month_date DATE NOT NULL,
    planned_qty NUMERIC(15,3) NOT NULL DEFAULT 0,
    row_type VARCHAR(20) DEFAULT 'plan',
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(activity_id, month_date, row_type),
    CONSTRAINT month_is_first CHECK (EXTRACT(DAY FROM month_date)=1));
CREATE INDEX idx_monthly_entries ON monthly_plan_entries(activity_id, month_date);

CREATE TABLE daily_actuals (
    daily_actual_id SERIAL PRIMARY KEY,
    activity_id INTEGER NOT NULL REFERENCES plan_activities(activity_id) ON DELETE CASCADE,
    actual_date DATE NOT NULL,
    actual_qty NUMERIC(15,3) NOT NULL DEFAULT 0,
    area_of_work VARCHAR(300),
    manpower_count INTEGER,
    equipment_deployed TEXT,
    weather_conditions VARCHAR(100),
    remarks TEXT,
    entered_by INTEGER REFERENCES users(user_id),
    entered_via VARCHAR(20) DEFAULT 'web',
    location_lat NUMERIC(10,7),
    location_lng NUMERIC(10,7),
    photo_urls TEXT[],
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(activity_id, actual_date));
CREATE INDEX idx_daily_actuals ON daily_actuals(activity_id, actual_date);
CREATE INDEX idx_daily_actuals_user ON daily_actuals(entered_by);

CREATE TABLE plant_progress_monthly (
    progress_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    month_date DATE NOT NULL,
    planned_progress_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
    actual_progress_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
    cumulative_planned_pct NUMERIC(6,2) DEFAULT 0,
    cumulative_actual_pct NUMERIC(6,2) DEFAULT 0,
    variance_pct NUMERIC(6,2) GENERATED ALWAYS AS (actual_progress_pct - planned_progress_pct) STORED,
    risk_level risk_level_enum NOT NULL DEFAULT 'unknown',
    notes TEXT,
    computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, month_date));
CREATE INDEX idx_plant_progress ON plant_progress_monthly(package_id, month_date DESC);

-- CAPEX (from t3 design)
CREATE TABLE capex_plans (
    capex_plan_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE SET NULL,
    plan_name VARCHAR(200) NOT NULL,
    financial_year VARCHAR(10) NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    is_approved BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by INTEGER REFERENCES users(user_id),
    approved_at TIMESTAMP,
    total_be_cr NUMERIC(15,4) DEFAULT 0,
    total_re_cr NUMERIC(15,4) DEFAULT 0,
    total_actual_cr NUMERIC(15,4) DEFAULT 0,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, financial_year, plan_name));
CREATE TRIGGER trg_capex_plans_updated_at BEFORE UPDATE ON capex_plans
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE capex_rows (
    capex_row_id SERIAL PRIMARY KEY,
    capex_plan_id INTEGER NOT NULL REFERENCES capex_plans(capex_plan_id) ON DELETE CASCADE,
    parent_row_id INTEGER REFERENCES capex_rows(capex_row_id) ON DELETE CASCADE,
    row_label VARCHAR(300) NOT NULL,
    indent_level INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_total_row BOOLEAN NOT NULL DEFAULT FALSE,
    be_cr NUMERIC(15,4) DEFAULT 0,
    re_cr NUMERIC(15,4) DEFAULT 0,
    actual_cr NUMERIC(15,4) DEFAULT 0,
    notes TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE capex_monthly (
    capex_monthly_id SERIAL PRIMARY KEY,
    capex_row_id INTEGER NOT NULL REFERENCES capex_rows(capex_row_id) ON DELETE CASCADE,
    month_date DATE NOT NULL,
    be_cr NUMERIC(15,4) DEFAULT 0,
    re_cr NUMERIC(15,4) DEFAULT 0,
    actual_cr NUMERIC(15,4) DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(capex_row_id, month_date));

CREATE TABLE billing_schedules (
    billing_schedule_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    contract_id INTEGER REFERENCES contracts(contract_id) ON DELETE SET NULL,
    milestone_no INTEGER NOT NULL,
    description TEXT NOT NULL,
    scheduled_amount_cr NUMERIC(15,4) NOT NULL DEFAULT 0,
    scheduled_date DATE,
    actual_amount_cr NUMERIC(15,4),
    actual_billed_date DATE,
    payment_received_date DATE,
    is_billed BOOLEAN NOT NULL DEFAULT FALSE,
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,
    appendix2_item_id INTEGER REFERENCES appendix2_items(item_id),
    remarks TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, milestone_no));
CREATE TRIGGER trg_billing_updated_at BEFORE UPDATE ON billing_schedules
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
