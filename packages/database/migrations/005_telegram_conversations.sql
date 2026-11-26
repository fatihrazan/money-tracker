CREATE TABLE telegram_conversations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL,
  state jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX telegram_conversations_expiry ON telegram_conversations(expires_at);
