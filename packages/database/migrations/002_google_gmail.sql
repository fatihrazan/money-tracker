ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE transactions ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','gmail'));

CREATE TABLE google_identities (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL UNIQUE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, subject)
);
CREATE TABLE google_oauth_states (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('login', 'link', 'gmail')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  session_hash text,
  expires_at timestamptz NOT NULL,
  CHECK((purpose='login' AND user_id IS NULL AND session_hash IS NULL)
    OR (purpose<>'login' AND user_id IS NOT NULL AND session_hash IS NOT NULL))
);
CREATE TABLE gmail_connections (
  user_id uuid PRIMARY KEY,
  subject text NOT NULL,
  refresh_token_encrypted text,
  enabled boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  sync_from timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  scan_query text,
  scan_until timestamptz,
  page_token text,
  last_error text,
  FOREIGN KEY(user_id, subject) REFERENCES google_identities(user_id, subject) ON DELETE CASCADE
);
CREATE TABLE gmail_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  sender text NOT NULL,
  subject_contains text NOT NULL CHECK(length(subject_contains) BETWEEN 1 AND 160),
  body_contains text NOT NULL DEFAULT '' CHECK(length(body_contains)<=160),
  kind text NOT NULL CHECK(kind IN ('expense','income','transfer')),
  account_id uuid NOT NULL,
  to_account_id uuid,
  category_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,account_id) REFERENCES accounts(user_id,id),
  FOREIGN KEY(user_id,to_account_id) REFERENCES accounts(user_id,id),
  FOREIGN KEY(user_id,category_id) REFERENCES categories(user_id,id),
  CHECK((kind='transfer' AND to_account_id IS NOT NULL AND account_id<>to_account_id AND category_id IS NULL)
    OR (kind<>'transfer' AND to_account_id IS NULL AND category_id IS NOT NULL))
);
CREATE TABLE gmail_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_subject text NOT NULL,
  message_id text NOT NULL,
  rule_id uuid,
  transaction_id uuid,
  event_key text,
  status text NOT NULL CHECK(status IN ('imported','skipped','duplicate')),
  reason text NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,google_subject,message_id),
  FOREIGN KEY(user_id,rule_id) REFERENCES gmail_rules(user_id,id),
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX gmail_import_event ON gmail_imports(user_id,event_key) WHERE event_key IS NOT NULL;
CREATE INDEX gmail_import_recent ON gmail_imports(user_id,created_at DESC);
CREATE TABLE background_jobs (
  name text PRIMARY KEY,
  last_heartbeat timestamptz NOT NULL DEFAULT now()
);
