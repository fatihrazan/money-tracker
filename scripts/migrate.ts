import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomic, pool } from '@money/database';
export async function migrate() {
  await atomic(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(68210451)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const directory = new URL('../packages/database/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
        continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .catch(() => {
      console.error('Migrasi gagal. Periksa koneksi DATABASE_URL dan skema PostgreSQL.');
      process.exitCode = 1;
    })
    .finally(() => pool().end());
}
