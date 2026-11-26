import './ui-dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Snapshot } from '@money/core';
import type { EmailRule, GmailStatus } from '@money/core/email-transactions';
import { EmailRuleForm, Integrations } from '../apps/web/components/integrations';
import { TelegramConnect } from '../apps/web/components/telegram-connect';
import { GoogleButton } from '../apps/web/components/google-button';

afterEach(() => cleanup());
const data: Snapshot = {
  user: { id: 'user', username: 'test' },
  month: '2026-10',
  total: 0,
  transactions: [],
  recent: [],
  quick_fills: [],
  needs_setup: false,
  last_expense: null,
  summary: { income: 0, expense: 0 },
  accounts: [
    {
      id: 'e404bad9-53c9-44ed-afd5-c3d861350e67',
      name: 'BNI',
      type: 'bank',
      initial_balance: 0,
      balance: 0,
      archived: false,
    },
    {
      id: 'bb3f83cb-1156-4c6b-9472-543bc0b81cda',
      name: 'Mandiri',
      type: 'bank',
      initial_balance: 0,
      balance: 0,
      archived: false,
    },
  ],
  categories: [
    {
      id: '13af98a8-72ee-4611-b2c6-dc5155582dcc',
      name: 'Belanja',
      kind: 'expense',
      budget: null,
      spent: 0,
      total: 0,
      used: 0,
    },
  ],
};

test('email rules explicitly map expenses and own-account transfers without retaining a stale category', async () => {
  const user = userEvent.setup();
  const saved: unknown[] = [];
  render(
    <EmailRuleForm
      data={data}
      busy={false}
      onSave={async (body) => {
        saved.push(body);
      }}
    />,
  );
  await user.type(screen.getByRole('textbox', { name: 'Nama aturan' }), 'Pembayaran bank');
  await user.type(
    screen.getByRole('textbox', { name: 'Email pengirim bank' }),
    'notify@bank.example',
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Subjek email mengandung' }),
    'Pembayaran berhasil',
  );
  await user.click(screen.getByRole('combobox', { name: 'Rekening email' }));
  await user.click(screen.getByRole('option', { name: 'BNI' }));
  await user.click(screen.getByRole('combobox', { name: 'Kategori otomatis' }));
  await user.click(screen.getByRole('option', { name: 'Belanja' }));
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.deepEqual(saved[0], {
    name: 'Pembayaran bank',
    sender: 'notify@bank.example',
    subject_contains: 'Pembayaran berhasil',
    body_contains: '',
    kind: 'expense',
    account_id: data.accounts[0].id,
    category_id: data.categories[0].id,
    to_account_id: null,
    enabled: true,
  });
  await user.click(screen.getByRole('combobox', { name: 'Jenis pencatatan email' }));
  await user.click(screen.getByRole('option', { name: 'Transfer antar akun sendiri' }));
  assert.equal(screen.queryByRole('combobox', { name: 'Kategori otomatis' }), null);
  await user.click(screen.getByRole('combobox', { name: 'Tujuan transfer email' }));
  assert.equal(screen.queryByRole('option', { name: 'BNI' }), null);
  await user.click(screen.getByRole('option', { name: 'Mandiri' }));
  await user.click(screen.getByRole('checkbox', { name: 'Aktifkan aturan ini' }));
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.equal((saved[1] as { category_id: string | null }).category_id, null);
  assert.equal((saved[1] as { to_account_id: string }).to_account_id, data.accounts[1].id);
  assert.equal((saved[1] as { enabled: boolean }).enabled, false);
});

test('bank presets fill confirmed headers, stay editable and require fresh account/category mappings', async () => {
  const user = userEvent.setup();
  const saved: unknown[] = [];
  render(
    <EmailRuleForm
      data={data}
      busy={false}
      onSave={async (body) => {
        saved.push(body);
      }}
    />,
  );
  const input = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
  await user.click(screen.getByRole('combobox', { name: 'Format email bank' }));
  await user.click(screen.getByRole('option', { name: 'BNI wondr — Pembayaran QRIS' }));
  assert.equal(input('Email pengirim bank').value, 'wondr@bni.co.id');
  assert.equal(input('Subjek email mengandung').value, 'Transaksi berhasil!');
  assert.equal(input('Isi email mengandung (opsional)').value, 'bayar pakai QRIS');
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.equal(saved.length, 0);
  await user.click(screen.getByRole('combobox', { name: 'Rekening email' }));
  await user.click(screen.getByRole('option', { name: 'BNI' }));
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.equal(saved.length, 0);
  await user.click(screen.getByRole('combobox', { name: 'Kategori otomatis' }));
  await user.click(screen.getByRole('option', { name: 'Belanja' }));
  await user.clear(input('Nama aturan'));
  await user.type(input('Nama aturan'), 'QRIS rekening utama');
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.deepEqual(saved[0], {
    name: 'QRIS rekening utama',
    sender: 'wondr@bni.co.id',
    subject_contains: 'Transaksi berhasil!',
    body_contains: 'bayar pakai QRIS',
    kind: 'expense',
    account_id: data.accounts[0].id,
    category_id: data.categories[0].id,
    to_account_id: null,
    enabled: true,
  });

  await user.click(screen.getByRole('combobox', { name: 'Jenis pencatatan email' }));
  await user.click(screen.getByRole('option', { name: 'Transfer antar akun sendiri' }));
  await user.click(screen.getByRole('combobox', { name: 'Tujuan transfer email' }));
  await user.click(screen.getByRole('option', { name: 'Mandiri' }));
  await user.click(screen.getByRole('combobox', { name: 'Format email bank' }));
  await user.click(screen.getByRole('option', { name: 'Mandiri Livin’ — Transfer keluar' }));
  assert.equal(input('Email pengirim bank').value, 'noreply.livin@bankmandiri.co.id');
  assert.equal(input('Subjek email mengandung').value, 'Transfer Berhasil');
  assert.equal(input('Isi email mengandung (opsional)').value, 'Jumlah Transfer');
  assert.match(
    screen.getByRole('combobox', { name: 'Jenis pencatatan email' }).textContent!,
    /Pengeluaran/,
  );
  assert.equal(screen.queryByRole('combobox', { name: 'Tujuan transfer email' }), null);
  assert.equal(screen.getByRole('combobox', { name: 'Rekening email' }).textContent, 'Pilih');
  assert.equal(screen.getByRole('combobox', { name: 'Kategori otomatis' }).textContent, 'Pilih');
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.equal(saved.length, 1);
  await user.click(screen.getByRole('combobox', { name: 'Rekening email' }));
  await user.click(screen.getByRole('option', { name: 'Mandiri' }));
  await user.click(screen.getByRole('combobox', { name: 'Kategori otomatis' }));
  await user.click(screen.getByRole('option', { name: 'Belanja' }));
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  assert.deepEqual(saved[1], {
    name: 'Transfer keluar Mandiri',
    sender: 'noreply.livin@bankmandiri.co.id',
    subject_contains: 'Transfer Berhasil',
    body_contains: 'Jumlah Transfer',
    kind: 'expense',
    account_id: data.accounts[1].id,
    category_id: data.categories[0].id,
    to_account_id: null,
    enabled: true,
  });
});

test('editing an existing rule preserves custom filters and mappings', async () => {
  const user = userEvent.setup();
  const rule: EmailRule = {
    id: 'existing',
    created_at: '2026-10-31T00:00:00Z',
    name: 'QRIS merchant khusus',
    sender: 'wondr@bni.co.id',
    subject_contains: 'Transaksi berhasil!',
    body_contains: 'TOKO CONTOH',
    kind: 'expense',
    account_id: data.accounts[0].id,
    category_id: data.categories[0].id,
    to_account_id: null,
    enabled: false,
  };
  let saved: unknown;
  render(
    <EmailRuleForm
      data={data}
      rule={rule}
      busy={false}
      onSave={async (body) => {
        saved = body;
      }}
    />,
  );
  assert.equal(screen.queryByRole('combobox', { name: 'Format email bank' }), null);
  await user.click(screen.getByRole('button', { name: 'Simpan aturan' }));
  const { id, created_at, ...expected } = rule;
  assert.deepEqual(saved, expected);
});

test('Google connection button surfaces API errors and re-enables retry', async (t) => {
  const user = userEvent.setup();
  let body: unknown;
  t.mock.method(globalThis, 'fetch', async (_: unknown, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return Response.json(
      { error: { message: 'Login Google belum dikonfigurasi.' } },
      { status: 503 },
    );
  });
  render(<GoogleButton purpose="gmail">Hubungkan Gmail</GoogleButton>);
  await user.click(screen.getByRole('button', { name: /Hubungkan Gmail/ }));
  assert.deepEqual(body, { purpose: 'gmail' });
  assert.match((await screen.findByRole('alert')).textContent!, /belum dikonfigurasi/);
  assert.equal(
    (screen.getByRole('button', { name: /Hubungkan Gmail/ }) as HTMLButtonElement).disabled,
    false,
  );
});

test('integration settings show identity, worker state, imported history and persist pause/resume', async (t) => {
  const user = userEvent.setup();
  let enabled = true;
  const actions: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      const action = JSON.parse(String(options.body)).action;
      actions.push(action);
      enabled = action === 'resume';
      return Response.json({ data: { message: enabled ? 'Impor aktif.' : 'Impor dijeda.' } });
    }
    const status: GmailStatus = {
      google_configured: true,
      gmail_configured: true,
      identity: { email: 'test@gmail.com' },
      worker_active: false,
      connection: {
        connected: true,
        enabled,
        sync_from: '2026-10-31T00:00:00Z',
        last_synced_at: null,
        last_error: null,
      },
      rules: [],
      imports: [
        {
          id: 'import',
          status: 'imported',
          reason: 'Transaksi dicatat otomatis.',
          transaction_id: 'transaction',
          rule_name: 'Bank test',
          received_at: '2026-10-31T01:00:00Z',
          created_at: '2026-10-31T01:00:00Z',
        },
      ],
    };
    return Response.json({ data: path.includes('/snapshot') ? data : status });
  });
  render(<Integrations />);
  assert.ok(await screen.findByText('Impor otomatis aktif'));
  assert.ok(screen.getByText(/Proses sinkronisasi belum aktif/));
  assert.ok(screen.getByText('Transaksi dicatat otomatis.'));
  await user.click(screen.getByRole('button', { name: 'Jeda impor' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Aktifkan impor' })));
  await user.click(screen.getByRole('button', { name: 'Aktifkan impor' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Jeda impor' })));
  assert.deepEqual(actions, ['pause', 'resume']);
});

test('Telegram settings create a private link and revoke the connected account', async (t) => {
  const user = userEvent.setup();
  let connected = false;
  const actions: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      actions.push('link');
      connected = true;
      return Response.json({ data: { url: 'https://t.me/money_test_bot?start=private-code' } });
    }
    if (options?.method === 'DELETE') {
      actions.push('disconnect');
      connected = false;
      return Response.json({ data: { message: 'Telegram diputus.' } });
    }
    return Response.json({ data: { configured: true, connected, username: 'money_test_bot' } });
  });
  render(<TelegramConnect />);
  await user.click(await screen.findByRole('button', { name: 'Buat tautan Telegram' }));
  const link = await screen.findByRole('link', { name: 'Buka bot Telegram' });
  assert.equal(link.getAttribute('href'), 'https://t.me/money_test_bot?start=private-code');
  await user.click(await screen.findByRole('button', { name: 'Putuskan Telegram' }));
  await screen.findByRole('button', { name: 'Buat tautan Telegram' });
  assert.equal(screen.queryByRole('link', { name: 'Buka bot Telegram' }), null);
  assert.deepEqual(actions, ['link', 'disconnect']);
});
