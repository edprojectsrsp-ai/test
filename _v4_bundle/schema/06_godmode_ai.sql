-- ============================================================================
-- 06 GOD MODE PILLARS + AI/RAG FOUNDATION
--   Risk indicators, forecasts, observations, AI conversations,
--   notifications, documents + pgvector, correspondence, record_notes,
--   commitments, approvals
-- ============================================================================
BEGIN;

CREATE TABLE risk_indicators (
    risk_id SERIAL PRIMARY KEY,
    scheme_id INTEGER REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE CASCADE,
    indicator_key VARCHAR(100) NOT NULL,
    indicator_label VARCHAR(200) NOT NULL,
    risk_level risk_level_enum NOT NULL,
    risk_score NUMERIC(5,2),
    contributing_factors JSONB,
    suggested_action TEXT,
    computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    acknowledged_by INTEGER REFERENCES users(user_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT risk_scope_check CHECK (scheme_id IS NOT NULL OR package_id IS NOT NULL));
CREATE INDEX idx_risk_scheme ON risk_indicators(scheme_id) WHERE is_active=TRUE;
CREATE INDEX idx_risk_package ON risk_indicators(package_id) WHERE is_active=TRUE;
CREATE INDEX idx_risk_level ON risk_indicators(risk_level, computed_at DESC) WHERE is_active=TRUE;

CREATE TABLE forecast_snapshots (
    forecast_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    forecast_method forecast_method_enum NOT NULL,
    forecast_completion_date DATE,
    confidence_pct NUMERIC(5,2),
    confidence_lower_date DATE,
    confidence_upper_date DATE,
    forecast_progress_pct NUMERIC(6,2),
    forecast_cost_cr NUMERIC(15,4),
    input_actual_pct NUMERIC(6,2),
    input_planned_pct NUMERIC(6,2),
    days_observed INTEGER,
    model_params JSONB,
    explainer TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_forecast ON forecast_snapshots(package_id, snapshot_date DESC);
CREATE INDEX idx_forecast_current ON forecast_snapshots(package_id) WHERE is_current=TRUE;

CREATE TABLE field_observations (
    observation_id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    activity_id INTEGER REFERENCES plan_activities(activity_id) ON DELETE SET NULL,
    observation_type observation_type_enum NOT NULL DEFAULT 'note',
    title VARCHAR(300),
    description TEXT NOT NULL,
    severity risk_level_enum,
    photo_urls TEXT[],
    location_lat NUMERIC(10,7),
    location_lng NUMERIC(10,7),
    location_label VARCHAR(200),
    weather VARCHAR(100),
    observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observed_by INTEGER NOT NULL REFERENCES users(user_id),
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(user_id),
    resolution_notes TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_obs_pkg ON field_observations(package_id, observed_at DESC) WHERE NOT is_deleted;
CREATE INDEX idx_obs_unresolved ON field_observations(package_id) WHERE NOT is_resolved AND NOT is_deleted;

-- ============================================================================
-- DOCUMENTS + RAG (AI Sprint 8 foundation, built NOW for one-shot schema)
-- ============================================================================
CREATE TABLE documents (
    document_id SERIAL PRIMARY KEY,
    scheme_id INTEGER REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE CASCADE,
    tender_cycle_id INTEGER REFERENCES tender_cycles(tender_cycle_id) ON DELETE SET NULL,
    contract_id INTEGER REFERENCES contracts(contract_id) ON DELETE SET NULL,
    document_type document_type_enum NOT NULL DEFAULT 'other',
    title VARCHAR(500) NOT NULL,
    description TEXT,
    file_name VARCHAR(300) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,    -- relative path in object store
    file_size_bytes BIGINT,
    file_hash VARCHAR(64),               -- sha256 for dedup
    mime_type VARCHAR(100),
    page_count INTEGER,
    keywords TEXT[],
    auto_summary TEXT,                   -- AI-generated summary
    important_points TEXT[],             -- AI-extracted key points
    document_date DATE,                  -- date FROM the document (eg letter date)
    received_date DATE,                  -- when received/uploaded
    extraction_status VARCHAR(30) DEFAULT 'pending',  -- pending/processing/done/failed
    ocr_required BOOLEAN DEFAULT FALSE,
    ocr_completed BOOLEAN DEFAULT FALSE,
    chunk_count INTEGER DEFAULT 0,
    embedding_status VARCHAR(30) DEFAULT 'pending',
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_docs_scheme ON documents(scheme_id) WHERE NOT is_deleted;
CREATE INDEX idx_docs_package ON documents(package_id) WHERE NOT is_deleted;
CREATE INDEX idx_docs_type ON documents(document_type) WHERE NOT is_deleted;
CREATE INDEX idx_docs_keywords ON documents USING gin(keywords);
CREATE INDEX idx_docs_hash ON documents(file_hash);
CREATE INDEX idx_docs_status ON documents(extraction_status, embedding_status);
CREATE TRIGGER trg_docs_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Now wire lifecycle_events.document_id FK
ALTER TABLE lifecycle_events
    ADD CONSTRAINT lifecycle_events_document_fk
        FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE SET NULL;

-- Document chunks (text segments for RAG)
CREATE TABLE document_chunks (
    chunk_id BIGSERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    chunk_no INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_tokens INTEGER,
    page_number INTEGER,
    section_path TEXT,                       -- e.g. "Section 3.2 / Clause 4"
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, chunk_no));
CREATE INDEX idx_chunks_doc ON document_chunks(document_id, chunk_no);
CREATE INDEX idx_chunks_text_trgm ON document_chunks USING gin(chunk_text gin_trgm_ops);

-- Embeddings (pgvector) — 768-dim for BGE-M3 / all-mpnet-base-v2
-- If pgvector extension isn't available, vector column becomes JSONB fallback
CREATE TABLE document_embeddings (
    embedding_id BIGSERIAL PRIMARY KEY,
    chunk_id BIGINT NOT NULL REFERENCES document_chunks(chunk_id) ON DELETE CASCADE,
    embedding_model VARCHAR(100) NOT NULL,
    embedding_dim INTEGER NOT NULL,
    embedding vector(768),                   -- BGE-M3 dimension; adjust if you swap models
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chunk_id, embedding_model));
CREATE INDEX idx_emb_chunk ON document_embeddings(chunk_id);
CREATE INDEX idx_emb_vec ON document_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);

-- ============================================================================
-- CORRESPONDENCE, RECORD NOTES, COMMITMENTS, APPROVALS (AI-required)
-- ============================================================================
CREATE TABLE scheme_correspondence (
    correspondence_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE SET NULL,
    direction VARCHAR(10) NOT NULL,        -- 'in' or 'out'
    correspondence_no VARCHAR(100),
    correspondence_date DATE NOT NULL,
    sender VARCHAR(300),
    recipient VARCHAR(300),
    subject VARCHAR(500) NOT NULL,
    body TEXT,
    summary TEXT,                          -- AI-generated
    action_required BOOLEAN DEFAULT FALSE,
    action_due_date DATE,
    action_status VARCHAR(50),             -- 'pending', 'in_progress', 'done', 'na'
    document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT corr_direction CHECK (direction IN ('in','out')));
CREATE INDEX idx_corr_scheme ON scheme_correspondence(scheme_id, correspondence_date DESC);
CREATE INDEX idx_corr_pkg ON scheme_correspondence(package_id, correspondence_date DESC);
CREATE INDEX idx_corr_action ON scheme_correspondence(action_status) WHERE action_required=TRUE;
CREATE TRIGGER trg_corr_updated_at BEFORE UPDATE ON scheme_correspondence
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE record_notes (
    note_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE SET NULL,
    note_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note_type VARCHAR(50),                 -- 'observation', 'decision', 'instruction', 'meeting_note'
    title VARCHAR(300),
    body TEXT NOT NULL,
    summary TEXT,                          -- AI-generated
    key_points TEXT[],                     -- AI-extracted
    raised_by VARCHAR(200),
    addressed_to VARCHAR(200),
    document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_notes_scheme ON record_notes(scheme_id, note_date DESC);
CREATE INDEX idx_notes_pkg ON record_notes(package_id, note_date DESC);
CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON record_notes
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE commitments (
    commitment_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE SET NULL,
    commitment_type VARCHAR(50),           -- 'delivery', 'payment', 'approval', 'compliance'
    title VARCHAR(300) NOT NULL,
    description TEXT,
    committed_by VARCHAR(200),
    committed_to VARCHAR(200),
    committed_date DATE,
    due_date DATE NOT NULL,
    actual_completion_date DATE,
    status VARCHAR(30) DEFAULT 'open',     -- 'open', 'in_progress', 'fulfilled', 'breached', 'cancelled'
    breach_reason TEXT,
    source_document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL,
    source_correspondence_id INTEGER REFERENCES scheme_correspondence(correspondence_id) ON DELETE SET NULL,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_commit_scheme ON commitments(scheme_id, due_date);
CREATE INDEX idx_commit_status ON commitments(status, due_date);
CREATE INDEX idx_commit_overdue ON commitments(due_date) WHERE status IN ('open','in_progress');
CREATE TRIGGER trg_commit_updated_at BEFORE UPDATE ON commitments
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE ad_hoc_approvals (
    approval_id SERIAL PRIMARY KEY,
    scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE SET NULL,
    approval_type VARCHAR(100) NOT NULL,   -- 'deviation','change_order','extension','price_revision','EOT'
    subject VARCHAR(500) NOT NULL,
    description TEXT,
    requested_by VARCHAR(200),
    requested_date DATE,
    approver_designation VARCHAR(200),
    approver_name VARCHAR(200),
    approval_date DATE,
    is_approved BOOLEAN,
    cost_impact_cr NUMERIC(15,4),
    time_impact_days INTEGER,
    rejection_reason TEXT,
    document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL,
    extra_fields JSONB NOT NULL DEFAULT '{}',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_approvals_scheme ON ad_hoc_approvals(scheme_id, requested_date DESC);
CREATE INDEX idx_approvals_pending ON ad_hoc_approvals(scheme_id) WHERE is_approved IS NULL;
CREATE TRIGGER trg_approvals_updated_at BEFORE UPDATE ON ad_hoc_approvals
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================================
-- AI CONVERSATIONS
-- ============================================================================
CREATE TABLE ai_conversations (
    conversation_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    scheme_id INTEGER REFERENCES scheme_master(scheme_id) ON DELETE SET NULL,
    package_id INTEGER REFERENCES packages(package_id) ON DELETE SET NULL,
    title VARCHAR(300),
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP,
    message_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    source VARCHAR(20) DEFAULT 'web',      -- 'web', 'telegram', 'api'
    extra_fields JSONB NOT NULL DEFAULT '{}');
CREATE INDEX idx_ai_conv_user ON ai_conversations(user_id, last_message_at DESC) WHERE NOT is_archived;
CREATE INDEX idx_ai_conv_scheme ON ai_conversations(scheme_id);

CREATE TABLE ai_messages (
    message_id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,             -- 'user','assistant','system','tool'
    content TEXT NOT NULL,
    tools_called JSONB,
    cited_scheme_ids INTEGER[],
    cited_package_ids INTEGER[],
    cited_document_ids INTEGER[],
    cited_chunk_ids BIGINT[],
    provider VARCHAR(50),                  -- 'groq', 'gemini', 'openai', 'ollama'
    model_name VARCHAR(100),
    tokens_used INTEGER,
    latency_ms INTEGER,
    cost_estimate_usd NUMERIC(10,6),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ai_role_valid CHECK (role IN ('user','assistant','system','tool')));
CREATE INDEX idx_ai_msg_conv ON ai_messages(conversation_id, created_at);

CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    severity risk_level_enum DEFAULT 'unknown',
    related_scheme_id INTEGER REFERENCES scheme_master(scheme_id) ON DELETE CASCADE,
    related_package_id INTEGER REFERENCES packages(package_id) ON DELETE CASCADE,
    related_url VARCHAR(500),
    channel notification_channel_enum NOT NULL DEFAULT 'in_app',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP,
    is_sent BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_notif_user_unread ON notifications(user_id, created_at DESC) WHERE NOT is_read;

CREATE TABLE notification_preferences (
    pref_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notification_type VARCHAR(100) NOT NULL,
    channel notification_channel_enum NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(user_id, notification_type, channel));

CREATE TABLE monitoring_log (
    log_id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    source VARCHAR(100),
    message TEXT,
    payload JSONB,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_mon_log ON monitoring_log(occurred_at DESC);
CREATE INDEX idx_mon_log_event ON monitoring_log(event_type, occurred_at DESC);

COMMIT;
