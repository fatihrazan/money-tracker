import { z } from 'zod';

export const MAX_AMOUNT = 9_000_000_000_000;
export function parseAmount(text: string | number): number {
  if (typeof text === 'number') {
    if (!Number.isSafeInteger(text) || Math.abs(text) > MAX_AMOUNT)
      throw new Error('Nominal terlalu besar atau tidak valid.');
    return text;
  }
  let s = text.trim().toLowerCase().replace(/\s/g, '');
  const sign = s.startsWith('-') ? -1 : 1;
  if (sign === -1) s = s.slice(1);
  s = s.replace(/^rp/, '');
  const match = /^(\d[\d.,]*)(rb|ribu|k|jt|juta)?$/.exec(s);
  if (!match) throw new Error('Nominal tidak valid. Contoh: 25rb, 25.000, 1,5jt.');
  let value: bigint;
  if (match[2]) {
    if (!/^\d+(?:[.,]\d+)?$/.test(match[1])) throw new Error('Nominal tidak valid.');
    const [whole, fraction = ''] = match[1].split(/[.,]/);
    if (whole.length + fraction.length > 30) throw new Error('Nominal terlalu besar.');
    const scale = 10n ** BigInt(fraction.length);
    const multiplier = ['jt', 'juta'].includes(match[2]) ? 1_000_000n : 1_000n;
    const raw = BigInt(whole + fraction) * multiplier;
    if (raw % scale !== 0n) throw new Error('Nominal harus berupa Rupiah bulat.');
    value = raw / scale;
  } else {
    if (
      !/^\d+$/.test(match[1]) &&
      !/^\d{1,3}(\.\d{3})+$/.test(match[1]) &&
      !/^\d{1,3}(,\d{3})+$/.test(match[1])
    )
      throw new Error('Pemisah ribuan tidak valid.');
    const digits = match[1].replace(/[.,]/g, '');
    if (digits.length > 16) throw new Error('Nominal terlalu besar.');
    value = BigInt(digits);
  }
  if (value > BigInt(MAX_AMOUNT)) throw new Error('Nominal terlalu besar.');
  return Number(value) * sign;
}
export const rupiah = (n: number) => `${n < 0 ? '-' : ''}Rp${Math.abs(n).toLocaleString('id-ID')}`;
export function today(timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
const amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return parseAmount(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return (
      !Number.isNaN(d.valueOf()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= '1900-01-01' &&
      v <= '9998-12-31'
    );
  }, 'Tanggal tidak valid.');
export const dateRangeSchema = z
  .object({ start: dateSchema, end: dateSchema })
  .refine((v) => v.end >= v.start, {
    message: 'Tanggal selesai harus sama dengan atau setelah tanggal mulai.',
    path: ['end'],
  });
export type DateRange = z.infer<typeof dateRangeSchema>;

export const monthSchema = z
  .string()
  .regex(/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/)
  .refine((v) => v < '9999-01');
export const accountSchema = z.object({
  name: z.string().trim().min(1).max(50),
  type: z.enum(['bank', 'ewallet', 'cash']),
  initial_balance: amount.default(0),
});
const budgetAmount = amount.refine((v) => v > 0, 'Anggaran harus lebih dari Rp0.').nullable();
export const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    kind: z.enum(['expense', 'income']),
    budget: budgetAmount.default(null),
  })
  .refine((v) => v.kind === 'expense' || v.budget === null, {
    message: 'Anggaran hanya untuk kategori pengeluaran.',
    path: ['budget'],
  });
export const transactionSchema = z
  .object({
    kind: z.enum(['expense', 'income', 'transfer']),
    amount: amount.refine((v) => v > 0, 'Nominal harus lebih dari Rp0.'),
    account_id: z.uuid(),
    to_account_id: z.uuid().nullable().optional(),
    category_id: z.uuid().nullable().optional(),
    note: z.string().trim().max(200).default(''),
    date: dateSchema,
    fee: amount.refine((v) => v >= 0, 'Biaya tidak boleh negatif.').default(0),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'transfer' && (!v.to_account_id || v.account_id === v.to_account_id))
      ctx.addIssue({ code: 'custom', message: 'Pilih akun tujuan yang berbeda.' });
    if (v.kind !== 'transfer' && !v.category_id)
      ctx.addIssue({ code: 'custom', message: 'Pilih kategori.' });
    if (v.kind !== 'transfer' && v.fee)
      ctx.addIssue({ code: 'custom', message: 'Biaya hanya untuk transfer.' });
  });
export const signupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9_.]{3,30}$/,
        'Nama pengguna 3–30 karakter: huruf, angka, titik, atau garis bawah.',
      ),
    password: z.string().min(8).max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, 'Konfirmasi kata sandi tidak sama.');
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(30),
  password: z.string().min(1).max(128),
});
export const reconcileSchema = z.object({ actual: amount });
export const budgetsSchema = z.array(z.object({ id: z.uuid(), budget: budgetAmount })).max(500);
export type TransactionInput = z.infer<typeof transactionSchema>;
export type Account = {
  id: string;
  name: string;
  type: 'bank' | 'ewallet' | 'cash';
  initial_balance: number;
  balance: number;
  archived: boolean;
};
export type Category = {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  budget: number | null;
  spent: number;
  used: number;
  total: number;
};
export type Transaction = {
  id: string;
  source?: 'manual' | 'gmail';
  kind: 'expense' | 'income' | 'transfer' | 'adjustment';
  amount: number;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  note: string;
  date: string;
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
  fee: number;
  parent_transfer_id: string | null;
};
export type Snapshot = {
  next_cursor?: string | null;
  user: { id: string; username: string };
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  quick_fills: Pick<Transaction, 'note' | 'amount' | 'account_id' | 'category_id'>[];
  recent: Transaction[];
  needs_setup: boolean;
  last_expense: Pick<Transaction, 'account_id' | 'category_id'> | null;
  summary: { income: number; expense: number };
  total: number;
  month: string;
};
export function budgetState(budget: number, spent: number) {
  return {
    percent: Math.round((spent / budget) * 100),
    left: budget - spent,
    state: spent > budget ? 'over' : spent / budget >= 0.8 ? 'warn' : 'ok',
  } as const;
}
