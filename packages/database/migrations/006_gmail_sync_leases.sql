-- Session advisory locks are incompatible with Neon transaction pooling.
CREATE TABLE gmail_sync_leases (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  last_started_at timestamptz NOT NULL DEFAULT now()
);
