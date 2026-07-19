-- =========================================================================
-- Matrix Engine M1 — Governance.
--   Snapshot approval workflow (draft → submitted → approved → locked)
--   Manual adjustments (§10): calculated value NEVER overwritten
--   Audit trail (§13): every significant mutation, old/new, who/when
-- Idempotent.
-- =========================================================================

ALTER TABLE rs_matrix_snapshots ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(100);
ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS approved_by  VARCHAR(100);
ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS locked_at    TIMESTAMPTZ;
ALTER TABLE rs_matrix_snapshots ADD COLUMN IF NOT EXISTS reject_reason TEXT;

CREATE TABLE IF NOT EXISTS rs_adjustments (
    adjustment_id  SERIAL PRIMARY KEY,
    snapshot_id    INTEGER NOT NULL REFERENCES rs_matrix_snapshots(snapshot_id) ON DELETE CASCADE,
    row_id         TEXT NOT NULL,
    column_key     TEXT NOT NULL,
    calculated     NUMERIC,                 -- value at time of adjustment (evidence)
    adjustment     NUMERIC NOT NULL,        -- signed delta; final = calculated + adjustment
    reason         TEXT NOT NULL,
    attachment_ref TEXT,
    adjusted_by    VARCHAR(100),
    status         TEXT NOT NULL DEFAULT 'proposed',   -- proposed|approved|rejected|reversed
    decided_by     VARCHAR(100),
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adj_snapshot ON rs_adjustments(snapshot_id);

CREATE TABLE IF NOT EXISTS rs_audit_log (
    audit_id   BIGSERIAL PRIMARY KEY,
    entity     TEXT NOT NULL,               -- rule|report|dataset|measure|snapshot|adjustment
    entity_key TEXT NOT NULL,
    action     TEXT NOT NULL,               -- create|update|delete|submit|approve|reject|lock|adjust|decide
    old_value  JSONB,
    new_value  JSONB,
    reason     TEXT,
    actor      VARCHAR(100),
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON rs_audit_log(entity, entity_key, at DESC);
