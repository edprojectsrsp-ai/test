-- ============================================================================
-- SPRINT 9A — e-NoteSheet (Digital File Noting System)
-- ============================================================================
-- Replaces paper file noting. Every note, signature, decision tracked digitally.
-- Files move along a "track" of officers; each adds notes; final approver closes.
--
-- Key concepts:
--   notesheet         : The "file" itself (subject, references, current owner)
--   notesheet_notes   : Individual notes (paragraphs) within the file - immutable
--   notesheet_track   : Officer movement chain (who's seen it, in what order)
--   notesheet_attachments : Files attached (PDFs, drawings)
--   notesheet_decisions : Final decisions (approved/rejected/returned)
--
-- Design choices:
--   - Notes are IMMUTABLE once submitted (real file noting doesn't allow erasure)
--   - Track entries are append-only
--   - Decisions are versioned (can be reopened)
--   - Full text search via tsvector
--   - Linked to scheme/package/tender_cycle for context
-- ============================================================================

-- ENUMS
DO $$ BEGIN
    CREATE TYPE notesheet_status_enum AS ENUM (
        'draft',           -- being created
        'in_circulation',  -- moving along the chain
        'pending_approval',-- with final approver
        'approved',
        'rejected',
        'returned',        -- sent back for clarification
        'closed',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notesheet_action_enum AS ENUM (
        'noted',          -- just read/acknowledged
        'commented',      -- added a remark
        'recommended',    -- recommended to next
        'approved',
        'rejected',
        'returned',       -- sent back
        'forwarded',      -- forwarded to specific officer
        'cc_added',       -- added someone to CC
        'reopened',
        'closed'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notesheet_priority_enum AS ENUM (
        'routine', 'urgent', 'most_urgent', 'immediate'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notesheet_category_enum AS ENUM (
        'sanction_request',     -- seeking expenditure sanction
        'deviation_approval',
        'change_of_scope',
        'eot_extension',        -- extension of time
        'price_revision',
        'vendor_clarification',
        'safety_incident',
        'quality_issue',
        'capex_request',
        'tender_recommendation',
        'award_recommendation',
        'closure_request',
        'general',
        'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE workflow_type_enum AS ENUM (
        'linear',         -- officer1 → officer2 → officer3 (fixed sequence)
        'role_based',     -- any officer with role X can act
        'parallel',       -- multiple officers in parallel (all must approve)
        'hybrid'          -- mix - linear with role-based steps
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- WORKFLOW TEMPLATES — reusable approval chains
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_templates (
    template_id         SERIAL PRIMARY KEY,
    template_code       VARCHAR(50) UNIQUE NOT NULL,
    template_name       VARCHAR(200) NOT NULL,
    description         TEXT,
    workflow_type       workflow_type_enum NOT NULL DEFAULT 'linear',
    applies_to_category notesheet_category_enum,
    min_cost_cr         NUMERIC(14,4),  -- min cost for this workflow to apply
    max_cost_cr         NUMERIC(14,4),  -- max cost for this workflow to apply
    is_active           BOOLEAN DEFAULT TRUE,
    is_deleted          BOOLEAN DEFAULT FALSE,
    created_by          INTEGER REFERENCES users(user_id),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_steps (
    step_id             SERIAL PRIMARY KEY,
    template_id         INTEGER REFERENCES workflow_templates(template_id) ON DELETE CASCADE,
    step_no             INTEGER NOT NULL,
    step_name           VARCHAR(200) NOT NULL,
    -- WHO acts at this step (one of these must be set)
    user_id             INTEGER REFERENCES users(user_id),  -- specific user
    designation         VARCHAR(100),                       -- by designation
    role                VARCHAR(50),                        -- by role (admin/manager/engineer/etc)
    department          VARCHAR(100),                       -- by department
    -- BEHAVIOR
    action_required     notesheet_action_enum NOT NULL DEFAULT 'approved',
    is_mandatory        BOOLEAN DEFAULT TRUE,
    can_return          BOOLEAN DEFAULT TRUE,
    can_skip            BOOLEAN DEFAULT FALSE,
    sla_hours           INTEGER,  -- expected turnaround
    UNIQUE(template_id, step_no)
);

CREATE INDEX IF NOT EXISTS idx_wf_template_active ON workflow_templates(is_active) WHERE NOT is_deleted;


-- ============================================================================
-- NOTESHEETS (the "files")
-- ============================================================================
CREATE TABLE IF NOT EXISTS notesheets (
    notesheet_id        SERIAL PRIMARY KEY,
    notesheet_no        VARCHAR(50) UNIQUE NOT NULL,  -- auto: PB/NS/2025/0001
    subject             VARCHAR(500) NOT NULL,
    category            notesheet_category_enum NOT NULL DEFAULT 'general',
    priority            notesheet_priority_enum NOT NULL DEFAULT 'routine',

    -- LINKED ENTITIES (any one or combination)
    scheme_id           INTEGER REFERENCES scheme_master(scheme_id),
    package_id          INTEGER REFERENCES packages(package_id),
    tender_cycle_id     INTEGER REFERENCES tender_cycles(tender_cycle_id),
    related_document_ids INTEGER[],  -- array of document_ids
    cost_implication_cr NUMERIC(14,4),    -- ₹ Cr if any
    time_implication_days INTEGER,         -- delay/EOT days if any

    -- WORKFLOW
    workflow_template_id INTEGER REFERENCES workflow_templates(template_id),
    current_step_no     INTEGER DEFAULT 1,
    current_owner_id    INTEGER REFERENCES users(user_id),
    cc_user_ids         INTEGER[],         -- additional viewers

    -- BODY (the actual content + AI summary)
    background          TEXT,              -- "context" para
    proposal            TEXT NOT NULL,     -- what's being proposed
    justification       TEXT,
    references_text     TEXT,              -- referenced policies/rules
    ai_summary          TEXT,              -- auto-generated by AI
    ai_key_points       TEXT[],            -- key bullets extracted by AI
    full_text_search    TSVECTOR,

    -- STATUS
    status              notesheet_status_enum NOT NULL DEFAULT 'draft',
    final_decision      VARCHAR(50),       -- 'approved' / 'rejected' / 'returned' etc.
    decision_date       DATE,
    closed_at           TIMESTAMP,

    -- META
    initiated_by        INTEGER NOT NULL REFERENCES users(user_id),
    initiated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_action_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_confidential     BOOLEAN DEFAULT FALSE,  -- restricts visibility
    confidential_user_ids INTEGER[],            -- who can see if confidential
    is_deleted          BOOLEAN DEFAULT FALSE,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notesheet_status ON notesheets(status) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notesheet_owner ON notesheets(current_owner_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notesheet_scheme ON notesheets(scheme_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notesheet_package ON notesheets(package_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notesheet_initiated_by ON notesheets(initiated_by);
CREATE INDEX IF NOT EXISTS idx_notesheet_no ON notesheets(notesheet_no);
CREATE INDEX IF NOT EXISTS idx_notesheet_fts ON notesheets USING GIN(full_text_search);


-- ============================================================================
-- NOTES — individual remarks within a notesheet (IMMUTABLE after submit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notesheet_notes (
    note_id             SERIAL PRIMARY KEY,
    notesheet_id        INTEGER NOT NULL REFERENCES notesheets(notesheet_id) ON DELETE CASCADE,
    note_no             INTEGER NOT NULL,  -- sequential within the notesheet
    note_text           TEXT NOT NULL,
    author_id           INTEGER NOT NULL REFERENCES users(user_id),
    author_designation  VARCHAR(150),    -- snapshot at time of writing
    author_department   VARCHAR(150),
    written_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- DIGITAL SIGNATURE (simple - bcrypt hash of note + user_id + secret)
    signature_hash      VARCHAR(255),
    is_locked           BOOLEAN DEFAULT TRUE,  -- always true after submit
    UNIQUE(notesheet_id, note_no)
);

CREATE INDEX IF NOT EXISTS idx_notesheet_notes_sheet ON notesheet_notes(notesheet_id);
CREATE INDEX IF NOT EXISTS idx_notesheet_notes_author ON notesheet_notes(author_id);


-- ============================================================================
-- TRACK — every movement of the file (append-only audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notesheet_track (
    track_id            SERIAL PRIMARY KEY,
    notesheet_id        INTEGER NOT NULL REFERENCES notesheets(notesheet_id) ON DELETE CASCADE,
    seq_no              INTEGER NOT NULL,    -- sequential within notesheet
    action              notesheet_action_enum NOT NULL,
    actor_id            INTEGER NOT NULL REFERENCES users(user_id),
    actor_designation   VARCHAR(150),
    from_user_id        INTEGER REFERENCES users(user_id),    -- who passed it
    to_user_id          INTEGER REFERENCES users(user_id),    -- who they sent to
    note_id             INTEGER REFERENCES notesheet_notes(note_id),  -- linked note if any
    workflow_step_no    INTEGER,
    remarks             TEXT,
    occurred_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sla_breach_hours    INTEGER,    -- positive if breached SLA
    UNIQUE(notesheet_id, seq_no)
);

CREATE INDEX IF NOT EXISTS idx_track_sheet ON notesheet_track(notesheet_id);
CREATE INDEX IF NOT EXISTS idx_track_actor ON notesheet_track(actor_id);


-- ============================================================================
-- ATTACHMENTS — files attached to a notesheet
-- ============================================================================
CREATE TABLE IF NOT EXISTS notesheet_attachments (
    attachment_id       SERIAL PRIMARY KEY,
    notesheet_id        INTEGER NOT NULL REFERENCES notesheets(notesheet_id) ON DELETE CASCADE,
    document_id         INTEGER REFERENCES documents(document_id),  -- via documents pipeline
    file_path           VARCHAR(500),
    file_name           VARCHAR(255),
    file_size_bytes     BIGINT,
    mime_type           VARCHAR(100),
    attached_by         INTEGER REFERENCES users(user_id),
    attached_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description         TEXT
);

CREATE INDEX IF NOT EXISTS idx_attach_sheet ON notesheet_attachments(notesheet_id);


-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-generate notesheet_no
CREATE OR REPLACE FUNCTION fn_generate_notesheet_no()
RETURNS TRIGGER AS $$
DECLARE
    yr TEXT;
    next_seq INTEGER;
BEGIN
    IF NEW.notesheet_no IS NULL OR NEW.notesheet_no = '' THEN
        yr := TO_CHAR(CURRENT_DATE, 'YYYY');
        SELECT COALESCE(MAX(CAST(SUBSTRING(notesheet_no FROM 11) AS INTEGER)), 0) + 1
            INTO next_seq
            FROM notesheets
            WHERE notesheet_no LIKE 'PB/NS/' || yr || '/%';
        NEW.notesheet_no := 'PB/NS/' || yr || '/' || LPAD(next_seq::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notesheet_no ON notesheets;
CREATE TRIGGER trg_notesheet_no
    BEFORE INSERT ON notesheets
    FOR EACH ROW EXECUTE FUNCTION fn_generate_notesheet_no();


-- Auto-number notes
CREATE OR REPLACE FUNCTION fn_auto_note_no()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.note_no IS NULL OR NEW.note_no = 0 THEN
        SELECT COALESCE(MAX(note_no), 0) + 1 INTO NEW.note_no
            FROM notesheet_notes WHERE notesheet_id = NEW.notesheet_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_note_no ON notesheet_notes;
CREATE TRIGGER trg_note_no
    BEFORE INSERT ON notesheet_notes
    FOR EACH ROW EXECUTE FUNCTION fn_auto_note_no();


-- Auto-number track entries
CREATE OR REPLACE FUNCTION fn_auto_track_seq()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.seq_no IS NULL OR NEW.seq_no = 0 THEN
        SELECT COALESCE(MAX(seq_no), 0) + 1 INTO NEW.seq_no
            FROM notesheet_track WHERE notesheet_id = NEW.notesheet_id;
    END IF;
    -- Also update notesheet.last_action_at
    UPDATE notesheets SET last_action_at = NEW.occurred_at
        WHERE notesheet_id = NEW.notesheet_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_seq ON notesheet_track;
CREATE TRIGGER trg_track_seq
    BEFORE INSERT ON notesheet_track
    FOR EACH ROW EXECUTE FUNCTION fn_auto_track_seq();


-- Lock notes — prevent edits/deletes after creation
CREATE OR REPLACE FUNCTION fn_lock_notes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Notes are immutable. Once submitted they cannot be edited.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Notes cannot be deleted. They are permanent audit records.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_notes_upd ON notesheet_notes;
CREATE TRIGGER trg_lock_notes_upd
    BEFORE UPDATE OR DELETE ON notesheet_notes
    FOR EACH ROW EXECUTE FUNCTION fn_lock_notes();


-- Auto-update full text search vector
CREATE OR REPLACE FUNCTION fn_update_notesheet_fts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.full_text_search :=
        setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.proposal, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.background, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.justification, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notesheet_fts ON notesheets;
CREATE TRIGGER trg_notesheet_fts
    BEFORE INSERT OR UPDATE OF subject, proposal, background, justification ON notesheets
    FOR EACH ROW EXECUTE FUNCTION fn_update_notesheet_fts();


-- ============================================================================
-- VIEW — pending action items for users
-- ============================================================================
CREATE OR REPLACE VIEW v_my_pending_notesheets AS
SELECT
    ns.notesheet_id, ns.notesheet_no, ns.subject, ns.category::text AS category,
    ns.priority::text AS priority, ns.status::text AS status,
    ns.current_owner_id, ns.cost_implication_cr,
    ns.initiated_by, u_init.full_name AS initiated_by_name,
    ns.initiated_at, ns.last_action_at,
    CURRENT_DATE - DATE(ns.last_action_at) AS days_pending,
    sm.scheme_id, sm.scheme_name, sm.scheme_code,
    p.package_id, p.package_name
FROM notesheets ns
LEFT JOIN users u_init ON u_init.user_id = ns.initiated_by
LEFT JOIN scheme_master sm ON sm.scheme_id = ns.scheme_id
LEFT JOIN packages p ON p.package_id = ns.package_id
WHERE NOT ns.is_deleted
  AND ns.status IN ('in_circulation', 'pending_approval', 'draft', 'returned');


-- ============================================================================
-- SEED — Default workflow templates
-- ============================================================================
INSERT INTO workflow_templates(template_code, template_name, description,
    workflow_type, applies_to_category, is_active, created_by)
VALUES
    ('WF_GENERAL_SIMPLE', 'General — Simple Approval',
     '2-step: Initiator → Manager approves',
     'role_based', 'general', TRUE, 1),
    ('WF_SANCTION_SMALL', 'Sanction Request (< ₹50 Cr)',
     'Initiator → Manager → Director (financial approval threshold)',
     'role_based', 'sanction_request', TRUE, 1),
    ('WF_SANCTION_LARGE', 'Sanction Request (≥ ₹50 Cr)',
     'Initiator → Manager → Director → CMD approval',
     'role_based', 'sanction_request', TRUE, 1),
    ('WF_DEVIATION', 'Deviation Approval',
     'Engineer → PM → Manager → Director',
     'linear', 'deviation_approval', TRUE, 1),
    ('WF_EOT', 'Extension of Time',
     'PM → Manager → Director',
     'role_based', 'eot_extension', TRUE, 1),
    ('WF_TENDER_RECOMMEND', 'Tender Award Recommendation',
     'Tender committee → Manager → Director → CMD',
     'linear', 'award_recommendation', TRUE, 1)
ON CONFLICT (template_code) DO NOTHING;

-- Seed steps for WF_GENERAL_SIMPLE
INSERT INTO workflow_steps(template_id, step_no, step_name, role, action_required, is_mandatory)
SELECT template_id, 1, 'Manager Review', 'manager', 'approved'::notesheet_action_enum, TRUE
FROM workflow_templates WHERE template_code='WF_GENERAL_SIMPLE'
ON CONFLICT DO NOTHING;

-- Seed steps for WF_SANCTION_SMALL
INSERT INTO workflow_steps(template_id, step_no, step_name, role, action_required, sla_hours, is_mandatory)
SELECT t.template_id, vals.step_no, vals.step_name, vals.role,
       vals.action::notesheet_action_enum, vals.sla, TRUE
FROM workflow_templates t
CROSS JOIN (VALUES
    (1, 'Manager Review',  'manager',  'recommended', 48),
    (2, 'Director Approval','admin',   'approved',    72)
) AS vals(step_no, step_name, role, action, sla)
WHERE t.template_code='WF_SANCTION_SMALL'
ON CONFLICT DO NOTHING;

-- Comment
COMMENT ON TABLE notesheets IS 'Digital file noting - replacement for paper file movement in PSU/government offices';
COMMENT ON COLUMN notesheet_notes.is_locked IS 'Notes are immutable once submitted - real file noting cannot be erased';
