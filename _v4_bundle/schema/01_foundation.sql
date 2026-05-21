-- ============================================================================
-- PROJECT BRAIN — SCHEMA v4 (FINAL FORM)
-- ============================================================================
-- Builds on v3 with:
--   • pgvector for AI/RAG (Sprint 8 ready)
--   • lifecycle_events stream (full date history, retender support)
--   • documents + document_chunks + embeddings tables
--   • scheme_correspondence, record_notes, commitments, approvals
--   • Superior tender design (cycle → bid_eval → price_eval → negotiation)
--     absorbed from t3.sql, scoped to package_id (multi-package retender)
--   • Auto-event triggers (dates → lifecycle_events row)
--
-- Run order: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10
-- Or use master file: psql ... -f schema_v4_master.sql
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- NUKE FIRST
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'Project Brain v4 — final form with AI/RAG support';

-- EXTENSIONS (after schema recreate)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
-- pgvector for AI: install with `apt-get install postgresql-16-pgvector` first
-- If unavailable, comment out the next line and embeddings table will fall back to bytea
CREATE EXTENSION IF NOT EXISTS vector;

-- ENUMS
CREATE TYPE scheme_type_enum AS ENUM ('corporate','plant','dummy');
CREATE TYPE scheme_status_enum AS ENUM (
    'under_formulation','under_stage1','under_tendering','under_stage2',
    'ongoing','on_hold','closed','dropped');
CREATE TYPE package_status_enum AS ENUM (
    'planned','tendering','awarded','in_progress','on_hold','completed','closed','cancelled');
CREATE TYPE tender_cycle_status_enum AS ENUM (
    'active','cancelled','rpn_issued','awarded','retender_required','closed');
CREATE TYPE risk_level_enum AS ENUM ('green','amber','red','unknown');
CREATE TYPE audit_action_enum AS ENUM ('insert','update','delete','soft_delete','restore');
CREATE TYPE notification_channel_enum AS ENUM ('in_app','email','sms','webhook','telegram');
CREATE TYPE observation_type_enum AS ENUM (
    'progress_update','issue','safety_incident','quality_issue','photo','note');
CREATE TYPE forecast_method_enum AS ENUM (
    'linear_regression','last_3mo_trend','critical_path','manual_override','monte_carlo');

-- Lifecycle event types — every dated action gets one of these
CREATE TYPE lifecycle_event_type_enum AS ENUM (
    -- Formulation
    'consultant_acceptance','draft_fr_ts','final_fr_ts_ce_ec','pre_nit_meeting',
    'plant_pag_meeting','dic_approval','forwarded_to_corporate',
    -- Stage 1
    'cod','independent_financial_appraisal','corporate_pag','chairman_approval',
    'pcsb','sail_board','stage1_sanction','stage1_order',
    -- Tender
    'pr_initiation','pr_approval','nit_issued','pre_bid','tod_original','tender_opened',
    'tender_cancelled','rpn_issued','retender_started','tod_extension',
    -- Bid eval
    'forwarded_to_consultant','ter_submitted','tec_report','cec_report',
    'tc_recommendation','tc_approval',
    -- Price eval
    'ra_opened','price_eval_submitted','negotiation_round','differential_price_letter',
    -- Stage 2
    'draft_board_note','proposal_to_co','stage2_pag','stage2_chairman_approval',
    'empowered_committee','stage2_sanction','stage2_order',
    -- Order
    'loi_issued','loa_issued','effective_date','tod_actual',
    -- Execution / Closure
    'work_started','milestone_reached','tod_revised','commissioning','pg_test',
    'pac','fac','closure','dropped',
    -- Document events
    'document_uploaded','correspondence_received','correspondence_sent','record_note'
);

-- Document types for RAG
CREATE TYPE document_type_enum AS ENUM (
    'fr_ts','dpr','approval_letter','contract','loa','po','tender_doc',
    'correspondence_in','correspondence_out','record_note','meeting_minutes',
    'monthly_progress','site_photo','drawing','specification','test_report',
    'inspection_report','warranty','other'
);

-- ============================================================================
-- TRIGGER FUNCTIONS
-- ============================================================================

-- updated_at automaintainer
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$;

-- Audit log writer (defensive — tolerates missing columns)
CREATE OR REPLACE FUNCTION trg_write_audit_log()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    action_taken audit_action_enum;
    row_id INTEGER; pk_col TEXT; actor_id INTEGER;
    has_is_deleted BOOLEAN; old_del BOOLEAN := FALSE; new_del BOOLEAN := FALSE;
BEGIN
    SELECT a.attname INTO pk_col FROM pg_index i
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
      WHERE i.indrelid=TG_RELID AND i.indisprimary LIMIT 1;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=TG_TABLE_NAME AND column_name='is_deleted')
      INTO has_is_deleted;
    IF TG_OP='INSERT' THEN
        action_taken := 'insert';
        EXECUTE format('SELECT ($1).%I', pk_col) INTO row_id USING NEW;
        BEGIN EXECUTE format('SELECT ($1).created_by') INTO actor_id USING NEW;
        EXCEPTION WHEN undefined_column THEN actor_id := NULL; END;
    ELSIF TG_OP='UPDATE' THEN
        IF has_is_deleted THEN
            EXECUTE format('SELECT ($1).is_deleted') INTO old_del USING OLD;
            EXECUTE format('SELECT ($1).is_deleted') INTO new_del USING NEW;
            action_taken := CASE
                WHEN old_del=FALSE AND new_del=TRUE THEN 'soft_delete'::audit_action_enum
                WHEN old_del=TRUE AND new_del=FALSE THEN 'restore'::audit_action_enum
                ELSE 'update'::audit_action_enum END;
        ELSE action_taken := 'update'; END IF;
        EXECUTE format('SELECT ($1).%I', pk_col) INTO row_id USING NEW;
        BEGIN EXECUTE format('SELECT COALESCE(($1).updated_by,($1).created_by)')
            INTO actor_id USING NEW;
        EXCEPTION WHEN undefined_column THEN actor_id := NULL; END;
    ELSIF TG_OP='DELETE' THEN
        action_taken := 'delete';
        EXECUTE format('SELECT ($1).%I', pk_col) INTO row_id USING OLD;
        BEGIN EXECUTE format('SELECT COALESCE(($1).updated_by,($1).created_by)')
            INTO actor_id USING OLD;
        EXCEPTION WHEN undefined_column THEN actor_id := NULL; END;
    END IF;
    INSERT INTO audit_log(table_name,row_id,action,actor_id,payload_before,payload_after)
    VALUES (TG_TABLE_NAME,row_id,action_taken,actor_id,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
    RETURN COALESCE(NEW,OLD);
END;
$$;

-- Auto-emit lifecycle_events when key date columns change (defined later in this file)

COMMIT;
