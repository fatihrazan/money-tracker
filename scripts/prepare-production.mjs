import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env.production', import.meta.url));
if (existsSync(target)) {
  console.log('.env.production already exists; no values changed.');
} else {
  const local = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(local)) process.loadEnvFile(local);
  const keep = (key) => JSON.stringify(process.env[key] ?? '');
  const lines = [
    '# Private production configuration. Never commit or share this file.',
    '# Fill both Neon URLs from Connect. Use sslmode=verify-full and keep channel_binding=require when provided.',
    'DATABASE_URL=',
    'DIRECT_DATABASE_URL=',
    '# Netlify production URL, without trailing slash.',
    'APP_ORIGIN=',
    'COOKIE_SECURE=true',
    'APP_TIMEZONE=Asia/Jakarta',
    'PG_POOL_MAX=3',
    'TELEGRAM_TRANSPORT=webhook',
    'TELEGRAM_ENABLED=false',
    `TELEGRAM_BOT_TOKEN=${keep('TELEGRAM_BOT_TOKEN')}`,
    `TELEGRAM_BOT_USERNAME=${keep('TELEGRAM_BOT_USERNAME')}`,
    `TELEGRAM_WEBHOOK_SECRET=${randomBytes(32).toString('hex')}`,
    'GMAIL_SYNC_ENABLED=false',
    'GMAIL_SCHEDULE_ENABLED=true',
    `GOOGLE_CLIENT_ID=${keep('GOOGLE_CLIENT_ID')}`,
    `GOOGLE_CLIENT_SECRET=${keep('GOOGLE_CLIENT_SECRET')}`,
    `GMAIL_TOKEN_KEY=${process.env.GMAIL_TOKEN_KEY ? keep('GMAIL_TOKEN_KEY') : randomBytes(32).toString('base64')}`,
    '',
  ];
  writeFileSync(target, lines.join('\n'), { flag: 'wx', mode: 0o600 });
  console.log(
    'Created private .env.production with fresh webhook/encryption secrets. Local .env is unchanged.',
  );
  console.log(
    'Fill DATABASE_URL, DIRECT_DATABASE_URL and APP_ORIGIN after creating Neon/Netlify accounts.',
  );
}
