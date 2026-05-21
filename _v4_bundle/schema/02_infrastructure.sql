-- ============================================================================
-- 02 INFRASTRUCTURE — users, RBAC, audit, masters
-- ============================================================================
BEGIN;

CREATE TABLE schema_migrations (
    version VARCHAR(20) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_by VARCHAR(100) NOT NULL DEFAULT current_user);
INSERT INTO schema_migrations(version,description) VALUES ('v4.0.0','Final form with AI/RAG');

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(200) UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    designation VARCHAR(200),
    department VARCHAR(200),
    phone VARCHAR(50),
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    telegram_user_id BIGINT UNIQUE,   -- for Telegram bot in sprint 8d
    extra_fields JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_valid CHECK (role IN ('admin','manager','engineer','viewer','site_engineer')));
CREATE INDEX idx_users_role ON users(role) WHERE is_active=TRUE;
CREATE INDEX idx_users_telegram ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE role_permissions (
    role_perm_id SERIAL PRIMARY KEY,
    role VARCHAR(50) NOT NULL,
    module_key VARCHAR(100) NOT NULL,
    can_view BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(role, module_key));

CREATE TABLE user_scheme_access (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    scheme_id INTEGER NOT NULL,
    access_level VARCHAR(20) NOT NULL DEFAULT 'view',
    granted_by INTEGER REFERENCES users(user_id),
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, scheme_id),
    CONSTRAINT user_scheme_access_level_valid CHECK (access_level IN ('view','edit','approve','admin')));

CREATE TABLE audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    row_id INTEGER NOT NULL,
    action audit_action_enum NOT NULL,
    actor_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload_before JSONB,
    payload_after JSONB,
    notes TEXT);
CREATE INDEX idx_audit_log_table_row ON audit_log(table_name,row_id,occurred_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id,occurred_at DESC);
CREATE INDEX idx_audit_log_occurred ON audit_log(occurred_at DESC);

CREATE TABLE custom_field_definitions (
    field_def_id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    field_key VARCHAR(100) NOT NULL,
    field_label VARCHAR(200) NOT NULL,
    field_type VARCHAR(30) NOT NULL,
    options JSONB,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, field_key),
    CONSTRAINT cfd_type_valid CHECK (field_type IN
        ('text','number','date','select','multiselect','boolean','json','currency','percent')));

CREATE TABLE uom_master (
    uom_id SERIAL PRIMARY KEY,
    uom_code VARCHAR(20) UNIQUE NOT NULL,
    uom_name VARCHAR(100) NOT NULL,
    uom_category VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE);

CREATE TABLE activity_master_global (
    activity_master_id SERIAL PRIMARY KEY,
    activity_name VARCHAR(255) UNIQUE NOT NULL,
    activity_category VARCHAR(100),
    default_uom_id INTEGER REFERENCES uom_master(uom_id),
    default_weightage NUMERIC(5,2) DEFAULT 10.00,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE scheme_tags (
    tag_id SERIAL PRIMARY KEY,
    tag_name VARCHAR(100) UNIQUE NOT NULL,
    tag_color VARCHAR(20),
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO scheme_tags(tag_name,tag_color) VALUES
    ('critical','#dc2626'),('budget-overrun','#ea580c'),('high-priority','#f59e0b'),
    ('ministry-watch','#7c3aed'),('strategic','#2563eb'),('expansion','#059669'),
    ('modernisation','#0891b2'),('safety-critical','#be123c');

COMMIT;
