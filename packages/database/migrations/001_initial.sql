CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 50), type text NOT NULL CHECK(type IN ('bank','ewallet','cash')),
  initial_balance bigint NOT NULL DEFAULT 0 CHECK(abs(initial_balance) <= 9000000000000), archived boolean NOT NULL DEFAULT false,
  UNIQUE(user_id, name), UNIQUE(user_id, id)
);
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 50), kind text NOT NULL CHECK(kind IN ('expense','income')),
  budget bigint CHECK(budget > 0 AND budget <= 9000000000000),
  CHECK(kind = 'expense' OR budget IS NULL), UNIQUE(user_id,name,kind), UNIQUE(user_id,id)
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('expense','income','transfer','adjustment')),
  amount bigint NOT NULL CHECK(abs(amount) <= 18000000000000), account_id uuid NOT NULL,
  to_account_id uuid, category_id uuid, parent_transfer_id uuid,
  note text NOT NULL DEFAULT '' CHECK(length(note) <= 200), date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id),
  FOREIGN KEY(user_id,account_id) REFERENCES accounts(user_id,id),
  FOREIGN KEY(user_id,to_account_id) REFERENCES accounts(user_id,id),
  FOREIGN KEY(user_id,category_id) REFERENCES categories(user_id,id),
  FOREIGN KEY(user_id,parent_transfer_id) REFERENCES transactions(user_id,id) ON DELETE CASCADE,
  CHECK(kind = 'adjustment' OR amount > 0),
  CHECK((kind = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id AND category_id IS NULL)
     OR (kind IN ('expense','income') AND to_account_id IS NULL AND category_id IS NOT NULL)
     OR (kind = 'adjustment' AND to_account_id IS NULL AND category_id IS NULL)),
  CHECK(parent_transfer_id IS NULL OR kind = 'expense')
);
CREATE UNIQUE INDEX one_transfer_fee ON transactions(parent_transfer_id) WHERE parent_transfer_id IS NOT NULL;
CREATE INDEX transactions_user_date ON transactions(user_id,date DESC,created_at DESC);
CREATE INDEX transactions_account ON transactions(user_id,account_id);
CREATE INDEX transactions_destination ON transactions(user_id,to_account_id);
CREATE INDEX transactions_category ON transactions(user_id,category_id);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_limits (key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1, window_start timestamptz NOT NULL DEFAULT now());
CREATE VIEW account_balances AS
SELECT a.*, a.initial_balance + COALESCE((SELECT SUM(CASE
  WHEN t.kind='transfer' AND t.to_account_id=a.id THEN t.amount
  WHEN t.kind IN ('expense','transfer') THEN -t.amount ELSE t.amount END)
  FROM transactions t WHERE t.user_id=a.user_id AND (t.account_id=a.id OR t.to_account_id=a.id)),0)::bigint AS balance
FROM accounts a;
