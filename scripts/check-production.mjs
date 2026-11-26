import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../.env.production', import.meta.url));
if (existsSync(path)) process.loadEnvFile(path);
const problems = [];
for (const key of [
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'APP_ORIGIN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_WEBHOOK_SECRET',
]) {
  if (!process.env[key]) problems.push(`${key}: belum diisi`);
}
for (const key of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
  if (!process.env[key]) continue;
  try {
    const url = new URL(process.env[key]);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname.endsWith('.neon.tech') ||
      url.searchParams.get('sslmode') !== 'verify-full'
    )
      problems.push(`${key}: gunakan URL Neon dengan sslmode=verify-full`);
    if (key === 'DIRECT_DATABASE_URL' && url.hostname.includes('-pooler.'))
      problems.push('DIRECT_DATABASE_URL: gunakan koneksi langsung tanpa -pooler');
  } catch {
    problems.push(`${key}: URL tidak valid`);
  }
}
if (process.env.APP_ORIGIN) {
  try {
    const url = new URL(process.env.APP_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== process.env.APP_ORIGIN)
      problems.push('APP_ORIGIN: gunakan origin HTTPS tanpa path atau trailing slash');
  } catch {
    problems.push('APP_ORIGIN: URL tidak valid');
  }
}
if (process.env.TELEGRAM_TRANSPORT !== 'webhook')
  problems.push('TELEGRAM_TRANSPORT: harus webhook');
if (!/^[A-Za-z0-9_-]{32,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET ?? ''))
  problems.push('TELEGRAM_WEBHOOK_SECRET: perlu 32-256 karakter acak');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Konfigurasi produksi lengkap. Selanjutnya migrasi Neon, atur environment Netlify, deploy, lalu daftarkan webhook.',
  );
