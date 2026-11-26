import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';
import pg from 'pg';
import { query, pool } from '@money/database';
import { today, budgetState } from '@money/core';
import { signup, login, sessionUser, deleteSession } from '../../apps/web/lib/auth';
import * as finance from '../../apps/web/lib/finance';
import { migrate } from '../../scripts/migrate';
import { importSqlite } from '../../scripts/import-sqlite';
import { GET, POST, PUT, PATCH, DELETE } from '../../apps/web/app/api/v1/[...path]/route';

test('PostgreSQL: financial lifecycle, isolation, sessions and concurrency', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL to a separate database whose name ends in _test.');
  assert.match(
    new URL(url).pathname,
    /_test$/,
    'Integration tests only run on an explicit _test database.',
  );
  process.env.DATABASE_URL = url;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const schema = `test_${Date.now()}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const testUrl = new URL(url);
  testUrl.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = testUrl.toString();
  t.after(async () => {
    await pool().end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate();
  await migrate();
  await t.test(
    'SQLite import preserves balances, budgets and old passwords, and refuses duplicate imports',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'money-migration-'));
      const path = join(directory, 'legacy.db');
      try {
        await promisify(execFile)(process.env.PYTHON ?? 'python', [
          fileURLToPath(new URL('./create_sqlite.py', import.meta.url)),
          path,
        ]);
        const before = await readFile(path);
        await importSqlite(path);
        const legacy = await login('legacy', 'legacy-password');
        const migrated = await finance.snapshot(legacy.user, '2026-10');
        assert.equal(migrated.total, 1030500);
        assert.equal(migrated.accounts.find((a) => a.name === 'BNI')!.balance, 899000);
        assert.equal(migrated.accounts.find((a) => a.name === 'GoPay')!.balance, 131500);
        assert.deepEqual(migrated.summary, { income: 0, expense: 19000 });
        assert.equal(migrated.categories.find((c) => c.name === 'Makan')!.budget, 200000);
        assert.deepEqual(await readFile(path), before);
        await assert.rejects(() => importSqlite(path));
        assert.equal((await finance.snapshot(legacy.user, '2026-10')).total, 1030500);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      // This connection is confined to the freshly created disposable test schema.
      await query('TRUNCATE transactions,accounts,categories,sessions,users,auth_limits CASCADE');
    },
  );
  const owner = await signup('owner', 'password123'),
    other = await signup('other', 'password123');
  const month = today().slice(0, 7),
    day = today();
  let data = await finance.snapshot(owner.user, month);
  const bni = data.accounts.find((a) => a.name === 'BNI')!,
    gopay = data.accounts.find((a) => a.name === 'GoPay')!;
  const expense = data.categories.find((c) => c.name === 'Belanja' && c.kind === 'expense')!,
    income = data.categories.find((c) => c.name === 'Gaji')!;
  const transfer = {
    kind: 'transfer',
    amount: '100rb',
    account_id: bni.id,
    to_account_id: gopay.id,
    date: day,
    fee: '1rb',
  };
  await t.test('income, transfer and fees affect the right totals', async () => {
    await finance.saveAccount(
      owner.user.id,
      { name: bni.name, type: bni.type, initial_balance: '1jt' },
      bni.id,
    );
    await finance.saveTransaction(owner.user.id, {
      kind: 'income',
      amount: '5jt',
      account_id: bni.id,
      category_id: income.id,
      date: day,
    });
    const key = crypto.randomUUID();
    const [tx, retry] = await Promise.all(
      [1, 2].map(() => finance.createManualTransaction(owner.user.id, transfer, key)),
    );
    assert.deepEqual(retry, tx);
    await assert.rejects(
      () => finance.createManualTransaction(owner.user.id, { ...transfer, fee: 0 }, key),
      /isi berbeda/,
    );
    data = await finance.snapshot(owner.user, month);
    assert.equal(data.accounts.find((a) => a.id === bni.id)!.balance, 5899000);
    assert.equal(data.accounts.find((a) => a.id === gopay.id)!.balance, 100000);
    assert.equal(data.summary.expense, 1000);
    assert.equal(data.summary.income, 5000000);
    await finance.saveTransaction(
      owner.user.id,
      { ...transfer, amount: '200rb', fee: '2rb' },
      tx.id,
    );
    data = await finance.snapshot(owner.user, month);
    assert.equal(data.summary.expense, 2000);
    assert.equal(data.transactions.filter((x) => x.parent_transfer_id === tx.id).length, 1);
    await assert.rejects(
      () =>
        finance.deleteTransaction(
          owner.user.id,
          data.transactions.find((x) => x.parent_transfer_id === tx.id)!.id,
        ),
      /transfer asal/,
    );
    await finance.deleteTransaction(owner.user.id, tx.id);
    data = await finance.snapshot(owner.user, month);
    assert.equal(data.summary.expense, 0);
    assert.equal(data.total, 6000000);
  });
  await t.test(
    'ownership validation and database constraints both prevent cross-user access',
    async () => {
      await assert.rejects(() => finance.saveTransaction(other.user.id, transfer));
      await assert.rejects(() =>
        finance.saveAccount(
          other.user.id,
          { name: 'stolen', type: 'bank', initial_balance: 0 },
          bni.id,
        ),
      );
      const foreign = (await finance.snapshot(other.user, month)).accounts[0];
      await assert.rejects(
        () =>
          query(
            "INSERT INTO transactions(user_id,kind,amount,account_id,category_id,date) VALUES($1,'expense',10,$2,$3,$4)",
            [owner.user.id, foreign.id, expense.id, day],
          ),
        (e: unknown) => (e as { code: string }).code === '23503',
      );
      assert.equal((await finance.snapshot(other.user, month)).total, 0);
    },
  );
  await t.test('budgets warn, validate atomically, and exclude other months', async () => {
    await finance.saveBudgets(owner.user.id, [{ id: expense.id, budget: '100rb' }]);
    const result = await finance.saveTransaction(owner.user.id, {
      kind: 'expense',
      amount: '85rb',
      account_id: bni.id,
      category_id: expense.id,
      date: day,
      note: 'Sabun',
    });
    assert.equal(result.warnings.length, 1);
    await finance.saveTransaction(owner.user.id, {
      kind: 'expense',
      amount: '50rb',
      account_id: bni.id,
      category_id: expense.id,
      date: '2000-01-01',
    });
    assert.equal(
      (await finance.snapshot(owner.user, month)).categories.find((c) => c.id === expense.id)!
        .spent,
      85000,
    );
    await assert.rejects(() =>
      finance.saveBudgets(owner.user.id, [
        { id: expense.id, budget: '200rb' },
        { id: other.user.id, budget: '50rb' },
      ]),
    );
    assert.equal(
      (await finance.snapshot(owner.user, month)).categories.find((c) => c.id === expense.id)!
        .budget,
      100000,
    );
    await assert.rejects(() => finance.deleteCategory(owner.user.id, expense.id));
  });
  await t.test('reconciliation is excluded from monthly income and expenses', async () => {
    const before = await finance.snapshot(owner.user, month);
    await finance.reconcile(owner.user.id, gopay.id, { actual: '50rb' });
    const after = await finance.snapshot(owner.user, month);
    assert.deepEqual(after.summary, before.summary);
    assert.equal(after.accounts.find((a) => a.id === gopay.id)!.balance, 50000);
    await assert.rejects(() => finance.archiveAccount(owner.user.id, gopay.id, true));
    await finance.reconcile(owner.user.id, gopay.id, { actual: 0 });
    await finance.archiveAccount(owner.user.id, gopay.id, true);
    await finance.archiveAccount(owner.user.id, gopay.id, true);
    await assert.rejects(() => finance.saveTransaction(owner.user.id, transfer));
    const archivedAdjustment = (await finance.snapshot(owner.user, month)).transactions.find(
      (tx) => tx.account_id === gopay.id && tx.kind === 'adjustment',
    )!;
    await assert.rejects(() => finance.deleteTransaction(owner.user.id, archivedAdjustment.id));
    await assert.rejects(() =>
      finance.saveAccount(
        owner.user.id,
        {
          name: gopay.name,
          type: gopay.type,
          initial_balance: 1,
        },
        gopay.id,
      ),
    );
    await finance.archiveAccount(owner.user.id, gopay.id, false);
    await finance.archiveAccount(owner.user.id, gopay.id, false);
  });
  await t.test(
    'custom category budgets track each month across accounts, edits and removal',
    async () => {
      const { user } = await signup('budgeter', 'password123');
      const initial = await finance.snapshot(user, '2026-12');
      const [first, second] = initial.accounts;
      const category = await finance.saveCategory(
        user.id,
        {
          name: 'Hobi',
          kind: 'expense',
          budget: '500rb',
        },
        '2026-11',
      );
      const another = await finance.saveCategory(
        user.id,
        {
          name: 'Perawatan',
          kind: 'expense',
          budget: '100rb',
        },
        '2026-11',
      );
      const expenseBody = {
        kind: 'expense',
        amount: '100rb',
        account_id: first.id,
        category_id: category.id,
        date: '2026-12-01',
      };
      const tx = await finance.saveTransaction(user.id, expenseBody);
      await finance.saveTransaction(user.id, {
        ...expenseBody,
        amount: '50rb',
        account_id: second.id,
        date: '2026-12-31',
      });
      await finance.saveTransaction(user.id, {
        ...expenseBody,
        amount: '20rb',
        date: '2026-11-30',
      });
      await finance.saveTransaction(user.id, {
        ...expenseBody,
        amount: '30rb',
        date: '2027-01-01',
      });
      await finance.saveTransaction(user.id, {
        ...expenseBody,
        amount: '10rb',
        category_id: another.id,
      });
      const getCategory = async (selectedMonth: string, account?: string) =>
        (await finance.snapshot(user, selectedMonth, account)).categories.find(
          (c) => c.id === category.id,
        )!;
      const december = await getCategory('2026-12');
      assert.equal(december.budget, 500000);
      assert.equal(december.spent, 150000);
      assert.equal(budgetState(december.budget!, december.spent).left, 350000);
      assert.equal((await getCategory('2026-12', first.id)).spent, 150000);
      assert.equal((await getCategory('2026-11')).spent, 20000);
      assert.equal((await getCategory('2027-01')).spent, 30000);
      assert.equal((await getCategory('2027-02')).spent, 0);
      assert.equal((await getCategory('2027-02')).budget, 500000);
      const ranged = await finance.snapshot(user, '2026-12', undefined, {
        start: '2026-11-30',
        end: '2026-12-01',
      });
      assert.equal(ranged.categories.find((c) => c.id === category.id)!.spent, 120000);
      assert.equal(ranged.summary.expense, 130000);
      assert.equal(ranged.transactions.length, 3);
      const yearBoundary = await finance.snapshot(user, '2026-12', undefined, {
        start: '2026-12-31',
        end: '2027-01-01',
      });
      assert.equal(yearBoundary.categories.find((c) => c.id === category.id)!.spent, 80000);
      await assert.rejects(() =>
        finance.snapshot(user, '2026-12', undefined, {
          start: '2026-12-31',
          end: '2026-12-01',
        }),
      );
      await assert.rejects(() =>
        finance.saveBudgets(other.user.id, [{ id: category.id, budget: '1jt' }]),
      );
      await assert.rejects(() =>
        finance.saveBudgets(user.id, [
          { id: initial.categories.find((c) => c.kind === 'income')!.id, budget: '1jt' },
        ]),
      );
      await finance.saveTransaction(user.id, { ...expenseBody, amount: '500rb' }, tx.id);
      assert.equal(budgetState(500000, (await getCategory('2026-12')).spent).left, -50000);
      await finance.saveTransaction(user.id, { ...expenseBody, date: '2027-01-15' }, tx.id);
      assert.equal((await getCategory('2026-12')).spent, 50000);
      assert.equal((await getCategory('2027-01')).spent, 130000);
      await finance.deleteTransaction(user.id, tx.id);
      assert.equal((await getCategory('2027-01')).spent, 30000);
      await finance.saveBudgets(user.id, [{ id: category.id, budget: '200rb' }], '2026-12');
      assert.equal((await getCategory('2026-11')).budget, 500000);
      assert.equal((await getCategory('2026-12')).budget, 200000);
      assert.equal((await getCategory('2027-01')).budget, 200000);
      await finance.saveBudgets(user.id, [{ id: category.id, budget: null }], '2026-12');
      assert.equal((await getCategory('2026-12')).budget, null);
      assert.equal((await getCategory('2026-12')).spent, 50000);
      assert.equal(
        (await finance.snapshot(user, '2026-12')).categories.find((c) => c.id === another.id)!
          .budget,
        100000,
      );
    },
  );
  await t.test('concurrent reconciliation and expense produce a consistent balance', async () => {
    await Promise.all([
      finance.reconcile(owner.user.id, gopay.id, { actual: '100rb' }),
      finance.saveTransaction(owner.user.id, {
        kind: 'expense',
        amount: '10rb',
        account_id: gopay.id,
        category_id: expense.id,
        date: day,
      }),
    ]);
    const balance = (await finance.snapshot(owner.user, month)).accounts.find(
      (a) => a.id === gopay.id,
    )!.balance;
    assert.ok(balance === 90000 || balance === 100000);
  });
  await t.test('invalid category rolls back the entire transfer mutation', async () => {
    const before = (await finance.snapshot(owner.user, month)).total;
    await assert.rejects(() =>
      finance.saveTransaction(owner.user.id, {
        kind: 'income',
        amount: '20rb',
        account_id: bni.id,
        category_id: expense.id,
        date: day,
      }),
    );
    assert.equal((await finance.snapshot(owner.user, month)).total, before);
  });
  await t.test(
    'recent activity spans months and quick fills match notes without case sensitivity',
    async () => {
      const repeat = {
        kind: 'expense',
        amount: '18rb',
        account_id: bni.id,
        category_id: expense.id,
        date: day,
      };
      await finance.saveTransaction(owner.user.id, { ...repeat, note: 'Kopi' });
      await finance.saveTransaction(owner.user.id, { ...repeat, note: 'kopi' });
      const current = await finance.snapshot(owner.user, month);
      assert.equal(current.quick_fills.filter((q) => q.note.toLowerCase() === 'kopi').length, 1);
      const quiet = await finance.snapshot(owner.user, '1999-01');
      assert.equal(quiet.transactions.length, 0);
      assert.ok(quiet.recent.length > 0);
      assert.equal(quiet.needs_setup, false);
      assert.equal(quiet.last_expense?.account_id, bni.id);
    },
  );
  await t.test('login creates revocable sessions and does not expose password hashes', async () => {
    const authenticated = await login('owner', 'password123');
    assert.deepEqual(await sessionUser(authenticated.token), owner.user);
    assert.equal('password_hash' in authenticated.user, false);
    await deleteSession(authenticated.token);
    assert.equal(await sessionUser(authenticated.token), null);
    await assert.rejects(() => login('owner', 'wrong-password'));
  });
  await t.test(
    'cursor pages preserve ties, search and account scoping without loading history in accounts',
    async () => {
      const { user } = await signup('pages', 'password123');
      const initial = await finance.snapshot(user, month);
      const [account, second] = initial.accounts;
      const category = initial.categories.find((c) => c.kind === 'expense')!;
      await query(
        `INSERT INTO transactions(user_id,kind,amount,account_id,category_id,note,date)
      SELECT $1,'expense',i,CASE WHEN i=102 THEN $5::uuid ELSE $2::uuid END,$3,CASE WHEN i=101 THEN 'Cari ini' ELSE 'Kopi' END,$4
      FROM generate_series(1,102) i`,
        [user.id, account.id, category.id, day, second.id],
      );
      const page = (cursor?: string, q?: string) =>
        finance.transactionPage(user.id, day, '9999-01-01', account.id, cursor, q);
      const a = await page(),
        b = await page(a.next_cursor!),
        c = await page(b.next_cursor!);
      assert.deepEqual(
        [a.transactions.length, b.transactions.length, c.transactions.length, c.next_cursor],
        [50, 50, 1, null],
      );
      assert.equal(
        new Set([...a.transactions, ...b.transactions, ...c.transactions].map((tx) => tx.id)).size,
        101,
      );
      assert.equal((await page(undefined, 'cari')).transactions.length, 1);
      const scoped = await finance.snapshot(user, month, undefined, undefined, 'accounts');
      assert.equal(scoped.transactions.length, 0);
      assert.equal(scoped.accounts.find((a) => a.id === account.id)?.balance, -5151);
    },
  );
  await t.test(
    'HTTP contract supports cookie and bearer sessions, origin checks, errors and revocation',
    async () => {
      const request = (
        path: string,
        method = 'GET',
        body?: unknown,
        headers: Record<string, string> = {},
      ) =>
        new NextRequest(`http://localhost:3000/api/v1/${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
      const denied = await GET(request('snapshot'), context('snapshot'));
      assert.equal(denied.status, 401);
      const cross = await POST(
        request(
          'auth/login',
          'POST',
          { username: 'owner', password: 'password123' },
          { origin: 'https://foreign.example' },
        ),
        context('auth/login'),
      );
      assert.equal(cross.status, 403);
      const signed = await POST(
        request(
          'auth/login',
          'POST',
          { username: 'owner', password: 'password123' },
          { origin: 'http://localhost:3000' },
        ),
        context('auth/login'),
      );
      assert.equal(signed.status, 200);
      assert.match(signed.headers.get('set-cookie')!, /HttpOnly/i);
      const cookie = signed.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await signed.json()).data.token, undefined);
      const cookieSnapshot = await GET(
        request('snapshot', 'GET', undefined, { cookie }),
        context('snapshot'),
      );
      assert.equal(cookieSnapshot.status, 200);
      assert.equal(cookieSnapshot.headers.get('cache-control'), 'no-store');
      const createdCategory = await POST(
        request(
          'categories',
          'POST',
          { name: 'Langganan', kind: 'expense', budget: '150rb' },
          { cookie },
        ),
        context('categories'),
      );
      assert.equal(createdCategory.status, 200);
      const budgetCategory = (await createdCategory.json()).data.id;
      const updatedBudget = await PUT(
        request('budgets', 'PUT', [{ id: budgetCategory, budget: '250rb' }], { cookie }),
        context('budgets'),
      );
      assert.equal(updatedBudget.status, 200);
      const refreshed = await GET(
        request('snapshot', 'GET', undefined, { cookie }),
        context('snapshot'),
      );
      assert.equal(
        (await refreshed.json()).data.categories.find(
          (c: { id: string }) => c.id === budgetCategory,
        ).budget,
        250000,
      );
      const invalidBudget = await PUT(
        request('budgets', 'PUT', [{ id: budgetCategory, budget: 0 }], { cookie }),
        context('budgets'),
      );
      assert.equal(invalidBudget.status, 400);
      const bearerLogin = await POST(
        request(
          'auth/login',
          'POST',
          { username: 'owner', password: 'password123' },
          { 'x-auth-mode': 'bearer' },
        ),
        context('auth/login'),
      );
      const { token } = (await bearerLogin.json()).data;
      assert.equal(bearerLogin.headers.get('set-cookie'), null);
      const bearer = { authorization: `Bearer ${token}` };
      assert.equal(
        (await GET(request('auth/me', 'GET', undefined, bearer), context('auth/me'))).status,
        200,
      );
      const invalid = await POST(
        request('transactions', 'POST', { amount: 'bad' }, bearer),
        context('transactions'),
      );
      assert.equal(invalid.status, 400);
      const wrongOwner = await DELETE(
        request(`accounts/${bni.id}`, 'DELETE', {}, bearer),
        context(`accounts/${bni.id}`),
      );
      assert.equal(wrongOwner.status, 404);
      const absentId = 'bb3f83cb-1156-4c6b-9472-543bc0b81cda';
      assert.equal(
        (
          await PATCH(
            request(`accounts/${absentId}`, 'PATCH', { name: 'Missing', type: 'bank' }, bearer),
            context(`accounts/${absentId}`),
          )
        ).status,
        404,
      );
      assert.equal(
        (await POST(request('auth/logout', 'POST', {}, bearer), context('auth/logout'))).status,
        200,
      );
      assert.equal(
        (await GET(request('auth/me', 'GET', undefined, bearer), context('auth/me'))).status,
        401,
      );
    },
  );
});
