import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';
import { NextRequest } from 'next/server';
import { pool, query, atomic } from '@money/database';
import { bankEmailPresets } from '@money/core/email-transactions';
import { migrate } from '../../scripts/migrate';
import { signup, login, sessionUser, digest, COOKIE_NAME } from '../../apps/web/lib/auth';
import {
  beginGoogle,
  consumeGoogleState,
  googleSignIn,
  attachGoogle,
  completeGoogle,
  GMAIL_SCOPE,
} from '../../apps/web/lib/google';
import {
  gmailStatus,
  saveEmailRule,
  updateGmailConnection,
} from '../../apps/web/lib/gmail-settings';
import {
  importGmailMessage,
  syncGmailUser,
  type GmailMessage,
  type GmailApi,
} from '../../apps/web/lib/gmail';
import { snapshot, deleteTransaction, saveBudgets } from '../../apps/web/lib/finance';
import { POST as startGoogle } from '../../apps/web/app/api/google/start/route';
import { GET as callbackGoogle } from '../../apps/web/app/api/google/callback/route';
import { GET, PATCH, POST } from '../../apps/web/app/api/v1/[...path]/route';
import { bniQrisHtml, mandiriTransferHtml } from '../fixtures/bank-emails';

test('Google identity and automatic Gmail imports are isolated, replay-safe and atomic', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.match(new URL(url).pathname, /_test$/);
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.GMAIL_TOKEN_KEY = randomBytes(32).toString('base64');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const schema = `gmail_test_${randomBytes(8).toString('hex')}`;
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
  const owner = await signup('emailowner', 'password123');
  const other = await signup('emailother', 'password123');
  const initial = await snapshot(owner.user, '2026-10');
  const account = initial.accounts[0];
  const destination = initial.accounts[1];
  const category = initial.categories.find((item) => item.kind === 'expense')!;
  const ruleBody = {
    name: 'Bank test',
    sender: 'notify@bank.example',
    subject_contains: 'Pembayaran berhasil',
    kind: 'expense',
    account_id: account.id,
    category_id: category.id,
  };

  await t.test('OAuth uses PKCE, nonce, browser binding, expiry and single-use state', async () => {
    const start = await beginGoogle('login');
    const authUrl = new URL(start.url);
    assert.equal(authUrl.origin, 'https://accounts.google.com');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authUrl.searchParams.get('nonce'));
    assert.equal(authUrl.searchParams.get('scope')?.includes('gmail'), false);
    const state = authUrl.searchParams.get('state')!;
    await assert.rejects(() => consumeGoogleState(state, '0'.repeat(64)));
    assert.ok((await consumeGoogleState(state, start.browser)).verifier);
    await assert.rejects(() => consumeGoogleState(state, start.browser));
    const expired = await beginGoogle('login');
    await query("UPDATE google_oauth_states SET expires_at=now()-interval '1 minute'");
    await assert.rejects(() =>
      consumeGoogleState(new URL(expired.url).searchParams.get('state')!, expired.browser),
    );
    await assert.rejects(() => beginGoogle('link'));
    const link = await beginGoogle('link', owner.token);
    await assert.rejects(() =>
      consumeGoogleState(new URL(link.url).searchParams.get('state')!, link.browser, other.token),
    );
  });
  await t.test(
    'Google sign-in creates a passwordless account and never merges by email or username',
    async () => {
      const profile = { subject: 'new-google-user', email: 'emailowner@gmail.com' };
      const signed = await googleSignIn(profile);
      assert.notEqual(signed.user.id, owner.user.id);
      assert.equal((await sessionUser(signed.token))?.id, signed.user.id);
      assert.equal((await snapshot(signed.user, '2026-10')).accounts.length, 6);
      assert.equal((await googleSignIn(profile)).user.id, signed.user.id);
      await assert.rejects(() => login(signed.user.username, 'password123'));
      await atomic((client) =>
        attachGoogle(client, owner.user.id, { subject: 'owner-google', email: 'owner@gmail.com' }),
      );
      await assert.rejects(() =>
        atomic((client) =>
          attachGoogle(client, other.user.id, {
            subject: 'owner-google',
            email: 'owner@gmail.com',
          }),
        ),
      );
      await assert.rejects(() =>
        atomic((client) =>
          attachGoogle(client, owner.user.id, {
            subject: 'different-google',
            email: 'owner@gmail.com',
          }),
        ),
      );
      assert.equal(
        (await googleSignIn({ subject: 'owner-google', email: 'owner@gmail.com' })).user.id,
        owner.user.id,
      );
    },
  );
  await t.test(
    'Gmail consent checks identity, nonce and granted scope before storing an encrypted token',
    async (sub) => {
      const start = await beginGoogle('gmail', owner.token);
      const state = await consumeGoogleState(
        new URL(start.url).searchParams.get('state')!,
        start.browser,
        owner.token,
      );
      let scope = 'openid email';
      let nonce = state.nonce;
      sub.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
        tokens: { id_token: 'test-id-token', refresh_token: 'sensitive-test-refresh', scope },
      }));
      sub.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({
        getPayload: () => ({
          sub: 'owner-google',
          email: 'owner@gmail.com',
          email_verified: true,
          nonce,
        }),
      }));
      await assert.rejects(() => completeGoogle('code', state), /Izin membaca Gmail/);
      scope += ` ${GMAIL_SCOPE}`;
      nonce = 'wrong';
      await assert.rejects(() => completeGoogle('code', state), /diverifikasi/);
      nonce = state.nonce;
      await completeGoogle('code', state);
      const row = (
        await query('SELECT refresh_token_encrypted FROM gmail_connections WHERE user_id=$1', [
          owner.user.id,
        ])
      )[0];
      assert.ok(row.refresh_token_encrypted);
      assert.equal(row.refresh_token_encrypted.includes('sensitive-test-refresh'), false);
      const status = await gmailStatus(owner.user.id);
      assert.equal(status.connection?.connected, true);
      assert.doesNotMatch(
        JSON.stringify(status),
        /refresh_token|sensitive-test-refresh|test-secret/,
      );
    },
  );
  await t.test('email mapping validates account ownership and category kind', async () => {
    await saveEmailRule(owner.user.id, ruleBody);
    await assert.rejects(() => saveEmailRule(other.user.id, ruleBody));
    await assert.rejects(() =>
      saveEmailRule(owner.user.id, {
        ...ruleBody,
        category_id: initial.categories.find((item) => item.kind === 'income')!.id,
      }),
    );
    const rule = (await gmailStatus(owner.user.id)).rules[0];
    await assert.rejects(() => saveEmailRule(other.user.id, ruleBody, rule.id));
  });
  function message(id: string, reference = id): GmailMessage {
    const text = `Transaksi berhasil\nTanggal Transaksi: 31/10/2026\nNominal: Rp100.000\nBiaya Admin: Rp2.500\nTotal: Rp102.500\nNomor Referensi: REF-${reference}`;
    return {
      id,
      internalDate: String(Date.now() + 1000),
      labelIds: ['INBOX'],
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Bank <notify@bank.example>' },
          { name: 'Subject', value: 'Pembayaran berhasil' },
          {
            name: 'Authentication-Results',
            value: 'mx.google.com; dmarc=pass header.from=bank.example',
          },
        ],
        body: { data: Buffer.from(text).toString('base64url') },
      },
    };
  }
  await t.test(
    'concurrent delivery and repeated references create exactly one expense and update budgets',
    async () => {
      await saveBudgets(owner.user.id, [{ id: category.id, budget: 100000 }], '2026-01');
      const results = await Promise.all([
        importGmailMessage(owner.user.id, 'owner-google', message('first')),
        importGmailMessage(owner.user.id, 'owner-google', message('first')),
      ]);
      assert.deepEqual(results.sort(), ['imported', 'seen']);
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('copy', 'first')),
        'duplicate',
      );
      const state = await snapshot(owner.user, '2026-10');
      assert.equal(state.summary.expense, 102500);
      assert.equal(state.categories.find((item) => item.id === category.id)!.spent, 102500);
      assert.equal(state.transactions[0].source, 'gmail');
      assert.match(
        (await gmailStatus(owner.user.id)).imports.find((item) => item.status === 'imported')!
          .reason,
        /Anggaran/,
      );
      assert.equal((await snapshot(other.user, '2026-10')).summary.expense, 0);
      await deleteTransaction(owner.user.id, state.transactions[0].id);
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('first')),
        'seen',
      );
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('third', 'first')),
        'duplicate',
      );
      assert.equal((await snapshot(owner.user, '2026-10')).summary.expense, 0);
    },
  );
  await t.test(
    'BNI QRIS and Mandiri transfer layouts import expenses into the correct months and budgets',
    async () => {
      const { user } = await signup('bankexamples', 'password123');
      const profile = { subject: 'bank-examples-google', email: 'examples@example.test' };
      await atomic((client) => attachGoogle(client, user.id, profile));
      // No external requests: this test calls only the atomic importer on a disposable database.
      await query(
        'INSERT INTO gmail_connections(user_id,subject,refresh_token_encrypted) VALUES($1,$2,$3)',
        [user.id, profile.subject, 'test-only-placeholder'],
      );
      const before = await snapshot(user, '2026-10');
      const bni = before.accounts.find((item) => item.name === 'BNI')!;
      const mandiri = before.accounts.find((item) => item.name === 'Mandiri')!;
      const expense = before.categories.find((item) => item.kind === 'expense')!;
      await saveBudgets(user.id, [{ id: expense.id, budget: 50000 }], '2026-01');
      const examples = [
        {
          id: 'bni-example',
          html: bniQrisHtml,
          preset: 'bni-qris',
          subject: 'Transaksi berhasil!',
          sender: 'wondr@bni.co.id',
          account: bni.id,
        },
        {
          id: 'mandiri-example',
          html: mandiriTransferHtml,
          preset: 'mandiri-transfer',
          subject: 'Transfer Berhasil',
          sender: 'noreply.livin@bankmandiri.co.id',
          account: mandiri.id,
        },
      ];
      for (const example of examples) {
        await saveEmailRule(user.id, {
          ...bankEmailPresets.find((preset) => preset.id === example.preset)!,
          account_id: example.account,
          category_id: expense.id,
        });
        const bankMessage: GmailMessage = {
          id: example.id,
          internalDate: String(Date.now() + 1000),
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: example.sender },
              { name: 'Subject', value: example.subject },
              {
                name: 'Authentication-Results',
                value: `mx.google.com; dmarc=pass header.from=${example.sender.split('@')[1]}`,
              },
            ],
            body: { data: Buffer.from(example.html).toString('base64url') },
          },
        };
        const wrongSender = structuredClone(bankMessage);
        wrongSender.id += '-wrong-sender';
        wrongSender.payload!.headers![0].value += '.attacker.example';
        assert.equal(await importGmailMessage(user.id, profile.subject, wrongSender), 'unmatched');
        const otherNotification = structuredClone(bankMessage);
        otherNotification.id += '-other-notification';
        otherNotification.payload!.body = {
          data: Buffer.from('<p>Transaksi berhasil. Dana masuk ke rekening Anda.</p>').toString(
            'base64url',
          ),
        };
        assert.equal(
          await importGmailMessage(user.id, profile.subject, otherNotification),
          'unmatched',
        );
        const unverified = structuredClone(bankMessage);
        unverified.id += '-unverified';
        unverified.payload!.headers![2].value = `mx.google.com; dmarc=fail header.from=${example.sender.split('@')[1]}`;
        assert.equal(await importGmailMessage(user.id, profile.subject, unverified), 'skipped');
        assert.equal(await importGmailMessage(user.id, profile.subject, bankMessage), 'imported');
        assert.equal(
          await importGmailMessage(user.id, profile.subject, {
            ...bankMessage,
            id: example.id + '-copy',
          }),
          'duplicate',
        );
      }
      const october = await snapshot(user, '2026-10');
      const september = await snapshot(user, '2026-09');
      assert.equal(october.summary.expense, 35000);
      assert.equal(september.summary.expense, 25000);
      assert.equal(october.categories.find((item) => item.id === expense.id)!.spent, 35000);
      assert.equal(september.categories.find((item) => item.id === expense.id)!.spent, 25000);
      assert.equal(october.accounts.find((item) => item.id === bni.id)!.balance, -35000);
      assert.equal(october.accounts.find((item) => item.id === mandiri.id)!.balance, -25000);
      assert.equal(october.transactions[0].source, 'gmail');
      assert.equal(september.transactions[0].kind, 'expense');
    },
  );
  await t.test(
    'spoofed, failed, ambiguous, old and unconfigured emails cannot change balances',
    async () => {
      const forged = message('forged');
      forged.payload!.headers![2].value = 'attacker.example; dmarc=pass header.from=bank.example';
      assert.equal(await importGmailMessage(owner.user.id, 'owner-google', forged), 'skipped');
      const failed = message('failed');
      failed.payload!.body!.data = Buffer.from('Status: gagal\nNominal: Rp100.000').toString(
        'base64url',
      );
      assert.equal(await importGmailMessage(owner.user.id, 'owner-google', failed), 'skipped');
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', {
          ...message('old'),
          internalDate: '1',
        }),
        'old',
      );
      const unrelated = message('unrelated');
      unrelated.payload!.headers![0].value = 'someone@example.com';
      assert.equal(await importGmailMessage(owner.user.id, 'owner-google', unrelated), 'unmatched');
      await saveEmailRule(owner.user.id, { ...ruleBody, name: 'Overlapping rule' });
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('overlap')),
        'skipped',
      );
      const overlap = (await gmailStatus(owner.user.id)).rules.find(
        (rule) => rule.name === 'Overlapping rule',
      )!;
      await saveEmailRule(owner.user.id, { ...overlap, enabled: false }, overlap.id);
      assert.equal((await snapshot(owner.user, '2026-10')).summary.expense, 0);
    },
  );
  await t.test(
    'transfer emails create principal and fee atomically and fail safely with archived accounts',
    async () => {
      const rule = (await gmailStatus(owner.user.id)).rules[0];
      await saveEmailRule(
        owner.user.id,
        { ...rule, kind: 'transfer', to_account_id: destination.id, category_id: null },
        rule.id,
      );
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('transfer')),
        'imported',
      );
      const state = await snapshot(owner.user, '2026-10');
      assert.equal(state.summary.expense, 2500);
      assert.equal(state.accounts.find((item) => item.id === account.id)!.balance, -102500);
      assert.equal(state.accounts.find((item) => item.id === destination.id)!.balance, 100000);
      assert.equal(state.transactions.length, 2);
      await query('UPDATE accounts SET archived=true WHERE user_id=$1 AND id=$2', [
        owner.user.id,
        account.id,
      ]);
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('archived')),
        'skipped',
      );
      assert.equal((await snapshot(owner.user, '2026-10')).transactions.length, 2);
      await query('UPDATE accounts SET archived=false WHERE user_id=$1 AND id=$2', [
        owner.user.id,
        account.id,
      ]);
    },
  );
  await t.test(
    'polling persists pagination, resumes after outages and does not advance past failed fetches',
    async () => {
      let failed = true;
      const calls: string[] = [];
      const api: GmailApi = async <T>(path: string, params?: Record<string, string>) => {
        calls.push(`${path}:${params?.pageToken ?? ''}`);
        if (path === 'messages') {
          if (!params?.pageToken)
            return { messages: [{ id: 'page1' }], nextPageToken: 'page-two' } as T;
          if (failed) throw new Error('Temporary network failure');
          return { messages: [{ id: 'page2' }] } as T;
        }
        return message(path.split('/')[1]) as T;
      };
      await syncGmailUser(owner.user.id, api);
      let connection = (
        await query('SELECT * FROM gmail_connections WHERE user_id=$1', [owner.user.id])
      )[0];
      assert.equal(connection.page_token, 'page-two');
      assert.equal(connection.last_synced_at, null);
      assert.ok(connection.last_error);
      failed = false;
      await syncGmailUser(owner.user.id, api);
      connection = (
        await query('SELECT * FROM gmail_connections WHERE user_id=$1', [owner.user.id])
      )[0];
      assert.equal(connection.page_token, null);
      assert.ok(connection.last_synced_at);
      assert.equal(connection.last_error, null);
      assert.equal(calls.filter((call) => call === 'messages/page1:').length, 1);
    },
  );
  await t.test(
    'Neon-compatible leases prevent concurrent scans and release after completion',
    async () => {
      let release!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const api: GmailApi = async <T>() => {
        calls++;
        entered();
        await hold;
        return { messages: [] } as T;
      };
      const first = syncGmailUser(owner.user.id, api);
      await ready;
      try {
        await syncGmailUser(owner.user.id, api);
        assert.equal(calls, 1);
      } finally {
        release();
        await first;
      }
      const [lease] = await query(
        'SELECT expires_at<now() released FROM gmail_sync_leases WHERE user_id=$1',
        [owner.user.id],
      );
      assert.equal(lease.released, true);
    },
  );
  await t.test(
    'a bounded scheduled scan retains its watermark and resumes after the budget expires',
    async (sub) => {
      let clock = Date.now();
      sub.mock.method(Date, 'now', () => clock);
      const [before] = await query(
        'SELECT last_synced_at FROM gmail_connections WHERE user_id=$1',
        [owner.user.id],
      );
      const api: GmailApi = async <T>(path: string) => {
        assert.equal(path, 'messages');
        clock += 2000;
        return { messages: [{ id: 'budget-message' }] } as T;
      };
      await syncGmailUser(owner.user.id, api, { deadline: clock + 1000 });
      const [partial] = await query('SELECT * FROM gmail_connections WHERE user_id=$1', [
        owner.user.id,
      ]);
      assert.equal(partial.last_synced_at?.valueOf(), before.last_synced_at?.valueOf());
      assert.ok(partial.scan_query);
      assert.ok(partial.scan_until);
      const resume: GmailApi = async <T>() => ({ messages: [] }) as T;
      await syncGmailUser(owner.user.id, resume);
      const [finished] = await query('SELECT * FROM gmail_connections WHERE user_id=$1', [
        owner.user.id,
      ]);
      assert.equal(finished.scan_query, null);
      assert.equal(finished.scan_until, null);
    },
  );
  await t.test(
    'pause and disconnect prevent imports, and API access stays user-scoped',
    async () => {
      await updateGmailConnection(owner.user.id, 'pause');
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('paused')),
        'inactive',
      );
      await updateGmailConnection(owner.user.id, 'resume');
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('resumed')),
        'imported',
      );
      const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
      const request = (path: string, method: string, body?: unknown, token?: string) =>
        new NextRequest(`http://localhost:3000/api/v1/${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      assert.equal(
        (await GET(request('integrations/google', 'GET'), context('integrations/google'))).status,
        401,
      );
      const response = await GET(
        request('integrations/google', 'GET', undefined, other.token),
        context('integrations/google'),
      );
      assert.deepEqual((await response.json()).data.imports, []);
      assert.equal(
        (await POST(request('email-rules', 'POST', ruleBody, other.token), context('email-rules')))
          .status,
        400,
      );
      assert.equal(
        (
          await PATCH(
            request('integrations/gmail', 'PATCH', { action: 'disconnect' }, owner.token),
            context('integrations/gmail'),
          )
        ).status,
        200,
      );
      assert.equal(
        await importGmailMessage(owner.user.id, 'owner-google', message('disconnected')),
        'inactive',
      );
      await assert.rejects(() => updateGmailConnection(owner.user.id, 'resume'));
      assert.equal((await gmailStatus(owner.user.id)).identity?.email, 'owner@gmail.com');
      assert.equal(
        (
          await query('SELECT refresh_token_encrypted FROM gmail_connections WHERE user_id=$1', [
            owner.user.id,
          ])
        )[0].refresh_token_encrypted,
        null,
      );
    },
  );
  await t.test(
    'HTTP OAuth start rejects foreign origins and callbacks reject missing browser state',
    async () => {
      const denied = await startGoogle(
        new NextRequest('http://localhost:3000/api/google/start', {
          method: 'POST',
          headers: { origin: 'https://attacker.example' },
          body: JSON.stringify({ purpose: 'login' }),
        }),
      );
      assert.equal(denied.status, 403);
      const start = await startGoogle(
        new NextRequest('http://localhost:3000/api/google/start', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000', cookie: `${COOKIE_NAME}=${owner.token}` },
          body: JSON.stringify({ purpose: 'link' }),
        }),
      );
      assert.equal(start.status, 200);
      assert.match(start.headers.get('set-cookie')!, /HttpOnly/i);
      assert.match(start.headers.get('set-cookie')!, /SameSite=lax/i);
      const url = new URL((await start.json()).data.url);
      const callback = await callbackGoogle(
        new NextRequest(
          `http://localhost:3000/api/google/callback?state=${url.searchParams.get('state')}&code=test`,
        ),
      );
      assert.match(callback.headers.get('location')!, /google_error/);
      assert.equal(callback.headers.get('set-cookie')!.includes('money_session'), false);
    },
  );
});
