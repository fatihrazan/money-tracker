import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../../apps/web/app/api/v1/[...path]/route';
import { POST as webhook } from '../../apps/web/app/api/telegram/webhook/route';
import { pool, query } from '@money/database';
import { today } from '@money/core';
import { migrate } from '../../scripts/migrate';
import { signup } from '../../apps/web/lib/auth';
import { snapshot } from '../../apps/web/lib/finance';
import {
  createTelegramLink,
  disconnectTelegram,
  handleTelegramUpdate,
  telegramStatus,
} from '../../apps/web/lib/telegram';

test('Telegram pairing, review, idempotency, isolation, fees, expiry and disconnect', async (t) => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(url);
  assert.match(new URL(url).pathname, /_test$/);
  process.env.TELEGRAM_BOT_TOKEN = '123456:fake-token';
  process.env.TELEGRAM_BOT_USERNAME = 'money_test_bot';
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const schema = `telegram_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = scoped.toString();
  t.after(async () => {
    await pool().end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate();
  await migrate();
  const owner = await signup('telegramowner', 'password123');
  const other = await signup('telegramother', 'password123');
  const api = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token?: string,
    origin = 'http://localhost:3000',
  ) => {
    const request = new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin,
        ...(token ? { cookie: `money_session=${token}` } : {}),
      },
      ...(method !== 'GET' ? { body: '{}' } : {}),
    });
    return { GET, POST, DELETE }[method](request, {
      params: Promise.resolve({ path: path.split('/') }),
    });
  };
  assert.equal((await api('POST', 'integrations/telegram/link')).status, 401);
  assert.equal(
    (await api('POST', 'integrations/telegram/link', owner.token, 'https://foreign.example'))
      .status,
    403,
  );
  assert.equal(
    (await api('GET', 'integrations/telegram', owner.token)).headers.get('cache-control'),
    'no-store',
  );
  let update = 0;
  const message = (text: string, id = 101, type = 'private') => ({
    update_id: ++update,
    message: { from: { id }, chat: { id, type }, text },
  });
  const callback = (data: string, id = 101) => ({
    update_id: ++update,
    callback_query: {
      id: `cb${update}`,
      from: { id },
      data,
      message: { chat: { id, type: 'private' } },
    },
  });
  const link = await createTelegramLink(owner.user.id);
  const code = new URL(link.url).searchParams.get('start');
  assert.equal(await handleTelegramUpdate(message(`/start ${code}`, 101, 'group')), null);
  assert.match((await handleTelegramUpdate(message(`/start ${code}`)))!.text, /terhubung/);
  assert.match((await handleTelegramUpdate(message(`/start ${code}`, 202)))!.text, /kedaluwarsa/);
  assert.equal((await telegramStatus(owner.user.id)).connected, true);
  await t.test(
    'webhook rejects missing/wrong secrets, invalid JSON, oversized payloads and disabled transport',
    async () => {
      process.env.TELEGRAM_TRANSPORT = 'webhook';
      process.env.TELEGRAM_WEBHOOK_SECRET = 'a'.repeat(64);
      const request = (body: string, secret?: string, type = 'application/json') =>
        new Request('https://test.example/api/telegram/webhook', {
          method: 'POST',
          headers: {
            'content-type': type,
            ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
          },
          body,
        });
      assert.equal((await webhook(request('{}'))).status, 401);
      assert.equal((await webhook(request('{}', 'bad'))).status, 401);
      assert.equal(
        (await webhook(request('{}', process.env.TELEGRAM_WEBHOOK_SECRET, 'text/plain'))).status,
        415,
      );
      assert.equal((await webhook(request('{', process.env.TELEGRAM_WEBHOOK_SECRET))).status, 400);
      assert.equal((await webhook(request('{}', process.env.TELEGRAM_WEBHOOK_SECRET))).status, 400);
      assert.equal(
        (await webhook(request('x'.repeat(64001), process.env.TELEGRAM_WEBHOOK_SECRET))).status,
        413,
      );
      process.env.TELEGRAM_TRANSPORT = 'polling';
      assert.equal((await webhook(request('{}', process.env.TELEGRAM_WEBHOOK_SECRET))).status, 503);
    },
  );
  const initial = await snapshot(owner.user, today().slice(0, 7));
  const a = initial.accounts[0],
    b = initial.accounts[1];
  const expense = initial.categories.find((c) => c.kind === 'expense')!;
  const income = initial.categories.find((c) => c.kind === 'income')!;
  const draft = await handleTelegramUpdate(
    message(`/keluar 25rb | ${a.name} | ${expense.name} | makan`),
  );
  assert.equal((await snapshot(owner.user, initial.month)).transactions.length, 0);
  const save = draft!.reply_markup!.inline_keyboard[0][0].callback_data;
  assert.match((await handleTelegramUpdate(callback(save, 202)))!.text, /Hubungkan/);
  const confirm = callback(save);
  const results = await Promise.all([handleTelegramUpdate(confirm), handleTelegramUpdate(confirm)]);
  assert.deepEqual(results[0], results[1]);
  assert.match((await handleTelegramUpdate(callback(save)))!.text, /sudah diproses/);
  assert.equal((await snapshot(owner.user, initial.month)).summary.expense, 25000);
  for (const text of [
    `/masuk 1jt | ${a.name} | ${income.name}`,
    `/transfer 100rb | ${a.name} | ${b.name} | 2500`,
  ]) {
    const d = await handleTelegramUpdate(message(text));
    await handleTelegramUpdate(callback(d!.reply_markup!.inline_keyboard[0][0].callback_data));
  }
  const after = await snapshot(owner.user, initial.month);
  assert.equal(after.summary.income, 1000000);
  assert.equal(after.summary.expense, 27500);
  assert.equal(after.accounts.find((x) => x.id === a.id)!.balance, a.balance + 872500);
  assert.equal(after.accounts.find((x) => x.id === b.id)!.balance, b.balance + 100000);
  assert.equal((await snapshot(other.user, initial.month)).transactions.length, 0);
  await t.test(
    'webhook delivery failures retry the committed receipt without duplicating financial writes',
    async (sub) => {
      process.env.TELEGRAM_TRANSPORT = 'webhook';
      const d = await handleTelegramUpdate(
        message(`/keluar 3rb | ${a.name} | ${expense.name} | webhook retry`),
      );
      const confirm = callback(d!.reply_markup!.inline_keyboard[0][0].callback_data);
      let attempts = 0;
      sub.mock.method(globalThis, 'fetch', async (url: string) => {
        if (url.endsWith('/answerCallbackQuery')) return Response.json({ ok: true, result: true });
        assert.ok(url.endsWith('/sendMessage'));
        attempts++;
        return Response.json(
          attempts === 1 ? { ok: false } : { ok: true, result: { message_id: 1 } },
          { status: attempts === 1 ? 503 : 200 },
        );
      });
      const request = () =>
        new Request('https://test.example/api/telegram/webhook', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET!,
          },
          body: JSON.stringify(confirm),
        });
      assert.equal((await webhook(request())).status, 503);
      assert.equal((await webhook(request())).status, 200);
      assert.equal(attempts, 2);
      assert.equal((await snapshot(owner.user, initial.month)).summary.expense, 30500);
      const rows = await query(
        "SELECT id FROM transactions WHERE user_id=$1 AND note='webhook retry'",
        [owner.user.id],
      );
      assert.equal(rows.length, 1);
      const { deleteTransaction } = await import('../../apps/web/lib/finance');
      await deleteTransaction(owner.user.id, rows[0].id);
      process.env.TELEGRAM_TRANSPORT = 'polling';
    },
  );
  const cancelled = await handleTelegramUpdate(
    message(`/keluar 1rb | ${a.name} | ${expense.name}`),
  );
  await handleTelegramUpdate(
    callback(cancelled!.reply_markup!.inline_keyboard[0][1].callback_data),
  );
  assert.match(
    (await handleTelegramUpdate(
      callback(cancelled!.reply_markup!.inline_keyboard[0][0].callback_data),
    ))!.text,
    /sudah diproses/,
  );
  const expired = await handleTelegramUpdate(message(`/keluar 1rb | ${a.name} | ${expense.name}`));
  await query("UPDATE telegram_drafts SET expires_at=now()-interval '1 second'");
  assert.match(
    (await handleTelegramUpdate(
      callback(expired!.reply_markup!.inline_keyboard[0][0].callback_data),
    ))!.text,
    /kedaluwarsa/,
  );
  await t.test(
    'free text asks follow-ups, persists context, and saves only after confirmation',
    async () => {
      const before = await snapshot(owner.user, initial.month);
      const ask = message('bayar servis 75 ribu');
      const replies = await Promise.all([handleTelegramUpdate(ask), handleTelegramUpdate(ask)]);
      assert.deepEqual(replies[0], replies[1]);
      assert.match(replies[0]!.text, /Pakai akun/);
      assert.equal(
        (await query('SELECT * FROM telegram_conversations WHERE user_id=$1', [owner.user.id]))
          .length,
        1,
      );
      assert.match((await handleTelegramUpdate(message(a.name, 202)))!.text, /Hubungkan/);
      // Informational commands do not discard a pending transaction.
      await handleTelegramUpdate(message('/akun'));
      assert.match((await handleTelegramUpdate(message(`pakai ${a.name}`)))!.text, /kategori/);
      const ready = await handleTelegramUpdate(message(expense.name));
      assert.ok(ready!.reply_markup);
      assert.match(ready!.text, /Rp75.000/);
      assert.match(ready!.text, /bayar servis 75 ribu/);
      assert.equal(
        (await snapshot(owner.user, initial.month)).transactions.length,
        before.transactions.length,
      );
      const saveNatural = callback(ready!.reply_markup!.inline_keyboard[0][0].callback_data);
      await Promise.all([handleTelegramUpdate(saveNatural), handleTelegramUpdate(saveNatural)]);
      const saved = await snapshot(owner.user, initial.month);
      assert.equal(saved.summary.expense, before.summary.expense + 75000);
      assert.equal(saved.transactions.length, before.transactions.length + 1);
      // Delete the test transaction through the web service to retain the outer test's totals.
      const id = saved.transactions.find((tx) => tx.note === 'bayar servis 75 ribu')!.id;
      const { deleteTransaction } = await import('../../apps/web/lib/finance');
      await deleteTransaction(owner.user.id, id);
    },
  );
  await t.test(
    'conversation cancellation, expiry, account changes and transfer fees are explicit',
    async () => {
      await handleTelegramUpdate(message('makan 25rb'));
      const expiredReply = await handleTelegramUpdate(message('/batal'));
      assert.match(expiredReply!.text, /dibatalkan/);
      assert.equal(
        (await query('SELECT * FROM telegram_conversations WHERE user_id=$1', [owner.user.id]))
          .length,
        0,
      );
      await handleTelegramUpdate(message('bayar servis 75rb'));
      await query("UPDATE telegram_conversations SET expires_at=now()-interval '1 second'");
      const noContext = await handleTelegramUpdate(message(a.name));
      assert.match(noContext!.text, /pengeluaran, pemasukan/);
      await handleTelegramUpdate(message('/baru'));
      const feeQuestion = await handleTelegramUpdate(
        message(`transfer dari ${a.name} ke ${b.name} 100rb`),
      );
      assert.match(feeQuestion!.text, /biaya admin/);
      const transferReady = await handleTelegramUpdate(message('gratis'));
      assert.match(transferReady!.text, /Biaya admin: Rp0/);
      assert.ok(transferReady!.reply_markup);
      await handleTelegramUpdate(message('/batal'));
      assert.match(
        (await handleTelegramUpdate(
          callback(transferReady!.reply_markup!.inline_keyboard[0][0].callback_data),
        ))!.text,
        /sudah diproses/,
      );
      assert.equal((await snapshot(owner.user, initial.month)).summary.expense, 27500);
      await handleTelegramUpdate(message('bayar servis 75rb'));
    },
  );
  const revoked = await handleTelegramUpdate(message(`/keluar 1rb | ${a.name} | ${expense.name}`));
  await disconnectTelegram(owner.user.id);
  assert.match(
    (await handleTelegramUpdate(
      callback(revoked!.reply_markup!.inline_keyboard[0][0].callback_data),
    ))!.text,
    /Hubungkan/,
  );
  assert.equal((await telegramStatus(owner.user.id)).connected, false);
  assert.equal((await snapshot(owner.user, initial.month)).summary.expense, 27500);
  // Disconnect also revokes an unfinished natural-language conversation.
  assert.equal(
    (await query('SELECT * FROM telegram_conversations WHERE user_id=$1', [owner.user.id])).length,
    0,
  );
});
