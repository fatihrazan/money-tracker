import { z } from 'zod';
import { dateSchema, MAX_AMOUNT } from './index';
import { receiptAmount } from './photo-transaction';

export const emailRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sender: z
      .email()
      .regex(
        /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+$/,
        'Gunakan alamat email pengirim bank yang lengkap.',
      )
      .max(254)
      .transform((value) => value.toLowerCase()),
    subject_contains: z
      .string()
      .trim()
      .min(3, 'Isi bagian subjek yang khusus untuk transaksi.')
      .max(160),
    body_contains: z.string().trim().max(160).default(''),
    kind: z.enum(['expense', 'income', 'transfer']),
    account_id: z.uuid(),
    to_account_id: z.uuid().nullable().default(null),
    category_id: z.uuid().nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (
      value.kind === 'transfer' &&
      (!value.to_account_id || value.to_account_id === value.account_id)
    )
      context.addIssue({ code: 'custom', message: 'Pilih rekening tujuan yang berbeda.' });
    if (value.kind !== 'transfer' && !value.category_id)
      context.addIssue({ code: 'custom', message: 'Pilih kategori transaksi.' });
  });
export type EmailRule = z.infer<typeof emailRuleSchema> & { id: string; created_at: string };

// Headers supplied by the user for these two receipt formats. Account/category
// mappings must be chosen by each user; a bank name cannot establish ownership.
export const bankEmailPresets = [
  {
    id: 'bni-qris',
    label: 'BNI wondr — Pembayaran QRIS',
    name: 'Pembayaran QRIS BNI',
    sender: 'wondr@bni.co.id',
    subject_contains: 'Transaksi berhasil!',
    body_contains: 'bayar pakai QRIS',
    kind: 'expense',
  },
  {
    id: 'mandiri-transfer',
    label: 'Mandiri Livin’ — Transfer keluar',
    name: 'Transfer keluar Mandiri',
    sender: 'noreply.livin@bankmandiri.co.id',
    subject_contains: 'Transfer Berhasil',
    body_contains: 'Jumlah Transfer',
    kind: 'expense',
  },
] as const satisfies readonly (Pick<
  EmailRule,
  'name' | 'sender' | 'subject_contains' | 'body_contains' | 'kind'
> & { id: string; label: string })[];

export type GmailStatus = {
  google_configured: boolean;
  gmail_configured: boolean;
  identity: { email: string } | null;
  connection: {
    enabled: boolean;
    connected: boolean;
    sync_from: string;
    last_synced_at: string | null;
    last_error: string | null;
  } | null;
  worker_active: boolean;
  sync_interval_minutes?: number;
  rules: EmailRule[];
  imports: {
    id: string;
    status: 'imported' | 'skipped' | 'duplicate';
    reason: string;
    received_at: string;
    created_at: string;
    transaction_id: string | null;
    rule_name: string | null;
  }[];
};

export type ParsedBankEmail =
  | { ok: true; amount: number; fee: number; date: string; reference: string }
  | { ok: false; reason: string };

const emailMonths: Record<string, string> = {
  jan: '01',
  januari: '01',
  january: '01',
  feb: '02',
  februari: '02',
  february: '02',
  mar: '03',
  maret: '03',
  march: '03',
  apr: '04',
  april: '04',
  mei: '05',
  may: '05',
  jun: '06',
  juni: '06',
  june: '06',
  jul: '07',
  juli: '07',
  july: '07',
  agu: '08',
  agt: '08',
  agustus: '08',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  okt: '10',
  oktober: '10',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  des: '12',
  desember: '12',
  dec: '12',
  december: '12',
};
function emailDate(value: string): string | null {
  let match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:\b|T)/.exec(value);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(value);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  match = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\b/i.exec(value);
  if (match && emailMonths[match[2].toLowerCase()])
    return `${match[3]}-${emailMonths[match[2].toLowerCase()]}-${match[1].padStart(2, '0')}`;
  return null;
}

// Deterministic parsing of labelled receipts, including the supplied wondr QRIS
// and Livin' outgoing-transfer layouts. Sender authentication is checked by the importer.
export function parseBankEmail(
  subject: string,
  text: string,
  kind: EmailRule['kind'],
): ParsedBankEmail {
  const skip = (reason: string): ParsedBankEmail => ({ ok: false, reason });
  if (text.length > 150000) return skip('Isi email terlalu panjang.');
  const normalized = text.replace(/[\u00a0\u202f]/g, ' ');
  const content = `${subject}\n${normalized}`;
  if (/\b(?:otp|one.time password|kode verifikasi|e-statement|rekening koran)\b/i.test(subject))
    return skip('Email bukan notifikasi transaksi.');
  if (
    /(?:status|transaksi|transfer|pembayaran)\s*[:\-]?\s*(?:gagal|ditolak|dibatalkan|pending|diproses|failed|declined|cancelled|processing)\b/i.test(
      content,
    )
  )
    return skip('Transaksi belum berhasil atau dibatalkan.');
  if (
    /\b(?:tidak berhasil|belum berhasil|not successful|unsuccessful|not completed)\b/i.test(content)
  )
    return skip('Transaksi belum berhasil atau dibatalkan.');
  if (/\b(?:USD|SGD|EUR|MYR|AUD|JPY)\b|\$/.test(content))
    return skip('Mata uang selain Rupiah belum didukung.');
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  function values(label: RegExp) {
    return lines.flatMap((line, index) => {
      const match = label.exec(line);
      if (!match) return [];
      const tail = line
        .slice(match[0].length)
        .replace(/^\s*[:=\-]\s*/, '')
        .trim();
      return [tail || lines[index + 1] || ''];
    });
  }
  const bniQris =
    /terima kasih udah bertransaksi dengan wondr by BNI[!.]?\s*kamu baru aja bayar pakai QRIS dengan detail sebagai berikut\s*:/i.test(
      normalized,
    ) &&
    values(/^jenis transaksi(?=\s|[:=\-]|$)/i).some((value) => /^QRIS$/i.test(value)) &&
    values(/^nama issuer(?=\s|[:=\-]|$)/i).some((value) => /^BNI$/i.test(value));
  if (!bniQris && !/\b(?:berhasil|sukses|successful|success|completed)\b/i.test(content))
    return skip('Status transaksi berhasil belum dapat dipastikan.');
  if (bniQris && kind !== 'expense')
    return skip('Pembayaran QRIS BNI harus memakai aturan pengeluaran.');
  const outgoingTransfer =
    /\btransfer berhasil\b/i.test(content) &&
    values(/^jumlah transfer(?=\s|[:=\-]|$)/i).length > 0 &&
    values(/^rekening sumber(?=\s|[:=\-]|$)/i).length > 0;
  if (outgoingTransfer && kind === 'income')
    return skip(
      'Email ini adalah transfer keluar. Gunakan pengeluaran atau transfer antar akun sendiri.',
    );
  function money(label: RegExp): number[] {
    return values(label).map((value) => {
      const match = /^(?:Rp\.?|IDR)\s*([\d.,]+)(?:,-)?\s*$/i.exec(value);
      if (!match) return NaN;
      if (/^0(?:[.,]00)?$/.test(match[1])) return 0;
      return receiptAmount(match[0]) ?? NaN;
    });
  }
  const amounts = money(
    /^(?:nominal(?: transaksi| transfer| pembayaran)?|jumlah(?: transaksi| transfer| pembayaran)?|amount|transfer amount)\b/i,
  );
  const totals = money(/^(?:total(?: pembayaran| transaksi| transfer| debit)?|total amount)\b/i);
  const fees = money(/^(?:biaya(?: admin(?:istrasi)?| transfer| layanan)?|admin fee|fee)\b/i);
  if ([...amounts, ...totals, ...fees].some((value) => !Number.isSafeInteger(value)))
    return skip('Format nominal atau biaya belum dikenali.');
  if ([amounts, totals, fees].some((list) => new Set(list).size > 1))
    return skip('Email memiliki beberapa nominal yang berbeda.');
  const fee = fees[0] ?? 0;
  const principal = amounts[0] ?? (totals[0] === undefined ? undefined : totals[0] - fee);
  if (!principal || principal <= 0 || principal > MAX_AMOUNT || fee > MAX_AMOUNT)
    return skip('Nominal transaksi belum ditemukan atau tidak valid.');
  if (totals[0] !== undefined && totals[0] !== principal + fee)
    return skip('Total transaksi tidak cocok dengan nominal dan biaya.');
  if (kind === 'income' && fee > 0)
    return skip('Pemasukan dengan potongan biaya memerlukan format bank khusus.');
  const dateLabels =
    /^(?:tanggal(?:\s*(?:(?:&|\/|dan)\s*waktu(?:\s+transaksi)?|transaksi))?|waktu(?: transaksi)?|transaction date|date)(?=\s|[:=\-]|$)/i;
  const dates = values(dateLabels)
    // BNI has a section heading followed by a separate Tanggal row and a time-only Waktu row.
    .filter(
      (value) =>
        !/^tanggal(?:\s|:|$)/i.test(value) &&
        !/^\d{1,2}:\d{2}(?::\d{2})?(?:\s+(?:WIB|WITA|WIT))?$/i.test(value),
    )
    .map(emailDate);
  if (new Set(dates).size !== 1 || !dates[0] || !dateSchema.safeParse(dates[0]).success)
    return skip('Tanggal transaksi belum dapat dipastikan.');
  const references = values(
    /^(?:(?:no\.?|nomor)\s*(?:referensi|ref\.?|transaksi)|reference(?: number| no\.?| id)?|transaction id|id transaksi)(?=\s|[:=\-]|$)/i,
  ).map((value) => value.replace(/\s/g, '').toUpperCase());
  if (new Set(references).size !== 1 || !/^[A-Z0-9][A-Z0-9/_-]{3,99}$/.test(references[0] ?? ''))
    return skip('Nomor referensi unik belum ditemukan.');
  const amount = kind === 'expense' ? principal + fee : principal;
  if (amount > MAX_AMOUNT) return skip('Nominal transaksi melampaui batas.');
  return {
    ok: true,
    amount,
    fee: kind === 'transfer' ? fee : 0,
    date: dates[0],
    reference: references[0],
  };
}
