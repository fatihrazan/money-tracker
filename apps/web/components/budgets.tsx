'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Pencil, Wallet } from 'lucide-react';
import {
  budgetsSchema,
  budgetState,
  dateRangeSchema,
  rupiah,
  type Category,
  type DateRange,
} from '@money/core';
import { AmountInput } from './forms';
import { DateField, SelectField } from './pickers';

export function BudgetPeriod({
  month,
  range,
  onChange,
  children,
}: {
  month: string;
  range?: DateRange;
  onChange: (range?: DateRange) => void;
  children: React.ReactNode;
}) {
  const [custom, setCustom] = useState(Boolean(range));
  const [error, setError] = useState('');
  const lastDay = new Date(`${month}-01T00:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  return (
    <div className="stack">
      <label>
        Periode
        <SelectField
          label="Jenis periode anggaran"
          value={custom ? 'dates' : 'month'}
          options={[
            { value: 'month', label: 'Bulan kalender' },
            { value: 'dates', label: 'Rentang tanggal' },
          ]}
          onValueChange={(value) => {
            setCustom(value === 'dates');
            setError('');
            if (value === 'month') onChange(undefined);
          }}
        />
      </label>
      {custom ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const result = dateRangeSchema.safeParse({
              start: form.get('start'),
              end: form.get('end'),
            });
            setError(result.success ? '' : result.error.issues[0].message);
            if (result.success) onChange(result.data);
          }}
        >
          <div className="form-row">
            <label>
              Tanggal mulai
              <DateField
                name="start"
                label="Tanggal mulai"
                defaultValue={range?.start ?? `${month}-01`}
              />
            </label>
            <label>
              Tanggal selesai
              <DateField
                name="end"
                label="Tanggal selesai"
                defaultValue={range?.end ?? lastDay.toISOString().slice(0, 10)}
              />
            </label>
          </div>
          <small className="muted">Tanggal mulai dan selesai ikut dihitung dalam anggaran.</small>
          {error && (
            <p className="flash error" role="alert">
              {error}
            </p>
          )}
          <button className="btn" type="submit">
            Terapkan periode
          </button>
        </form>
      ) : (
        children
      )}
    </div>
  );
}

export function BudgetForm({
  effectiveMonth,
  categories,
  category,
  busy,
  onSave,
}: {
  categories: Category[];
  category?: Category;
  effectiveMonth?: string;
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
}) {
  const expenses = categories.filter((c) => c.kind === 'expense');
  const [id, setId] = useState(
    category?.id ?? expenses.find((c) => c.budget === null)?.id ?? expenses[0]?.id ?? '',
  );
  const [error, setError] = useState('');
  const selected = expenses.find((c) => c.id === id);
  if (!selected)
    return (
      <div className="empty">
        <p>Tambahkan kategori pengeluaran untuk membuat anggaran.</p>
        <Link href="/categories" className="btn primary">
          Kelola kategori
        </Link>
      </div>
    );
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const result = budgetsSchema.safeParse([
          { id, budget: String(form.get('budget') ?? '').trim() || null },
        ]);
        setError(result.success ? '' : result.error.issues[0].message);
        if (result.success) await onSave(result.data);
      }}
    >
      <label>
        Kategori pengeluaran
        <SelectField
          label="Kategori anggaran"
          value={id}
          required
          disabled={busy}
          options={expenses.map((c) => ({ value: c.id, label: c.name }))}
          onValueChange={(value) => {
            setId(value);
            setError('');
          }}
        />
      </label>
      <label>
        Batas anggaran bulanan
        <AmountInput
          key={id}
          name="budget"
          value={selected.budget ?? ''}
          placeholder="Contoh: 500rb"
        />
      </label>
      <p className="muted">
        Perubahan berlaku mulai {effectiveMonth ?? 'bulan terpilih'} hingga perubahan berikutnya.
        Kosongkan untuk menghapus batas mulai bulan tersebut.
      </p>
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan anggaran'}
      </button>
    </form>
  );
}

export function BudgetOverview({
  categories,
  onEdit,
  onCreate,
  busy = false,
}: {
  categories: Category[];
  onEdit?: (category: Category) => void;
  onCreate?: () => void;
  busy?: boolean;
}) {
  const rows = categories.filter((c) => c.kind === 'expense' && c.budget !== null);
  if (!rows.length)
    return (
      <div className="empty">
        <Wallet size={32} />
        <strong>Belum ada anggaran</strong>
        <p className="muted">
          Tentukan batas per kategori untuk memantau sisa anggaran setiap bulan.
        </p>
        {onCreate ? (
          <button className="btn primary" onClick={onCreate} disabled={busy}>
            Tambah anggaran
          </button>
        ) : (
          <Link href="/budgets" className="btn primary">
            Buat anggaran
          </Link>
        )}
      </div>
    );
  const total = rows.reduce(
    (value, c) => ({ budget: value.budget + c.budget!, spent: value.spent + c.spent }),
    { budget: 0, spent: 0 },
  );
  const left = total.budget - total.spent;
  const overCount = rows.filter((c) => c.spent > c.budget!).length;
  return (
    <>
      <div className="budget-total">
        <small>{left < 0 ? 'Total kelebihan anggaran' : 'Total sisa anggaran'}</small>
        <strong className={left < 0 ? 'negative' : ''}>{rupiah(Math.abs(left))}</strong>
        <p className="muted">
          Terpakai {rupiah(total.spent)} dari batas {rupiah(total.budget)}
        </p>
        <progress
          value={Math.min(total.spent, total.budget)}
          max={total.budget}
          aria-label="Total anggaran terpakai"
        />
        <small className="muted">
          Hanya menghitung {rows.length} kategori yang memiliki batas.
        </small>
        {overCount > 0 && (
          <small className="negative">{overCount} kategori melewati batas anggaran.</small>
        )}
      </div>
      <div className="budget-grid">
        {rows.map((c) => {
          const budget = budgetState(c.budget!, c.spent);
          const status =
            budget.left < 0
              ? 'Terlewati'
              : budget.left === 0
                ? 'Habis'
                : budget.state === 'warn'
                  ? 'Hampir habis'
                  : 'Aman';
          return (
            <article
              className={`budget-item ${budget.state}`}
              key={c.id}
              aria-label={`Anggaran ${c.name}`}
            >
              <div className="section-head">
                <strong>{c.name}</strong>
                <span className="badge">{status}</span>
              </div>
              <div className="budget-remaining">
                <small>{budget.left < 0 ? 'Melebihi anggaran' : 'Sisa anggaran'}</small>
                <strong className={budget.left < 0 ? 'negative' : ''}>
                  {rupiah(Math.abs(budget.left))}
                </strong>
              </div>
              <dl className="budget-details">
                <div>
                  <dt>Terpakai</dt>
                  <dd>{rupiah(c.spent)}</dd>
                </div>
                <div>
                  <dt>Batas bulanan</dt>
                  <dd>{rupiah(c.budget!)}</dd>
                </div>
              </dl>
              <progress
                value={Math.min(c.spent, c.budget!)}
                max={c.budget!}
                aria-label={`Anggaran ${c.name} terpakai`}
              />
              <div className="budget-footer">
                <small>{budget.percent}% terpakai</small>
                {onEdit && (
                  <button
                    className="btn small"
                    aria-label={`Ubah anggaran ${c.name}`}
                    onClick={() => onEdit(c)}
                    disabled={busy}
                  >
                    <Pencil size={14} /> Ubah batas
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
