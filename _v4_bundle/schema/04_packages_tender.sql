-- ============================================================================
-- 04 PACKAGES + TENDER CYCLE SYSTEM
--   (Absorbs t3.sql's superior design: tender_cycles, bid_evaluations,
--    price_evaluations, negotiation_rounds — all package-scoped for multi-pkg)
-- ============================================================================
BEGIN;

CREATE TABLE packages (
    package_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_no INTEGER NOT NULL,
    package_code VARCHAR(50),
    package_name VARCHAR(500) NOT NULL,
    package_scope TEXT,
    package_type VARCHAR(50),
    package_status package_status_enum NOT NULL DEFAULT 'planned',
    package_estimate_cr NUMERIC(15,4),
    package_value_cr NUMERIC(15,4),
    linked_stage1_id INTEGER REFERENCES stage1_approvals(stage1_id),
    linked_stage2_id INTEGER REFERENCES stage2_approvals(stage2_id),
    project_manager_id INTEGER REFERENCES users(user_id),
    project_manager_name VARCHAR(200),
    project_manager_email VARCHAR(200),
    project_manager_phone VARCHAR(50),
    executing_agency VARCHAR(300),
    consultant_name VARCHAR(300),
    consultant_pmc VARCHAR(300),
    section_in_charge VARCHAR(200),
    safety_officer VARCHAR(200),
    quality_officer VARCHAR(200),
    site_location VARCHAR(300),
    planned_start_date DATE,
    planned_end_date DATE,
    start_date_actual DATE,
    completion_date_actual DATE,
    is_scheme_mirror BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, package_no));
CREATE INDEX idx_packages_scheme ON packages(scheme_id) WHERE NOT is_deleted;
CREATE INDEX idx_packages_status ON packages(package_status) WHERE NOT is_deleted;
CREATE INDEX idx_packages_mirror ON packages(scheme_id, is_scheme_mirror);
CREATE INDEX idx_packages_pm ON packages(project_manager_id);
CREATE TRIGGER trg_packages_updated_at BEFORE UPDATE ON packages
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_packages_audit AFTER INSERT OR UPDATE OR DELETE ON packages
    FOR EACH ROW EXECUTE FUNCTION trg_write_audit_log();

-- Mirror-package trigger
CREATE OR REPLACE FUNCTION trg_create_mirror_package()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO packages(scheme_id, package_no, package_name, package_status,
                         package_estimate_cr, package_value_cr,
                         is_scheme_mirror, created_by)
    VALUES(NEW.scheme_id, 1, NEW.scheme_name, 'planned',
           NEW.estimated_cost_cr, NEW.estimated_cost_cr, TRUE, NEW.created_by);
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_scheme_create_mirror_package
    AFTER INSERT ON scheme_master FOR EACH ROW EXECUTE FUNCTION trg_create_mirror_package();

-- Now add the package_id FK on lifecycle_events
ALTER TABLE lifecycle_events
    ADD CONSTRAINT lifecycle_events_package_fk
        FOREIGN KEY (package_id) REFERENCES packages(package_id) ON DELETE CASCADE;

-- ============================================================================
-- TENDER CYCLES (multi-cycle for retender/RPN — superior to v3)
--   Each cycle has its own bid_eval + price_eval + negotiation_rounds
-- ============================================================================
CREATE TABLE tender_cycles (
    tender_cycle_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    cycle_no INTEGER NOT NULL,
    cycle_label VARCHAR(100),
    cycle_status tender_cycle_status_enum NOT NULL DEFAULT 'active',
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    pr_initiation_date DATE,
    pr_approval_date DATE,
    mode_of_tender VARCHAR(50),
    nit_number VARCHAR(100),
    nit_date DATE,
    pre_bid_date DATE,
    pre_bid_participants TEXT,
    tod_original_date DATE,         -- original Time of Delivery from NIT
    offers_received_count INTEGER,
    bidder_names TEXT[],
    cancellation_reason TEXT,
    cancellation_date DATE,
    rpn_issued BOOLEAN NOT NULL DEFAULT FALSE,
    rpn_date DATE,
    rpn_reason TEXT,
    awarded_value_cr NUMERIC(15,4),
    estimated_value_cr NUMERIC(15,4),
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, cycle_no));
CREATE INDEX idx_tender_cycles_pkg ON tender_cycles(package_id) WHERE NOT is_deleted;
CREATE INDEX idx_tender_cycles_current ON tender_cycles(package_id) WHERE is_current=TRUE;
CREATE INDEX idx_tender_cycles_status ON tender_cycles(cycle_status);
CREATE TRIGGER trg_tender_cycles_updated_at BEFORE UPDATE ON tender_cycles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_tender_cycles_audit AFTER INSERT OR UPDATE OR DELETE ON tender_cycles
    FOR EACH ROW EXECUTE FUNCTION trg_write_audit_log();

CREATE OR REPLACE FUNCTION trg_tender_cycle_emit_events()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_scheme_id INTEGER;
BEGIN
    SELECT scheme_id INTO v_scheme_id FROM packages WHERE package_id=NEW.package_id;
    PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','pr_initiation',
        NEW.pr_initiation_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','pr_approval',
        NEW.pr_approval_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','nit_issued',
        NEW.nit_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NEW.estimated_value_cr,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','pre_bid',
        NEW.pre_bid_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','tod_original',
        NEW.tod_original_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NULL,NULL,NEW.updated_by);
    PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','tender_cancelled',
        NEW.cancellation_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NULL,NULL,NEW.updated_by);
    IF NEW.rpn_issued THEN
        PERFORM trg_emit_lifecycle_event(v_scheme_id,NEW.package_id,'tender','rpn_issued',
            NEW.rpn_date,'tender_cycles',NEW.tender_cycle_id,NEW.tender_cycle_id,NULL,NULL,NEW.updated_by);
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_tender_cycle_events AFTER INSERT OR UPDATE ON tender_cycles
    FOR EACH ROW EXECUTE FUNCTION trg_tender_cycle_emit_events();

CREATE TABLE bid_evaluations (
    bid_evaluation_id SERIAL PRIMARY KEY,
    tender_cycle_id INTEGER NOT NULL REFERENCES tender_cycles(tender_cycle_id) ON DELETE CASCADE,
    forwarded_to_consultant_date DATE,
    ter_date DATE,
    tec_report_date DATE,
    technically_eligible_parties TEXT[],
    technically_ineligible_parties TEXT[],
    cec_report_date DATE,
    commercially_eligible_parties TEXT[],
    commercially_ineligible_parties TEXT[],
    tc_recommendation_date DATE,
    tc_approval_date DATE,
    techno_commercial_eligible TEXT[],
    techno_commercial_ineligible TEXT[],
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_bid_eval_cycle ON bid_evaluations(tender_cycle_id);
CREATE TRIGGER trg_bid_eval_updated_at BEFORE UPDATE ON bid_evaluations
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE price_evaluations (
    price_evaluation_id SERIAL PRIMARY KEY,
    tender_cycle_id INTEGER NOT NULL REFERENCES tender_cycles(tender_cycle_id) ON DELETE CASCADE,
    mode_of_price_discovery VARCHAR(50),
    differential_price_letter_date DATE,
    ra_opening_date DATE,
    ra_report_submission_date DATE,
    l1_party_name VARCHAR(300),
    l1_cost_net_itc_cr NUMERIC(15,4),
    consultant_estimate_cr NUMERIC(15,4),
    forwarded_to_consultant_date DATE,
    price_eval_report_date DATE,
    variance_vs_estimate_pct NUMERIC(8,2),
    tc_recommendation_date DATE,
    tc_approval_date DATE,
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_price_eval_cycle ON price_evaluations(tender_cycle_id);
CREATE TRIGGER trg_price_eval_updated_at BEFORE UPDATE ON price_evaluations
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE negotiation_rounds (
    negotiation_id SERIAL PRIMARY KEY,
    tender_cycle_id INTEGER NOT NULL REFERENCES tender_cycles(tender_cycle_id) ON DELETE CASCADE,
    round_no INTEGER NOT NULL,
    negotiation_date DATE NOT NULL,
    discounted_price_net_itc_cr NUMERIC(15,4),
    forwarded_to_consultant_date DATE,
    price_eval_report_date DATE,
    variance_vs_estimate_pct NUMERIC(8,2),
    tc_recommendation_date DATE,
    tc_approval_date DATE,
    is_final_round BOOLEAN NOT NULL DEFAULT FALSE,
    remarks TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tender_cycle_id, round_no));

CREATE TABLE tod_extensions (
    extension_id SERIAL PRIMARY KEY,
    tender_cycle_id INTEGER NOT NULL REFERENCES tender_cycles(tender_cycle_id) ON DELETE CASCADE,
    extension_no INTEGER NOT NULL,
    extended_to_date DATE NOT NULL,
    extension_letter_no VARCHAR(100),
    approved_by_date DATE,
    reason TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tender_cycle_id, extension_no));

CREATE TABLE contracts (
    contract_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    contract_no VARCHAR(100) NOT NULL,
    contractor_name VARCHAR(300),
    contract_value_cr NUMERIC(15,4),
    loa_date DATE,
    effective_date DATE,
    contract_duration_months INTEGER,
    schedule_completion_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, contract_no));
CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE contract_amendments (
    amendment_id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
    amendment_no INTEGER NOT NULL,
    amendment_date DATE NOT NULL,
    value_change_cr NUMERIC(15,4),
    new_completion_date DATE,
    reason TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(contract_id, amendment_no));

COMMIT;
