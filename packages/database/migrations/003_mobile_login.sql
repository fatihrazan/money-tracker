ALTER TABLE google_oauth_states ADD COLUMN mobile_return_to text;
CREATE TABLE mobile_login_codes (
  code_hash text PRIMARY KEY,
  challenge text NOT NULL CHECK(length(challenge)=43),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX mobile_login_codes_expiry ON mobile_login_codes(expires_at);
