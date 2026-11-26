import { pool } from '@money/database';
import { migrate } from './migrate';

async function main() {
  const url = new URL(process.env.DIRECT_DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname.endsWith('.neon.tech') ||
    url.hostname.includes('-pooler.')
  )
    throw new Error('Use the direct Neon URL in DIRECT_DATABASE_URL.');
  if (url.searchParams.get('sslmode') !== 'verify-full')
    throw new Error('Use sslmode=verify-full for verified Neon TLS.');
  process.env.DATABASE_URL = url.toString();
  await migrate();
}
main()
  .catch(() => {
    console.error(
      'Production migration failed. Check the direct Neon URL, verified TLS, and database permissions. Credentials were not printed.',
    );
    process.exitCode = 1;
  })
  .finally(() => pool().end());
