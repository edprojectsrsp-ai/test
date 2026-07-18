-- =========================================================================
-- Telegram scheduled-report push subscriptions.
-- A chat subscribes (via the bot's /digest command, or admin insert) and the
-- AI service scheduler pushes a portfolio EVM + CAPEX digest at send_hour IST
-- daily (or Mondays only for cadence='weekly').
-- =========================================================================

CREATE TABLE IF NOT EXISTS tg_push_subscriptions (
    id           SERIAL PRIMARY KEY,
    chat_id      BIGINT NOT NULL,
    cadence      TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'weekly')),
    scheme_id    INTEGER,                      -- NULL = whole-portfolio digest
    send_hour    INTEGER NOT NULL DEFAULT 7 CHECK (send_hour BETWEEN 0 AND 23),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    last_sent_on DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- expression uniqueness (NULL scheme_id = portfolio counts as one slot)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tg_push_chat_scheme
    ON tg_push_subscriptions (chat_id, COALESCE(scheme_id, 0));

CREATE INDEX IF NOT EXISTS idx_tg_push_active ON tg_push_subscriptions(is_active) WHERE is_active;
