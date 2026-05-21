-- ============================================================================
-- 03 SCHEME LIFECYCLE — master + formulation→stage1→stage2→order→closure
--                       + lifecycle_events (event stream for history)
-- ============================================================================
BEGIN;

CREATE TABLE scheme_master (
    scheme_id SERIAL PRIMARY KEY,
    scheme_code VARCHAR(50) UNIQUE,
    scheme_name VARCHAR(500) NOT NULL,
    scheme_type scheme_type_enum NOT NULL,
    current_status scheme_status_enum NOT NULL DEFAULT 'under_formulation',
    wbs_element VARCHAR(100),
    ipm_fa_code VARCHAR(100),
    amr_no VARCHAR(100),
    estimated_cost_cr NUMERIC(15,4),
    sanctioned_cost_cr NUMERIC(15,4),
    anticipated_cost_cr NUMERIC(15,4),
    scheme_owner_id INTEGER REFERENCES users(user_id),
    scheme_owner_name VARCHAR(200),
    scheme_owner_designation VARCHAR(200),
    steering_committee_chair VARCHAR(200),
    finance_controller VARCHAR(200),
    planned_start_date DATE,
    planned_completion_date DATE,
    actual_start_date DATE,
    actual_completion_date DATE,
    has_multiple_packages BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_scheme_status ON scheme_master(current_status) WHERE is_deleted=FALSE;
CREATE INDEX idx_scheme_type ON scheme_master(scheme_type) WHERE is_deleted=FALSE;
CREATE INDEX idx_scheme_code ON scheme_master(scheme_code) WHERE is_deleted=FALSE;
CREATE INDEX idx_scheme_name_trgm ON scheme_master USING gin(scheme_name gin_trgm_ops);
CREATE INDEX idx_scheme_extra ON scheme_master USING gin(extra_fields);
CREATE TRIGGER trg_scheme_master_updated_at BEFORE UPDATE ON scheme_master
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_scheme_master_audit AFTER INSERT OR UPDATE OR DELETE ON scheme_master
    FOR EACH ROW EXECUTE FUNCTION trg_write_audit_log();

CREATE TABLE scheme_tag_links (
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES scheme_tags(tag_id) ON DELETE CASCADE,
    tagged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tagged_by INTEGER REFERENCES users(user_id),
    PRIMARY KEY(scheme_id, tag_id));
CREATE INDEX idx_scheme_tag_links_tag ON scheme_tag_links(tag_id);

ALTER TABLE user_scheme_access
    ADD CONSTRAINT user_scheme_access_scheme_fk
        FOREIGN KEY (scheme_id) REFERENCES scheme_master(scheme_id) ON DELETE CASCADE;

-- ============================================================================
-- LIFECYCLE_EVENTS — the event stream (every dated action lives here)
--   • Canonical columns on stage1_approvals/stage2_approvals hold the LATEST
--   • This table holds EVERY date that ever existed (history, retender, RPN)
--   • AI queries this for "give me the full timeline of COB-7"
-- ============================================================================
CREATE TABLE lifecycle_events (
    event_id BIGSERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER,        -- FK added after packages table
    stage VARCHAR(40) NOT NULL,    -- 'formulation','stage1','tender','stage2','order','closure','document'
    event_type lifecycle_event_type_enum NOT NULL,
    event_date DATE NOT NULL,
    event_label VARCHAR(300),
    source_revision_id INTEGER,    -- which formulation/stage1/stage2/tender_cycle revision
    source_table VARCHAR(100),     -- name of the canonical table this came from
    source_row_id INTEGER,         -- row in source table
    document_id INTEGER,           -- FK added after documents table
    cost_cr NUMERIC(15,4),         -- if event has financial value (eg sanction, award)
    party_name VARCHAR(300),       -- if event involves an external party
    notes TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_events_scheme_date ON lifecycle_events(scheme_id, event_date DESC) WHERE NOT is_deleted;
CREATE INDEX idx_events_package_date ON lifecycle_events(package_id, event_date DESC) WHERE NOT is_deleted;
CREATE INDEX idx_events_type ON lifecycle_events(event_type, event_date DESC) WHERE NOT is_deleted;
CREATE INDEX idx_events_stage ON lifecycle_events(stage, event_date DESC) WHERE NOT is_deleted;
CREATE INDEX idx_events_document ON lifecycle_events(document_id) WHERE document_id IS NOT NULL;

-- Helper trigger: auto-emit lifecycle_events row from date column changes
CREATE OR REPLACE FUNCTION trg_emit_lifecycle_event(
    p_scheme_id INTEGER, p_package_id INTEGER, p_stage VARCHAR, p_event_type TEXT,
    p_event_date DATE, p_source_table VARCHAR, p_source_row_id INTEGER,
    p_revision_id INTEGER, p_cost_cr NUMERIC, p_party VARCHAR, p_actor INTEGER)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_event_date IS NULL THEN RETURN; END IF;
    -- Idempotent: skip if exact same event already exists
    IF EXISTS(SELECT 1 FROM lifecycle_events
              WHERE source_table=p_source_table AND source_row_id=p_source_row_id
                AND event_type=p_event_type::lifecycle_event_type_enum
                AND event_date=p_event_date) THEN
        RETURN;
    END IF;
    INSERT INTO lifecycle_events(scheme_id,package_id,stage,event_type,event_date,
        source_revision_id,source_table,source_row_id,cost_cr,party_name,created_by)
    VALUES(p_scheme_id,p_package_id,p_stage,p_event_type::lifecycle_event_type_enum,
        p_event_date,p_revision_id,p_source_table,p_source_row_id,p_cost_cr,p_party,p_actor);
END; $$;

-- ============================================================================
-- FORMULATION (revisioned, with all the dates from your t3 design)
-- ============================================================================
CREATE TABLE scheme_formulation (
    formulation_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL DEFAULT 0,
    revision_label VARCHAR(100),
    revision_reason TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    consultant_name VARCHAR(300),
    consultant_acceptance_date DATE,
    draft_fr_ts_date DATE,
    final_fr_ts_ce_ec_date DATE,
    pre_nit_meeting_date DATE,
    pre_nit_participants TEXT,
    plant_pag_meeting_date DATE,
    dic_approval_date DATE,
    forwarded_to_corporate_date DATE,
    cost_gross_cr NUMERIC(15,4),
    cost_net_itc_cr NUMERIC(15,4),
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, revision_no));
CREATE INDEX idx_formulation_current ON scheme_formulation(scheme_id) WHERE is_current=TRUE;
CREATE TRIGGER trg_formulation_updated_at BEFORE UPDATE ON scheme_formulation
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_formulation_audit AFTER INSERT OR UPDATE OR DELETE ON scheme_formulation
    FOR EACH ROW EXECUTE FUNCTION trg_write_audit_log();

-- Auto-emit lifecycle_events on formulation date changes
CREATE OR REPLACE FUNCTION trg_formulation_emit_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','consultant_acceptance',
        NEW.consultant_acceptance_date,'scheme_formulation',NEW.formulation_id,
        NEW.formulation_id,NEW.cost_net_itc_cr,NEW.consultant_name,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','draft_fr_ts',
        NEW.draft_fr_ts_date,'scheme_formulation',NEW.formulation_id,NEW.formulation_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','final_fr_ts_ce_ec',
        NEW.final_fr_ts_ce_ec_date,'scheme_formulation',NEW.formulation_id,NEW.formulation_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','pre_nit_meeting',
        NEW.pre_nit_meeting_date,'scheme_formulation',NEW.formulation_id,NEW.formulation_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','plant_pag_meeting',
        NEW.plant_pag_meeting_date,'scheme_formulation',NEW.formulation_id,NEW.formulation_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','dic_approval',
        NEW.dic_approval_date,'scheme_formulation',NEW.formulation_id,NEW.formulation_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'formulation','forwarded_to_corporate',
        NEW.forwarded_to_corporate_date,'scheme_formulation',NEW.formulation_id,NEW.formulation_id,NULL,NULL,NEW.updated_by);
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_formulation_events AFTER INSERT OR UPDATE ON scheme_formulation
    FOR EACH ROW EXECUTE FUNCTION trg_formulation_emit_events();

-- ============================================================================
-- STAGE 1 APPROVALS (revisioned; canonical "latest" stored here)
-- ============================================================================
CREATE TABLE stage1_approvals (
    stage1_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL DEFAULT 0,
    revision_label VARCHAR(100),
    revision_reason TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    cod_date DATE,
    independent_financial_appraisal_date DATE,
    corporate_pag_date DATE,
    chairman_approval_date DATE,
    pcsb_date DATE,
    sail_board_date DATE,
    sanction_date DATE,
    order_date DATE,
    cost_gross_cr NUMERIC(15,4),
    cost_net_itc_cr NUMERIC(15,4),
    implementation_period_months INTEGER,
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, revision_no));
CREATE INDEX idx_stage1_current ON stage1_approvals(scheme_id) WHERE is_current=TRUE;
CREATE TRIGGER trg_stage1_updated_at BEFORE UPDATE ON stage1_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_stage1_audit AFTER INSERT OR UPDATE OR DELETE ON stage1_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_write_audit_log();

CREATE OR REPLACE FUNCTION trg_stage1_emit_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','cod',NEW.cod_date,
        'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','independent_financial_appraisal',
        NEW.independent_financial_appraisal_date,'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','corporate_pag',
        NEW.corporate_pag_date,'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','chairman_approval',
        NEW.chairman_approval_date,'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','pcsb',NEW.pcsb_date,
        'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','sail_board',
        NEW.sail_board_date,'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','stage1_sanction',
        NEW.sanction_date,'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NEW.cost_net_itc_cr,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage1','stage1_order',
        NEW.order_date,'stage1_approvals',NEW.stage1_id,NEW.stage1_id,NULL,NULL,NEW.updated_by);
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_stage1_events AFTER INSERT OR UPDATE ON stage1_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_stage1_emit_events();

-- ============================================================================
-- STAGE 2 APPROVALS (firmed up cost)
-- ============================================================================
CREATE TABLE stage2_approvals (
    stage2_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL DEFAULT 0,
    revision_label VARCHAR(100),
    revision_reason TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    draft_board_note_date DATE,
    proposal_to_co_date DATE,
    firmed_up_cost_net_itc_cr NUMERIC(15,4),
    firmed_up_cost_gross_cr NUMERIC(15,4),
    consultant_estimate_cr NUMERIC(15,4),
    variance_vs_stage1_pct NUMERIC(8,2),
    variance_vs_consultant_pct NUMERIC(8,2),
    cod_date DATE,
    pag_date DATE,
    chairman_approval_date DATE,
    pcsb_date DATE,
    sail_board_date DATE,
    empowered_committee_date DATE,
    sanction_date DATE,
    order_date DATE,
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, revision_no));
CREATE INDEX idx_stage2_current ON stage2_approvals(scheme_id) WHERE is_current=TRUE;
CREATE TRIGGER trg_stage2_updated_at BEFORE UPDATE ON stage2_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_stage2_audit AFTER INSERT OR UPDATE OR DELETE ON stage2_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_write_audit_log();

CREATE OR REPLACE FUNCTION trg_stage2_emit_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','draft_board_note',
        NEW.draft_board_note_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','proposal_to_co',
        NEW.proposal_to_co_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','stage2_pag',
        NEW.pag_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','stage2_chairman_approval',
        NEW.chairman_approval_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','sail_board',
        NEW.sail_board_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','empowered_committee',
        NEW.empowered_committee_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','stage2_sanction',
        NEW.sanction_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NEW.firmed_up_cost_net_itc_cr,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'stage2','stage2_order',
        NEW.order_date,'stage2_approvals',NEW.stage2_id,NEW.stage2_id,NULL,NULL,NEW.updated_by);
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_stage2_events AFTER INSERT OR UPDATE ON stage2_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_stage2_emit_events();

-- ============================================================================
-- SCHEME ORDER + ToD + CLOSURE
-- ============================================================================
CREATE TABLE scheme_orders (
    order_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    loi_date DATE,
    loa_date DATE,
    po_number VARCHAR(100),
    party_name VARCHAR(300),
    effective_date DATE,
    schedule_months INTEGER,
    schedule_completion_date DATE,
    contract_value_cr NUMERIC(15,4),
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_orders_current ON scheme_orders(scheme_id) WHERE is_current=TRUE;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON scheme_orders
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION trg_orders_emit_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'order','loi_issued',NEW.loi_date,
        'scheme_orders',NEW.order_id,NEW.order_id,NEW.contract_value_cr,NEW.party_name,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'order','loa_issued',NEW.loa_date,
        'scheme_orders',NEW.order_id,NEW.order_id,NEW.contract_value_cr,NEW.party_name,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'order','effective_date',
        NEW.effective_date,'scheme_orders',NEW.order_id,NEW.order_id,NULL,NEW.party_name,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'order','tod_original',
        NEW.schedule_completion_date,'scheme_orders',NEW.order_id,NEW.order_id,NULL,NEW.party_name,NEW.updated_by);
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_orders_events AFTER INSERT OR UPDATE ON scheme_orders
    FOR EACH ROW EXECUTE FUNCTION trg_orders_emit_events();

CREATE TABLE scheme_closure (
    closure_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE UNIQUE,
    completion_marked_date DATE,
    commissioning_date DATE,
    pg_date DATE,
    fac_date DATE,
    pac_date DATE,
    final_cost_cr NUMERIC(15,4),
    completion_certificate_ref VARCHAR(200),
    lessons_learned TEXT,
    delay_reasons TEXT,
    is_dropped BOOLEAN NOT NULL DEFAULT FALSE,
    drop_reason TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER trg_closure_updated_at BEFORE UPDATE ON scheme_closure
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION trg_closure_emit_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'closure','commissioning',
        NEW.commissioning_date,'scheme_closure',NEW.closure_id,NULL,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'closure','pg_test',
        NEW.pg_date,'scheme_closure',NEW.closure_id,NULL,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'closure','pac',
        NEW.pac_date,'scheme_closure',NEW.closure_id,NULL,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'closure','fac',
        NEW.fac_date,'scheme_closure',NEW.closure_id,NULL,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(NEW.scheme_id,NULL,'closure','closure',
        NEW.completion_marked_date,'scheme_closure',NEW.closure_id,NULL,NEW.final_cost_cr,NULL,NEW.updated_by);
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_closure_events AFTER INSERT OR UPDATE ON scheme_closure
    FOR EACH ROW EXECUTE FUNCTION trg_closure_emit_events();

COMMIT;
