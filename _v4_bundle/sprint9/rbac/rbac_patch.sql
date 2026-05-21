-- ============================================================================
-- RBAC PATCH v2 — matches actual v4 schema
-- Safe to run multiple times.
-- ============================================================================

-- 1. Add password tracking columns (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='users' AND column_name='password_hash') THEN
        ALTER TABLE users ADD COLUMN password_hash varchar(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='users' AND column_name='failed_login_attempts') THEN
        ALTER TABLE users ADD COLUMN failed_login_attempts int DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='users' AND column_name='last_login_at') THEN
        ALTER TABLE users ADD COLUMN last_login_at timestamp;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='users' AND column_name='password_changed_at') THEN
        ALTER TABLE users ADD COLUMN password_changed_at timestamp DEFAULT CURRENT_TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='users' AND column_name='is_locked') THEN
        ALTER TABLE users ADD COLUMN is_locked boolean DEFAULT FALSE;
    END IF;
END $$;

-- 2. Indexes for fast login
CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE is_active;

-- 3. Default admin user (CHANGE PASSWORD ON FIRST LOGIN)
--    Password: 'admin123' bcrypt-hashed
INSERT INTO users (username, full_name, email, role, password_hash, is_active)
VALUES (
    'admin', 'System Administrator', 'admin@projectbrain.local',
    'admin',
    '$2b$12$LQv3c1yqBwEHsXvVfXG/0eOI.gAdrk/.lP2dz6QmpYLAHEoStb31u',
    TRUE
) ON CONFLICT (username) DO UPDATE
    SET password_hash = EXCLUDED.password_hash WHERE users.password_hash IS NULL;

-- Sample users for each role (also admin123)
INSERT INTO users (username, full_name, email, role, password_hash, is_active, designation)
VALUES
    ('manager1', 'Sample Manager', 'manager@projectbrain.local', 'manager',
     '$2b$12$LQv3c1yqBwEHsXvVfXG/0eOI.gAdrk/.lP2dz6QmpYLAHEoStb31u', TRUE, 'GM Projects'),
    ('engineer1', 'Sample Engineer', 'eng@projectbrain.local', 'engineer',
     '$2b$12$LQv3c1yqBwEHsXvVfXG/0eOI.gAdrk/.lP2dz6QmpYLAHEoStb31u', TRUE, 'Project Engineer'),
    ('site1', 'Site Engineer', 'site@projectbrain.local', 'site_engineer',
     '$2b$12$LQv3c1yqBwEHsXvVfXG/0eOI.gAdrk/.lP2dz6QmpYLAHEoStb31u', TRUE, 'Site Engineer'),
    ('viewer1', 'Read-Only Viewer', 'viewer@projectbrain.local', 'viewer',
     '$2b$12$LQv3c1yqBwEHsXvVfXG/0eOI.gAdrk/.lP2dz6QmpYLAHEoStb31u', TRUE, 'External Auditor')
ON CONFLICT (username) DO NOTHING;

-- 4. Role permissions — match actual schema (module_key + bools)
-- Modules: scheme, package, progress, tender, capex, document, notesheet, cpm, ai, user, risk
INSERT INTO role_permissions(role, module_key, can_view, can_edit, can_approve, can_delete) VALUES
    -- admin: full access everywhere
    ('admin', 'scheme',    TRUE, TRUE, TRUE, TRUE),
    ('admin', 'package',   TRUE, TRUE, TRUE, TRUE),
    ('admin', 'progress',  TRUE, TRUE, TRUE, TRUE),
    ('admin', 'tender',    TRUE, TRUE, TRUE, TRUE),
    ('admin', 'capex',     TRUE, TRUE, TRUE, TRUE),
    ('admin', 'document',  TRUE, TRUE, TRUE, TRUE),
    ('admin', 'notesheet', TRUE, TRUE, TRUE, TRUE),
    ('admin', 'cpm',       TRUE, TRUE, TRUE, TRUE),
    ('admin', 'ai',        TRUE, TRUE, TRUE, TRUE),
    ('admin', 'user',      TRUE, TRUE, TRUE, TRUE),
    ('admin', 'risk',      TRUE, TRUE, TRUE, TRUE),

    -- manager: full read, write/approve most, can't delete
    ('manager', 'scheme',    TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'package',   TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'progress',  TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'tender',    TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'capex',     TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'document',  TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'notesheet', TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'cpm',       TRUE, TRUE,  TRUE,  FALSE),
    ('manager', 'ai',        TRUE, FALSE, FALSE, FALSE),
    ('manager', 'user',      TRUE, FALSE, FALSE, FALSE),
    ('manager', 'risk',      TRUE, TRUE,  FALSE, FALSE),

    -- engineer: read+edit package data, no approvals
    ('engineer', 'scheme',    TRUE, FALSE, FALSE, FALSE),
    ('engineer', 'package',   TRUE, TRUE,  FALSE, FALSE),
    ('engineer', 'progress',  TRUE, TRUE,  FALSE, FALSE),
    ('engineer', 'tender',    TRUE, FALSE, FALSE, FALSE),
    ('engineer', 'capex',     TRUE, FALSE, FALSE, FALSE),
    ('engineer', 'document',  TRUE, TRUE,  FALSE, FALSE),
    ('engineer', 'notesheet', TRUE, TRUE,  FALSE, FALSE),
    ('engineer', 'cpm',       TRUE, TRUE,  FALSE, FALSE),
    ('engineer', 'ai',        TRUE, FALSE, FALSE, FALSE),
    ('engineer', 'risk',      TRUE, FALSE, FALSE, FALSE),

    -- site_engineer: mobile diary submission, package read
    ('site_engineer', 'scheme',    TRUE, FALSE, FALSE, FALSE),
    ('site_engineer', 'package',   TRUE, FALSE, FALSE, FALSE),
    ('site_engineer', 'progress',  TRUE, TRUE,  FALSE, FALSE),
    ('site_engineer', 'document',  TRUE, TRUE,  FALSE, FALSE),
    ('site_engineer', 'notesheet', TRUE, FALSE, FALSE, FALSE),
    ('site_engineer', 'cpm',       TRUE, FALSE, FALSE, FALSE),
    ('site_engineer', 'ai',        TRUE, FALSE, FALSE, FALSE),

    -- viewer: read-only everywhere
    ('viewer', 'scheme',    TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'package',   TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'progress',  TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'tender',    TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'capex',     TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'document',  TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'notesheet', TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'cpm',       TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'ai',        TRUE, FALSE, FALSE, FALSE),
    ('viewer', 'risk',      TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, module_key) DO UPDATE
    SET can_view = EXCLUDED.can_view,
        can_edit = EXCLUDED.can_edit,
        can_approve = EXCLUDED.can_approve,
        can_delete = EXCLUDED.can_delete;

DO $$
DECLARE user_cnt INT; perm_cnt INT;
BEGIN
    SELECT COUNT(*) INTO user_cnt FROM users WHERE password_hash IS NOT NULL;
    SELECT COUNT(*) INTO perm_cnt FROM role_permissions;
    RAISE NOTICE 'RBAC patch complete: % users with passwords, % role permission rules', user_cnt, perm_cnt;
END $$;
