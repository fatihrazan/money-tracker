import pg, { type PoolClient, type QueryResultRow } from 'pg';
export { type PoolClient } from 'pg';
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Nilai saldo melampaui batas bilangan aman.');
  return n;
});
pg.types.setTypeParser(1082, (value) => value);
const globalDb = globalThis as unknown as { moneyPool?: pg.Pool };
export function pool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum dikonfigurasi.');
  return (globalDb.moneyPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 10000,
  }));
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  return (await pool().query<T>(sql, params)).rows;
}
export async function atomic<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='20s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function lockAccounts(client: PoolClient, userId: string) {
  await client.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id FOR UPDATE', [userId]);
}
