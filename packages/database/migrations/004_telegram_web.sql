-- Retire the Android authorization flow; retain historical migration 003.
DROP TABLE mobile_login_codes;
ALTER TABLE google_oauth_states DROP COLUMN mobile_return_to;
CREATE TABLE telegram_links (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 telegram_id bigint NOT NULL UNIQUE, chat_id bigint NOT NULL UNIQUE,
 linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telegram_link_codes (
 code_hash text PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE telegram_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 telegram_id bigint NOT NULL, payload jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE telegram_updates (
 bot_id text NOT NULL, update_id bigint NOT NULL, reply jsonb NOT NULL,
 PRIMARY KEY(bot_id,update_id)
);
CREATE TABLE telegram_polling (bot_id text PRIMARY KEY, next_offset bigint NOT NULL DEFAULT 0);
