'use client';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { SelectField, DateField } from './pickers';
import { accountOptions, categoryOptions } from './transaction-options';
import { PhotoImport } from './photo-import';
import type { PhotoDraft } from '@money/core/photo-transaction';
import type { PhotoScanner } from '../lib/scan-photo';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import {
  categorySchema,
  parseAmount,
  rupiah,
  today,
  type Snapshot,
  type Transaction,
  type Account,
} from '@money/core';
export function AmountInput({
  name,
  value,
  placeholder = '25rb, 25.000, 1,5jt',
  required = false,
  onValueChange,
}: {
  name: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  let preview = '';
  if (text) {
    try {
      preview = `= ${rupiah(parseAmount(text))}`;
    } catch {
      preview = 'Format belum valid';
    }
  }
  return (
    <>
      <input
        name={name}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onValueChange?.(e.target.value);
        }}
        autoComplete="off"
        placeholder={placeholder}
        required={required}
      />
      <small key={preview} className="amount-preview" aria-live="polite">
        {preview}
      </small>
    </>
  );
}
export { Modal } from './modal';
export function CategoryForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
}) {
  const [kind, setKind] = useState('expense');
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const result = categorySchema.safeParse({
          name: form.get('name'),
          kind,
          budget: kind === 'expense' ? String(form.get('budget') ?? '').trim() || null : null,
        });
        setError(result.success ? '' : result.error.issues[0].message);
        if (result.success) await onSave(result.data);
      }}
    >
      <label>
        Nama kategori
        <input name="name" required maxLength={50} placeholder="Contoh: Kopi" />
      </label>
      <label>
        Jenis
        <SelectField
          name="kind"
          label="Jenis kategori"
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setError('');
          }}
          disabled={busy}
          options={[
            { value: 'expense', label: 'Pengeluaran' },
            { value: 'income', label: 'Pemasukan' },
          ]}
        />
      </label>
      {kind === 'expense' && (
        <>
          <label>
            Batas anggaran bulanan (opsional)
            <AmountInput name="budget" placeholder="Contoh: 500rb" />
          </label>
          <p className="muted">Berlaku setiap bulan. Kosongkan jika tanpa batas.</p>
        </>
      )}
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Tambah kategori'}
      </button>
    </form>
  );
}
export function TransactionForm({
  data,
  tx,
  quick,
  busy,
  onSave,
  onDelete,
  photoScanner,
}: {
  data: Snapshot;
  tx?: Transaction;
  quick?: Snapshot['quick_fills'][number];
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
  onDelete?: () => void;
  photoScanner?: PhotoScanner;
}) {
  const [kind, setKind] = useState(tx?.kind ?? 'expense');
  const [amount, setAmount] = useState<string | number>(tx?.amount ?? quick?.amount ?? '');
  const [account, setAccount] = useState(
    tx?.account_id ??
      quick?.account_id ??
      data.last_expense?.account_id ??
      data.accounts.find((a) => !a.archived)?.id ??
      '',
  );
  const [category, setCategory] = useState(
    tx?.category_id ?? quick?.category_id ?? data.last_expense?.category_id ?? '',
  );
  const [note, setNote] = useState(tx?.note ?? quick?.note ?? '');
  const [date, setDate] = useState(tx?.date ?? today());
  const [toAccount, setToAccount] = useState(tx?.to_account_id ?? '');
  const [fee, setFee] = useState<string | number>(tx?.fee ?? '');
  const [photoApplied, setPhotoApplied] = useState(false);
  function applyPhoto(draft: PhotoDraft) {
    if (!draft.kind) return;
    setKind(draft.kind);
    setAmount(draft.amount ?? '');
    setAccount(draft.account_id ?? '');
    setCategory(draft.category_id ?? '');
    setToAccount(draft.to_account_id ?? '');
    setFee(draft.fee || '');
    setNote(draft.note);
    setDate(draft.date ?? '');
    setPhotoApplied(true);
  }
  useEffect(() => {
    if (quick) {
      setKind('expense');
      setAmount(quick.amount);
      setAccount(quick.account_id);
      setCategory(quick.category_id ?? '');
      setNote(quick.note);
      setDate(today());
      setToAccount('');
      setFee('');
      setPhotoApplied(false);
    }
  }, [quick]);
  const accounts = data.accounts.filter((a) => tx || !a.archived);
  const categories = data.categories.filter((c) => c.kind === kind);
  const chosenCategory = categories.some((c) => c.id === category)
    ? category
    : photoApplied
      ? ''
      : (categories[0]?.id ?? '');
  const incompletePhoto =
    photoApplied && (!date || !account || (kind === 'transfer' ? !toAccount : !chosenCategory));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    await onSave({
      ...body,
      kind,
      account_id: account,
      category_id: kind === 'transfer' ? null : chosenCategory,
      to_account_id: kind === 'transfer' ? body.to_account_id : null,
      fee: kind === 'transfer' ? body.fee || 0 : 0,
    });
  };
  if (tx?.kind === 'adjustment')
    return (
      <div className="stack">
        <p>
          Penyesuaian saldo {tx.account_name}: <strong>{rupiah(tx.amount)}</strong>
        </p>
        <p className="muted">{tx.note}</p>
        <p className="muted">Untuk memperbaiki, hapus lalu cocokkan ulang.</p>
        <button className="btn danger" disabled={busy} onClick={onDelete}>
          Hapus penyesuaian
        </button>
      </div>
    );
  if (tx?.parent_transfer_id)
    return (
      <div className="stack">
        <p>Untuk mengubah atau menghapus biaya admin, buka transaksi transfer asal.</p>
      </div>
    );
  return (
    <form className="stack transaction-form" onSubmit={submit}>
      {!tx && (
        <PhotoImport data={data} onApply={applyPhoto} disabled={busy} scanner={photoScanner} />
      )}
      {photoApplied && (
        <p className="photo-applied" role="status">
          {incompletePhoto
            ? 'Lengkapi kolom yang belum terbaca sebelum menyimpan.'
            : 'Diisi dari foto. Periksa kembali sebelum menyimpan.'}
        </p>
      )}
      <div
        className="segmented"
        role="group"
        aria-label="Jenis transaksi"
        style={{ '--segment': ['expense', 'income', 'transfer'].indexOf(kind) } as CSSProperties}
      >
        <span className="segment-indicator" aria-hidden="true" />
        {[
          ['expense', 'Pengeluaran', ArrowDownLeft],
          ['income', 'Pemasukan', ArrowUpRight],
          ['transfer', 'Transfer', ArrowLeftRight],
        ].map(([value, label, Icon]) => {
          const Glyph = Icon as typeof ArrowDownLeft;
          return (
            <button
              key={value as string}
              type="button"
              className={kind === value ? `selected ${value}` : ''}
              aria-pressed={kind === value}
              onClick={() => setKind(value as Transaction['kind'])}
            >
              <Glyph size={16} />
              {label as string}
            </button>
          );
        })}
      </div>
      <label>
        Nominal
        <AmountInput name="amount" value={amount} onValueChange={setAmount} required />
      </label>
      <div className="form-row">
        <label>
          {kind === 'transfer' ? 'Dari akun' : 'Akun'}
          <SelectField
            name="account_id"
            label={kind === 'transfer' ? 'Dari akun' : 'Akun'}
            value={account}
            onValueChange={(next) => {
              setAccount(next);
              if (toAccount === next) setToAccount('');
            }}
            required
            options={accountOptions(accounts)}
          />
        </label>
        {kind === 'transfer' ? (
          <label>
            Ke akun
            <SelectField
              name="to_account_id"
              label="Ke akun"
              value={toAccount}
              onValueChange={setToAccount}
              required
              placeholder="Pilih tujuan"
              options={accountOptions(accounts.filter((a) => a.id !== account))}
            />
          </label>
        ) : (
          <label>
            Kategori
            <SelectField
              key={kind}
              name="category_id"
              label="Kategori"
              value={chosenCategory}
              onValueChange={setCategory}
              required
              placeholder="Pilih kategori"
              options={categoryOptions(categories)}
            />
          </label>
        )}
      </div>
      {kind === 'transfer' && (
        <label>
          Biaya admin
          <AmountInput name="fee" value={fee} onValueChange={setFee} placeholder="Contoh: 1rb" />
        </label>
      )}
      <div className="form-row">
        <label>
          Catatan
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Contoh: makan siang"
          />
        </label>
        <label>
          Tanggal
          <DateField name="date" value={date} onValueChange={setDate} />
        </label>
      </div>
      <button
        className="btn primary full"
        disabled={
          busy ||
          !accounts.length ||
          (!categories.length && kind !== 'transfer') ||
          !!incompletePhoto
        }
      >
        {busy ? 'Menyimpan…' : tx ? 'Simpan perubahan' : 'Simpan transaksi'}
      </button>
      {tx && (
        <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
          Hapus transaksi
        </button>
      )}
    </form>
  );
}
export function AccountForm({
  account,
  busy,
  onSave,
}: {
  account?: Account;
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
}) {
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <label>
        Nama akun
        <input
          name="name"
          defaultValue={account?.name}
          placeholder="Contoh: BCA"
          maxLength={50}
          required
        />
      </label>
      <label>
        Jenis
        <SelectField
          name="type"
          label="Jenis akun"
          defaultValue={account?.type ?? 'bank'}
          options={[
            { value: 'bank', label: 'Bank' },
            { value: 'ewallet', label: 'E-wallet' },
            { value: 'cash', label: 'Tunai' },
          ]}
        />
      </label>
      <label>
        Saldo awal
        <AmountInput name="initial_balance" value={account?.initial_balance ?? 0} />
        <small className="muted">Saldo sebelum transaksi pertama.</small>
      </label>
      <button className="btn primary" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan akun'}
      </button>
    </form>
  );
}
