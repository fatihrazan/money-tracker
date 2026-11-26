import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount,
  rupiah,
  shiftMonth,
  dateSchema,
  dateRangeSchema,
  transactionSchema,
  budgetState,
  categorySchema,
  budgetsSchema,
  MAX_AMOUNT,
  today,
} from '@money/core';
import { hashPassword, verifyPassword } from '../apps/web/lib/password';
import { scryptSync, pbkdf2Sync } from 'node:crypto';

test('budget date ranges validate real dates and allow inclusive single-day periods', () => {
  assert.deepEqual(dateRangeSchema.parse({ start: '2026-10-23', end: '2026-11-23' }), {
    start: '2026-10-23',
    end: '2026-11-23',
  });
  assert.ok(dateRangeSchema.safeParse({ start: '2026-10-23', end: '2026-10-23' }).success);
  for (const range of [
    { start: '2026-11-23', end: '2026-10-23' },
    { start: '2026-02-30', end: '2026-03-23' },
    { start: '2026-10-23' },
    { end: '2026-11-23' },
  ])
    assert.equal(dateRangeSchema.safeParse(range).success, false);
});

for (const [input, expected] of [
  ['25000', 25000],
  ['25.000', 25000],
  ['25,000', 25000],
  ['Rp 18.500', 18500],
  ['25rb', 25000],
  ['25 ribu', 25000],
  ['25k', 25000],
  ['1,5jt', 1500000],
  ['1.5 juta', 1500000],
  ['1,25rb', 1250],
  ['-50rb', -50000],
  ['0', 0],
  ['1.001rb', 1001],
] as const) {
  test(`parses ${input}`, () => assert.equal(parseAmount(input), expected));
}
for (const input of [
  '',
  'abc',
  '1.5',
  '25.00',
  '1.2.3rb',
  '1,2345rb',
  '1.000,000',
  '999999999999999999999999999999999999jt',
]) {
  test(`rejects ${input}`, () => assert.throws(() => parseAmount(input)));
}
test('rejects fractional or unsafe numerical amounts', () => {
  assert.throws(() => parseAmount(0.5));
  assert.throws(() => parseAmount(MAX_AMOUNT + 1));
});
test('Indonesian formatting and month boundaries', () => {
  assert.equal(rupiah(-25000), '-Rp25.000');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});
test('rejects impossible dates', () => {
  assert.equal(dateSchema.safeParse('2026-02-30').success, false);
  assert.equal(dateSchema.safeParse('2024-02-29').success, true);
});
test('transfer must have a different destination', () => {
  assert.equal(
    transactionSchema.safeParse({
      kind: 'transfer',
      amount: '25rb',
      account_id: 'e404bad9-53c9-44ed-afd5-c3d861350e67',
      to_account_id: 'e404bad9-53c9-44ed-afd5-c3d861350e67',
      date: '2026-10-30',
    }).success,
    false,
  );
});
test('budget states include exact limit and overspend', () => {
  assert.equal(budgetState(100, 79).state, 'ok');
  assert.equal(budgetState(100, 80).state, 'warn');
  assert.equal(budgetState(100, 100).state, 'warn');
  assert.equal(budgetState(100, 101).state, 'over');
  assert.equal(budgetState(100, 0).left, 100);
  assert.equal(budgetState(100, 100).left, 0);
  assert.equal(budgetState(100, 125).left, -25);
});

test('category budgets are optional, positive Rupiah amounts and expense-only', () => {
  assert.equal(categorySchema.parse({ name: 'Kopi', kind: 'expense' }).budget, null);
  assert.equal(
    categorySchema.parse({ name: 'Kopi', kind: 'expense', budget: '1,5jt' }).budget,
    1500000,
  );
  assert.equal(
    categorySchema.safeParse({ name: 'Bonus', kind: 'income', budget: 100 }).success,
    false,
  );
  for (const budget of [0, -100, 'abc', 0.5, MAX_AMOUNT + 1]) {
    assert.equal(
      categorySchema.safeParse({ name: 'Kopi', kind: 'expense', budget }).success,
      false,
    );
    assert.equal(
      budgetsSchema.safeParse([{ id: 'e404bad9-53c9-44ed-afd5-c3d861350e67', budget }]).success,
      false,
    );
  }
  assert.equal(
    budgetsSchema.parse([{ id: 'e404bad9-53c9-44ed-afd5-c3d861350e67', budget: null }])[0].budget,
    null,
  );
});
test('new and imported Werkzeug passwords remain compatible', async () => {
  const password = 'test-password-123';
  const hash = await hashPassword(password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  const scrypt = `scrypt:32768:8:1$salt123$${scryptSync(password, 'salt123', 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
  const pbkdf = `pbkdf2:sha256:600000$salt123$${pbkdf2Sync(password, 'salt123', 600000, 32, 'sha256').toString('hex')}`;
  assert.equal(await verifyPassword(password, scrypt), true);
  assert.equal(await verifyPassword(password, pbkdf), true);
  assert.equal(await verifyPassword(password, 'garbled'), false);
});
