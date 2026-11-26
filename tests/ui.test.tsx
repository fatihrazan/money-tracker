import './ui-dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { SelectField, DateField } from '../apps/web/components/pickers';
import { Modal, TransactionForm } from '../apps/web/components/forms';
import { ThemeButton } from '../apps/web/components/shell';
import type { Snapshot } from '@money/core';
import { SwipeCategory } from '../apps/web/components/swipe-category';
import { PhotoImport } from '../apps/web/components/photo-import';
import type { PhotoScanner } from '../apps/web/lib/scan-photo';

afterEach(() => cleanup());

const photoData: Snapshot = {
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
    { id: 'bni', name: 'BNI', type: 'bank', initial_balance: 0, balance: 0, archived: false },
    {
      id: 'gopay',
      name: 'GoPay',
      type: 'ewallet',
      initial_balance: 0,
      balance: 0,
      archived: false,
    },
  ],
  categories: [
    {
      id: 'food',
      name: 'Makan & Minum',
      kind: 'expense',
      budget: null,
      spent: 0,
      total: 0,
      used: 0,
    },
    { id: 'salary', name: 'Gaji', kind: 'income', budget: null, spent: 0, total: 0, used: 0 },
  ],
};
const photoFile = () => new window.File(['test image'], 'struk.png', { type: 'image/png' });

test('photo review fills the form, allows corrections, and never saves automatically', async (t) => {
  t.mock.method(URL, 'createObjectURL', () => 'blob:test-photo');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const user = userEvent.setup(),
    saved: Record<string, unknown>[] = [];
  const scanner: PhotoScanner = async (_, options) => {
    options.onProgress({ value: 60, label: 'Membaca transaksi' });
    return { text: 'KOPI PAGI\n30/10/2026\nPembayaran GoPay\nTOTAL Rp20.000', confidence: 95 };
  };
  render(
    <TransactionForm
      data={photoData}
      busy={false}
      photoScanner={scanner}
      onSave={async (body) => {
        saved.push(body as Record<string, unknown>);
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Isi dari foto' }));
  await user.upload(
    screen.getByLabelText('Unggah foto transaksi') as HTMLInputElement,
    photoFile(),
  );
  await user.click(await screen.findByRole('button', { name: 'Gunakan hasil' }));
  assert.equal(saved.length, 0);
  assert.equal(
    (screen.getByRole('textbox', { name: /Nominal/ }) as HTMLInputElement).value,
    '20000',
  );
  assert.equal(screen.getByRole('combobox', { name: 'Akun' }).textContent, 'GoPay');
  assert.equal(
    (document.querySelector('input[name="date"]') as HTMLInputElement).value,
    '2026-10-30',
  );
  await user.clear(screen.getByRole('textbox', { name: /Nominal/ }));
  await user.type(screen.getByRole('textbox', { name: /Nominal/ }), '25rb');
  await user.click(screen.getByRole('button', { name: 'Simpan transaksi' }));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].amount, '25rb');
  assert.equal(saved[0].account_id, 'gopay');
  assert.equal(saved[0].category_id, 'food');
  assert.equal(saved[0].date, '2026-10-30');
});

test('missing photo fields stay empty and must be completed before saving', async (t) => {
  t.mock.method(URL, 'createObjectURL', () => 'blob:test-photo');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const user = userEvent.setup();
  render(
    <TransactionForm
      data={photoData}
      busy={false}
      photoScanner={async () => ({ text: 'Dana masuk\nRp350.000', confidence: 90 })}
      onSave={async () => assert.fail('No automatic save')}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Isi dari foto' }));
  await user.upload(
    screen.getByLabelText('Unggah foto transaksi') as HTMLInputElement,
    photoFile(),
  );
  await user.click(await screen.findByRole('button', { name: 'Gunakan hasil' }));
  const save = screen.getByRole('button', { name: 'Simpan transaksi' }) as HTMLButtonElement;
  assert.equal(save.disabled, true);
  assert.equal((document.querySelector('input[name="date"]') as HTMLInputElement).value, '');
  await user.click(screen.getByRole('combobox', { name: 'Akun' }));
  await user.click(screen.getByRole('option', { name: 'BNI' }));
  await user.click(screen.getByRole('combobox', { name: 'Kategori' }));
  await user.click(screen.getByRole('option', { name: 'Gaji' }));
  assert.equal(save.disabled, true);
  await user.click(screen.getByRole('button', { name: 'Tanggal' }));
  await user.click(screen.getByRole('button', { name: 'Hari ini' }));
  assert.equal(save.disabled, false);
});

test('photo internal transfers fill destination, principal and admin fee correctly', async (t) => {
  t.mock.method(URL, 'createObjectURL', () => 'blob:test-photo');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const user = userEvent.setup(),
    saved: Record<string, unknown>[] = [];
  render(
    <TransactionForm
      data={photoData}
      busy={false}
      photoScanner={async () => ({
        text: 'Transfer berhasil\nDari BNI\nKe GoPay\nNominal transfer Rp100.000\nBiaya admin Rp1.000\nTOTAL Rp101.000\n30/10/2026',
        confidence: 90,
      })}
      onSave={async (body) => {
        saved.push(body as Record<string, unknown>);
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Isi dari foto' }));
  await user.upload(
    screen.getByLabelText('Unggah foto transaksi') as HTMLInputElement,
    photoFile(),
  );
  await user.click(await screen.findByRole('button', { name: 'Gunakan hasil' }));
  assert.equal(saved.length, 0);
  assert.equal(screen.getByRole('combobox', { name: 'Ke akun' }).textContent, 'GoPay');
  await user.click(screen.getByRole('button', { name: 'Simpan transaksi' }));
  assert.equal(saved[0].kind, 'transfer');
  assert.equal(saved[0].amount, '100000');
  assert.equal(saved[0].fee, '1000');
  assert.equal(saved[0].to_account_id, 'gopay');
});

test('photo import rejects unsupported files and aborts pending scans when closed', async (t) => {
  t.mock.method(URL, 'createObjectURL', () => 'blob:test-photo');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  let signal: AbortSignal | undefined,
    calls = 0;
  const scanner: PhotoScanner = (_, options) => {
    calls++;
    signal = options.signal;
    return new Promise((_, reject) =>
      options.signal.addEventListener('abort', () =>
        reject(new DOMException('Cancelled', 'AbortError')),
      ),
    );
  };
  const user = userEvent.setup({ applyAccept: false });
  render(
    <PhotoImport
      data={photoData}
      scanner={scanner}
      onApply={() => assert.fail('No result should be applied')}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Isi dari foto' }));
  await user.upload(
    screen.getByLabelText('Unggah foto transaksi') as HTMLInputElement,
    new window.File(['pdf'], 'file.pdf', { type: 'application/pdf' }),
  );
  assert.match(screen.getByRole('alert').textContent ?? '', /JPG/);
  assert.equal(calls, 0);
  await user.upload(
    screen.getByLabelText('Unggah foto transaksi') as HTMLInputElement,
    photoFile(),
  );
  assert.equal(calls, 1);
  await user.click(screen.getByRole('button', { name: 'Batalkan' }));
  assert.equal(signal?.aborted, true);
  assert.equal(screen.queryByRole('dialog', { name: 'Baca transaksi dari foto' }), null);
});

test('custom select supports keyboard selection, restores focus, and submits its value', async () => {
  const user = userEvent.setup();
  render(
    <form data-testid="form">
      <SelectField
        name="account"
        label="Akun"
        defaultValue="bni"
        required
        options={[
          { value: 'bni', label: 'BNI' },
          { value: 'gopay', label: 'GoPay' },
        ]}
      />
    </form>,
  );
  const trigger = screen.getByRole('combobox', { name: 'Akun' });
  await user.click(trigger);
  assert.ok(screen.getByRole('listbox'));
  await user.keyboard('{End}{Enter}');
  assert.equal(new FormData(screen.getByTestId('form') as HTMLFormElement).get('account'), 'gopay');
  await waitFor(() => assert.equal(document.activeElement, trigger));
});

test('custom calendar month menu and day selection preserve the exact ISO form date', async () => {
  const user = userEvent.setup();
  render(
    <form data-testid="form">
      <DateField name="date" defaultValue="2026-10-30" />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Tanggal' }));
  assert.ok(screen.getByRole('dialog', { name: 'Pilih tanggal' }));
  await user.click(screen.getByRole('combobox', { name: 'Bulan' }));
  await user.click(screen.getByRole('option', { name: 'September' }));
  await user.click(screen.getByRole('button', { name: /15.*september.*2026/i }));
  assert.equal(
    new FormData(screen.getByTestId('form') as HTMLFormElement).get('date'),
    '2026-09-15',
  );
  await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Pilih tanggal' }), null));
  assert.match(screen.getByRole('button', { name: 'Tanggal' }).textContent ?? '', /15 Sep 2026/i);
});

test('select and calendar remain usable inside the transaction modal', async () => {
  const user = userEvent.setup();
  render(
    <Modal title="Editor" onClose={() => {}}>
      <form>
        <SelectField
          name="type"
          label="Jenis"
          defaultValue="bank"
          options={[
            { value: 'bank', label: 'Bank' },
            { value: 'cash', label: 'Tunai' },
          ]}
        />
        <DateField name="date" defaultValue="2026-10-30" />
      </form>
    </Modal>,
  );
  await user.click(screen.getByRole('combobox', { name: 'Jenis' }));
  await user.click(screen.getByRole('option', { name: 'Tunai' }));
  await user.click(screen.getByRole('button', { name: 'Tanggal' }));
  await user.click(screen.getByRole('button', { name: /15.*oktober.*2026/i }));
  assert.ok(screen.getByRole('dialog', { name: 'Editor' }));
  assert.equal(screen.getByRole('combobox', { name: 'Jenis' }).textContent, 'Tunai');
});

test('transaction kind switches submit the correct custom account, category, fee and date fields', async () => {
  const user = userEvent.setup();
  const data: Snapshot = {
    user: { id: 'user', username: 'test' },
    month: '2026-10',
    total: 0,
    transactions: [],
    recent: [],
    needs_setup: false,
    last_expense: null,
    quick_fills: [],
    summary: { income: 0, expense: 0 },
    accounts: [
      { id: 'bni', name: 'BNI', type: 'bank', initial_balance: 0, balance: 0, archived: false },
      {
        id: 'gopay',
        name: 'GoPay',
        type: 'ewallet',
        initial_balance: 0,
        balance: 0,
        archived: false,
      },
    ],
    categories: [
      { id: 'food', name: 'Makan', kind: 'expense', budget: null, spent: 0, total: 0, used: 0 },
      { id: 'salary', name: 'Gaji', kind: 'income', budget: null, spent: 0, total: 0, used: 0 },
    ],
  };
  const submissions: Record<string, unknown>[] = [];
  render(
    <TransactionForm
      data={data}
      busy={false}
      onSave={async (body) => {
        submissions.push(body as Record<string, unknown>);
      }}
    />,
  );
  await user.click(screen.getByRole('combobox', { name: 'Akun' }));
  assert.match(screen.getByRole('option', { name: 'BNI' }).textContent ?? '', /Rp0/);
  await user.keyboard('{Escape}');
  await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '100rb');
  await user.click(screen.getByRole('button', { name: 'Transfer' }));
  await user.click(screen.getByRole('combobox', { name: 'Ke akun' }));
  await user.click(screen.getByRole('option', { name: 'GoPay' }));
  await user.type(screen.getByRole('textbox', { name: 'Biaya admin' }), '1rb');
  await user.click(screen.getByRole('button', { name: 'Simpan transaksi' }));
  assert.equal(submissions[0]?.kind, 'transfer');
  assert.equal(submissions[0]?.account_id, 'bni');
  assert.equal(submissions[0]?.to_account_id, 'gopay');
  assert.equal(submissions[0]?.fee, '1rb');
  assert.match(String(submissions[0]?.date), /^\d{4}-\d{2}-\d{2}$/);
  await user.click(screen.getByRole('button', { name: 'Pemasukan' }));
  await user.click(screen.getByRole('button', { name: 'Simpan transaksi' }));
  assert.equal(submissions[1]?.kind, 'income');
  assert.equal(submissions[1]?.category_id, 'salary');
  assert.equal(submissions[1]?.fee, 0);
  assert.equal(submissions[1]?.to_account_id, null);
});

function SwipeExample({ onDelete, locked = false }: { onDelete: () => void; locked?: boolean }) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <>
      {['Kopi', 'Belanja'].map((name) => (
        <SwipeCategory
          key={name}
          name={name}
          canDelete={!locked}
          open={opened === name}
          onOpenChange={(open) =>
            setOpened((current) => (open ? name : current === name ? null : current))
          }
          onDelete={onDelete}
        >
          <span>{name}</span>
          <strong>Rp0</strong>
        </SwipeCategory>
      ))}
    </>
  );
}
function dragCategory(name: string, dx: number, dy = 0, cancel = false) {
  const surface = screen.getByText(name).closest('.category-row')!;
  fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(surface, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy });
  fireEvent[cancel ? 'pointerCancel' : 'pointerUp'](surface, {
    pointerId: 1,
    clientX: 200 + dx,
    clientY: 100 + dy,
  });
}

test('category swipe reveals delete without deleting, and only one row stays open', async () => {
  let deletions = 0;
  const user = userEvent.setup();
  render(<SwipeExample onDelete={() => deletions++} />);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
  assert.equal(document.querySelectorAll('.category-delete-action').length, 0);
  dragCategory('Kopi', -80);
  assert.ok(screen.getByRole('button', { name: 'Hapus Kopi' }));
  assert.equal(screen.getByRole('button', { name: 'Hapus Kopi' }).textContent, '');
  assert.ok(screen.getByRole('button', { name: 'Hapus Kopi' }).querySelector('svg'));
  assert.equal(deletions, 0);
  dragCategory('Belanja', -90);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
  await user.click(screen.getByRole('button', { name: 'Hapus Belanja' }));
  assert.equal(deletions, 1);
});

test('vertical scrolling, short swipes and cancelled drags do not expose category deletion', () => {
  render(<SwipeExample onDelete={() => assert.fail('No deletion expected')} />);
  dragCategory('Kopi', 80);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
  dragCategory('Kopi', -10, 70);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
  dragCategory('Kopi', -15);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
  dragCategory('Kopi', -80, 0, true);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
});

test('category deletion is keyboard accessible and used categories cannot be swiped', async () => {
  const user = userEvent.setup();
  const view = render(<SwipeExample onDelete={() => {}} />);
  screen.getByRole('group', { name: 'Kategori Kopi' }).focus();
  await user.keyboard('{ArrowLeft}');
  assert.ok(screen.getByRole('button', { name: 'Hapus Kopi' }));
  await user.keyboard('{Escape}');
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
  assert.equal(document.querySelectorAll('.category-delete-action').length, 0);
  view.unmount();
  render(<SwipeExample onDelete={() => assert.fail('Used category must be protected')} locked />);
  dragCategory('Kopi', -100);
  assert.equal(screen.queryByRole('button', { name: 'Hapus Kopi' }), null);
});

test('theme toggle works without View Transitions and remembers the choice', async () => {
  document.documentElement.dataset.theme = 'light';
  const user = userEvent.setup();
  render(<ThemeButton />);
  await user.click(screen.getByRole('button', { name: 'Ganti tema' }));
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(localStorage.getItem('money-theme'), 'dark');
  await user.click(screen.getByRole('button', { name: 'Ganti tema' }));
  assert.equal(document.documentElement.dataset.theme, 'light');
});

test('theme uses a transition when available and skips it for reduced motion', async () => {
  let calls = 0;
  const original = document.startViewTransition;
  const originalMedia = window.matchMedia;
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(globalThis, 'innerHeight', { value: 800, configurable: true });
  document.startViewTransition = ((update: () => void) => {
    calls++;
    update();
    return {
      finished: Promise.resolve(),
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition() {},
    };
  }) as typeof document.startViewTransition;
  document.documentElement.dataset.theme = 'light';
  const user = userEvent.setup();
  render(<ThemeButton />);
  try {
    await user.click(screen.getByRole('button', { name: 'Ganti tema' }));
    assert.equal(calls, 1);
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.ok(document.documentElement.style.getPropertyValue('--theme-radius'));
    window.matchMedia = ((query: string) => ({
      ...originalMedia(query),
      matches: query.includes('prefers-reduced-motion'),
    })) as typeof window.matchMedia;
    await user.click(screen.getByRole('button', { name: 'Ganti tema' }));
    assert.equal(calls, 1);
    assert.equal(document.documentElement.dataset.theme, 'light');
  } finally {
    document.startViewTransition = original;
    window.matchMedia = originalMedia;
  }
});
