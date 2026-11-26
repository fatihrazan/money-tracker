import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { atomic, pool } from '@money/database';
import { MAX_AMOUNT } from '@money/core';
import { hashPassword } from '../apps/web/lib/password';
type Legacy = Record<
  'users' | 'accounts' | 'categories' | 'transactions',
  Record<string, unknown>[]
>;
export async function importSqlite(path: string, owner?: string, dryRun = false) {
  const { stdout } = await promisify(execFile)(
    process.env.PYTHON ?? 'python',
    [fileURLToPath(new URL('./export-sqlite.py', import.meta.url)), resolve(path)],
    { maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' },
  );
  const source = JSON.parse(stdout) as Legacy;
  const counts = Object.fromEntries(
    Object.entries(source).map(([table, rows]) => [table, rows.length]),
  );
  if (dryRun) {
    console.log('SQLite dapat dibaca. Jumlah baris:', counts);
    return;
  }
  if (!source.users.length) {
    if (
      !owner ||
      !/^[a-z0-9_.]{3,30}$/.test(owner) ||
      !process.env.MIGRATION_OWNER_PASSWORD ||
      process.env.MIGRATION_OWNER_PASSWORD.length < 8
    )
      throw new Error(
        'Database tanpa pengguna memerlukan --owner nama dan MIGRATION_OWNER_PASSWORD minimal 8 karakter.',
      );
    source.users.push({
      id: 1,
      username: owner,
      password_hash: await hashPassword(process.env.MIGRATION_OWNER_PASSWORD),
    });
  }
  const maps = Object.fromEntries(
    ['users', 'accounts', 'categories', 'transactions'].map((table) => [
      table,
      new Map<number, string>(),
    ]),
  ) as Record<keyof Legacy, Map<number, string>>;
  const first = Number(source.users[0].id);
  const uid = (r: Record<string, unknown>) => maps.users.get(Number(r.user_id ?? first));
  const numeric = (value: unknown) => {
    const n = Number(value ?? 0);
    if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_AMOUNT)
      throw new Error('Nominal lama tidak valid atau melebihi batas aman.');
    return n;
  };
  await atomic(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(68210451)');
    const occupied = (
      await client.query(
        'SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM accounts)+(SELECT count(*) FROM categories)+(SELECT count(*) FROM transactions) count',
      )
    ).rows[0];
    if (Number(occupied.count) !== 0)
      throw new Error('Target harus kosong. Impor dibatalkan agar data tidak ganda atau tertimpa.');
    for (const r of source.users) {
      const id = randomUUID();
      maps.users.set(Number(r.id), id);
      await client.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [
        id,
        r.username,
        r.password_hash,
      ]);
    }
    for (const r of source.accounts) {
      const id = randomUUID();
      maps.accounts.set(Number(r.id), id);
      await client.query(
        'INSERT INTO accounts(id,user_id,name,type,initial_balance,archived) VALUES($1,$2,$3,$4,$5,$6)',
        [id, uid(r), r.name, r.type, numeric(r.initial_balance), !!r.archived],
      );
    }
    for (const r of source.categories) {
      const id = randomUUID();
      maps.categories.set(Number(r.id), id);
      await client.query('INSERT INTO categories(id,user_id,name,kind) VALUES($1,$2,$3,$4)', [
        id,
        uid(r),
        r.name,
        r.kind,
      ]);
      if (r.budget != null && r.kind === 'expense')
        await client.query("INSERT INTO category_budgets VALUES($1,'1900-01-01',$2)", [
          id,
          numeric(r.budget),
        ]);
    }
    const expected = new Map<number, number>();
    for (const r of source.accounts) expected.set(Number(r.id), numeric(r.initial_balance));
    for (const r of source.transactions) {
      const id = randomUUID();
      maps.transactions.set(Number(r.id), id);
      const amount = numeric(r.amount);
      await client.query(
        'INSERT INTO transactions(id,user_id,kind,amount,account_id,to_account_id,category_id,note,date,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,now()))',
        [
          id,
          uid(r),
          r.kind,
          amount,
          maps.accounts.get(Number(r.account_id)),
          r.to_account_id == null ? null : maps.accounts.get(Number(r.to_account_id)),
          r.category_id == null ? null : maps.categories.get(Number(r.category_id)),
          r.note ?? '',
          r.date,
          r.created_at ? `${String(r.created_at).replace(' ', 'T')}+07:00` : null,
        ],
      );
      const a = Number(r.account_id);
      expected.set(
        a,
        (expected.get(a) ?? 0) +
          (['expense', 'transfer'].includes(String(r.kind)) ? -amount : amount),
      );
      if (r.kind === 'transfer') {
        const dest = Number(r.to_account_id);
        expected.set(dest, (expected.get(dest) ?? 0) + amount);
      }
    }
    for (const [oldId, balance] of expected) {
      const actual = (
        await client.query('SELECT balance FROM account_balances WHERE id=$1', [
          maps.accounts.get(oldId),
        ])
      ).rows[0];
      if (actual.balance !== balance)
        throw new Error('Verifikasi saldo gagal. Semua perubahan dibatalkan.');
    }
    console.log('Impor berhasil; saldo seluruh akun terverifikasi:', {
      ...counts,
      users: source.users.length,
    });
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2),
    path = args[0];
  const ownerIndex = args.indexOf('--owner');
  if (!path || path.startsWith('--')) {
    console.error('Gunakan npm run db:import -- instance/money.db [--dry-run] [--owner nama]');
    process.exitCode = 1;
  } else
    importSqlite(
      path,
      ownerIndex < 0 ? undefined : args[ownerIndex + 1],
      args.includes('--dry-run'),
    )
      .catch((e) => {
        console.error(
          e instanceof Error && !('code' in e)
            ? e.message
            : 'Impor gagal. Periksa skema, kepemilikan data, dan koneksi database.',
        );
        process.exitCode = 1;
      })
      .finally(() => (process.env.DATABASE_URL ? pool().end() : undefined));
}
