import './ui-dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { today, shiftMonth, monthLabel, type Category, type Snapshot } from '@money/core';
import { BudgetForm, BudgetOverview } from '../apps/web/components/budgets';
import { CategoryForm } from '../apps/web/components/forms';
import { Workspace } from '../apps/web/components/workspace';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
const food: Category = {
  id: 'e404bad9-53c9-44ed-afd5-c3d861350e67',
  name: 'Makan',
  kind: 'expense',
  budget: 500000,
  spent: 125000,
  total: 125000,
  used: 1,
};
const travel: Category = {
  ...food,
  id: 'bb3f83cb-1156-4c6b-9472-543bc0b81cda',
  name: 'Transportasi',
  budget: null,
  spent: 20000,
};

test('creating a category includes its budget, and switching to income removes it', async () => {
  const user = userEvent.setup();
  const saved: unknown[] = [];
  render(
    <CategoryForm
      busy={false}
      onSave={async (body) => {
        saved.push(body);
      }}
    />,
  );
  await user.type(screen.getByRole('textbox', { name: 'Nama kategori' }), 'Kopi');
  await user.type(screen.getByRole('textbox', { name: /Batas anggaran/ }), '300rb');
  await user.click(screen.getByRole('button', { name: 'Tambah kategori' }));
  assert.deepEqual(saved[0], { name: 'Kopi', kind: 'expense', budget: 300000 });
  await user.click(screen.getByRole('combobox', { name: 'Jenis kategori' }));
  await user.click(screen.getByRole('option', { name: 'Pemasukan' }));
  assert.equal(screen.queryByRole('textbox', { name: /Batas anggaran/ }), null);
  await user.click(screen.getByRole('button', { name: 'Tambah kategori' }));
  assert.deepEqual(saved[1], { name: 'Kopi', kind: 'income', budget: null });
});

test('editing a budget validates amounts and clearing it removes only the selected limit', async () => {
  const user = userEvent.setup();
  const saved: unknown[] = [];
  render(
    <BudgetForm
      categories={[food, travel]}
      category={food}
      busy={false}
      onSave={async (body) => {
        saved.push(body);
      }}
    />,
  );
  const input = screen.getByRole('textbox', { name: /Batas anggaran/ });
  assert.equal((input as HTMLInputElement).value, '500000');
  await user.clear(input);
  await user.type(input, '0');
  await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
  assert.match(screen.getByRole('alert').textContent!, /lebih dari Rp0/);
  assert.equal(saved.length, 0);
  await user.clear(input);
  await user.type(input, '750rb');
  await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
  assert.deepEqual(saved[0], [{ id: food.id, budget: 750000 }]);
  await user.clear(input);
  await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
  assert.deepEqual(saved[1], [{ id: food.id, budget: null }]);
  await user.click(screen.getByRole('combobox', { name: 'Kategori anggaran' }));
  await user.click(screen.getByRole('option', { name: 'Transportasi' }));
  assert.equal(
    (screen.getByRole('textbox', { name: /Batas anggaran/ }) as HTMLInputElement).value,
    '',
  );
  await user.type(screen.getByRole('textbox', { name: /Batas anggaran/ }), '200rb');
  await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
  assert.deepEqual(saved[2], [{ id: travel.id, budget: 200000 }]);
});

test('budget tracking shows remaining, near-limit, exact-limit and overspent states', () => {
  const { rerender } = render(<BudgetOverview categories={[food, travel]} />);
  let card = within(screen.getByRole('article', { name: 'Anggaran Makan' }));
  assert.ok(card.getByText('Rp375.000'));
  assert.ok(card.getByText('Aman'));
  assert.equal(screen.queryByRole('article', { name: 'Anggaran Transportasi' }), null);
  rerender(<BudgetOverview categories={[{ ...food, spent: 400000 }]} />);
  assert.ok(card.getByText('Hampir habis'));
  assert.ok(card.getByText('Rp100.000'));
  rerender(<BudgetOverview categories={[{ ...food, spent: 500000 }]} />);
  assert.ok(card.getByText('Habis'));
  assert.ok(card.getByText('Rp0'));
  rerender(
    <BudgetOverview
      categories={[
        { ...food, spent: 550000 },
        { ...travel, budget: 500000 },
      ]}
    />,
  );
  card = within(screen.getByRole('article', { name: 'Anggaran Makan' }));
  assert.ok(card.getByText('Terlewati'));
  assert.ok(card.getByText('Melebihi anggaran'));
  assert.ok(card.getByText('Rp50.000'));
  assert.ok(card.getByText('110% terpakai'));
  assert.equal((card.getByRole('progressbar') as HTMLProgressElement).value, 500000);
  assert.ok(screen.getByText('1 kategori melewati batas anggaran.'));
});

test('empty budgets provide a create action and missing expense categories guide setup', async () => {
  const user = userEvent.setup();
  let opened = false;
  const { unmount } = render(
    <BudgetOverview
      categories={[travel]}
      onCreate={() => {
        opened = true;
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Tambah anggaran' }));
  assert.equal(opened, true);
  unmount();
  render(
    <BudgetForm categories={[]} busy={false} onSave={async () => assert.fail('No category')} />,
  );
  assert.equal(
    screen.getByRole('link', { name: 'Kelola kategori' }).getAttribute('href'),
    '/categories',
  );
  assert.equal(screen.queryByRole('button', { name: 'Simpan anggaran' }), null);
});

test('budget page saves a limit, refreshes totals, and fetches the selected month', async (t) => {
  const user = userEvent.setup();
  const current = today().slice(0, 7);
  const previous = shiftMonth(current, -1);
  const limits = new Map<string, number | null>();
  let userId = 'user';
  const requests: string[] = [];
  const saved: unknown[] = [];
  const router = {
    bfcacheId: 'budget-test',
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace() {},
    prefetch: async () => {},
  };
  t.mock.method(globalThis, 'fetch', async (path: string, options?: RequestInit) => {
    requests.push(path);
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body));
      saved.push(body);
      limits.set(new URL(path, 'http://localhost').searchParams.get('month')!, body[0].budget);
      return Response.json({ data: { message: 'Anggaran disimpan.' } });
    }
    const params = new URL(path, 'http://localhost').searchParams;
    const selectedMonth = params.get('month')!;
    const data: Snapshot = {
      user: { id: userId, username: 'test' },
      month: selectedMonth,
      total: 0,
      categories: [
        {
          ...food,
          budget: limits.get(selectedMonth) ?? food.budget,
          spent: params.has('start') ? 250000 : selectedMonth === current ? 125000 : 50000,
        },
        travel,
      ],
      accounts: [],
      transactions: [],
      recent: [],
      quick_fills: [],
      needs_setup: false,
      last_expense: null,
      summary: { income: 0, expense: 0 },
    };
    return Response.json({ data });
  });
  const mount = (section = 'budgets') =>
    render(
      <AppRouterContext.Provider value={router}>
        <SearchParamsContext.Provider value={new URLSearchParams()}>
          <Workspace section={section} />
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>,
    );
  let view = mount();
  const card = within(await screen.findByRole('article', { name: 'Anggaran Makan' }));
  assert.ok(card.getByText('Rp375.000'));
  await user.click(screen.getByRole('button', { name: 'Ubah anggaran Makan' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.clear(dialog.getByRole('textbox', { name: /Batas anggaran/ }));
  await user.type(dialog.getByRole('textbox', { name: /Batas anggaran/ }), '600rb');
  await user.click(dialog.getByRole('button', { name: 'Simpan anggaran' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(saved, [[{ id: food.id, budget: 600000 }]]);
  await waitFor(() => assert.ok(card.getByText('Rp475.000')));
  await user.click(screen.getByRole('button', { name: 'Bulan sebelumnya' }));
  await waitFor(() => assert.ok(card.getByText('Rp450.000')));
  assert.ok(screen.getByText(monthLabel(previous), { selector: '.month-nav strong' }));
  assert.ok(requests.includes(`/api/v1/snapshot?month=${previous}&view=budgets`));
  await user.click(screen.getByRole('button', { name: 'Bulan berikutnya' }));
  await waitFor(() => assert.ok(card.getByText('Rp475.000')));
  await user.click(screen.getByRole('combobox', { name: 'Jenis periode anggaran' }));
  await user.click(screen.getByRole('option', { name: 'Rentang tanggal' }));
  async function chooseDate(label: string, month: string, day: number) {
    await user.click(screen.getByRole('button', { name: label }));
    await user.click(screen.getByRole('combobox', { name: 'Tahun' }));
    await user.click(screen.getByRole('option', { name: '2026' }));
    await user.click(screen.getByRole('combobox', { name: 'Bulan' }));
    await user.click(screen.getByRole('option', { name: month }));
    await user.click(
      screen.getByRole('button', { name: new RegExp(`${day}.*${month}.*2026`, 'i') }),
    );
    await waitFor(() =>
      assert.equal(screen.queryByRole('dialog', { name: 'Pilih tanggal' }), null),
    );
  }
  await chooseDate('Tanggal mulai', 'Oktober', 23);
  await chooseDate('Tanggal selesai', 'Oktober', 22);
  await user.click(screen.getByRole('button', { name: 'Terapkan periode' }));
  assert.match(screen.getByRole('alert').textContent!, /Tanggal selesai/);
  assert.equal(
    requests.some((path) => path.includes('&start=')),
    false,
  );
  await chooseDate('Tanggal selesai', 'November', 23);
  await user.click(screen.getByRole('button', { name: 'Terapkan periode' }));
  await waitFor(() =>
    assert.ok(
      requests.includes(
        `/api/v1/snapshot?month=${current}&start=2026-10-23&end=2026-11-23&view=budgets`,
      ),
    ),
  );
  assert.ok(screen.getByText(/Pengeluaran 23 Oktober 2026 – 23 November 2026/));
  assert.deepEqual(JSON.parse(localStorage.getItem('money-budget-period:user')!), {
    month: current,
    range: { start: '2026-10-23', end: '2026-11-23' },
  });
  assert.ok(card.getByText('Rp350.000'));
  view.unmount();
  requests.length = 0;
  view = mount('dashboard');
  const dashboardBudget = within(await screen.findByRole('article', { name: 'Anggaran Makan' }));
  assert.ok(dashboardBudget.getByText('Rp350.000'));
  assert.ok(screen.getByText('23 Oktober 2026 – 23 November 2026'));
  assert.ok(screen.getByText(`Arus uang · ${monthLabel(current)}`));
  assert.deepEqual(requests, [
    `/api/v1/snapshot?month=${current}&view=dashboard`,
    `/api/v1/snapshot?month=${current}&start=2026-10-23&end=2026-11-23&view=budgets`,
  ]);
  view.unmount();
  requests.length = 0;
  view = mount();
  await screen.findByRole('article', { name: 'Anggaran Makan' });
  assert.equal(
    requests.at(-1),
    `/api/v1/snapshot?month=${current}&start=2026-10-23&end=2026-11-23&view=budgets`,
  );
  assert.match(
    screen.getByRole('combobox', { name: 'Jenis periode anggaran' }).textContent!,
    /Rentang tanggal/,
  );
  assert.match(screen.getByRole('button', { name: 'Tanggal mulai' }).textContent!, /23 Okt 2026/);
  assert.match(screen.getByRole('button', { name: 'Tanggal selesai' }).textContent!, /23 Nov 2026/);
  await user.click(screen.getByRole('combobox', { name: 'Jenis periode anggaran' }));
  await user.click(screen.getByRole('option', { name: 'Bulan kalender' }));
  await waitFor(() =>
    assert.equal(requests.at(-1), `/api/v1/snapshot?month=${current}&view=budgets`),
  );
  assert.ok(screen.getByRole('button', { name: 'Bulan sebelumnya' }));
  await user.click(screen.getByRole('button', { name: 'Bulan sebelumnya' }));
  await waitFor(() =>
    assert.equal(requests.at(-1), `/api/v1/snapshot?month=${previous}&view=budgets`),
  );
  view.unmount();
  requests.length = 0;
  view = mount('dashboard');
  assert.ok(
    within(await screen.findByRole('article', { name: 'Anggaran Makan' })).getByText('Rp450.000'),
  );
  assert.ok(screen.getByText(monthLabel(previous)));
  assert.deepEqual(requests, [
    `/api/v1/snapshot?month=${current}&view=dashboard`,
    `/api/v1/snapshot?month=${previous}&view=budgets`,
  ]);
  view.unmount();
  view = mount('categories');
  await screen.findByRole('article', { name: 'Anggaran Makan' });
  assert.ok(screen.getByText(monthLabel(previous), { selector: '.month-nav strong' }));
  assert.match(
    screen.getByRole('combobox', { name: 'Jenis periode anggaran' }).textContent!,
    /Bulan kalender/,
  );
  view.unmount();
  userId = 'other-user';
  view = mount();
  await screen.findByRole('article', { name: 'Anggaran Makan' });
  assert.ok(screen.getByText(monthLabel(current), { selector: '.month-nav strong' }));
  view.unmount();
  localStorage.setItem('money-budget-period:other-user', '{invalid');
  view = mount();
  await screen.findByRole('article', { name: 'Anggaran Makan' });
  assert.ok(screen.getByRole('button', { name: 'Bulan sebelumnya' }));
});
