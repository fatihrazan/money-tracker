import { dateSchema, MAX_AMOUNT, parseAmount, type Account, type Category } from './index';

export type PhotoKind = 'expense' | 'income' | 'transfer';
export type PhotoDraft = {
  kind: PhotoKind | null;
  amount: number | null;
  fee: number;
  date: string | null;
  account_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  note: string;
  warnings: string[];
};
const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function receiptAmount(raw: string): number | null {
  let text = raw
    .trim()
    .replace(/^(?:rp\.?|idr)\s*/i, '')
    .replace(/\s/g, '')
    .replace(/,-$/, '');
  if (/(?:rb|ribu|k|jt|juta)$/i.test(text)) {
    try {
      const value = parseAmount(text);
      return value > 0 ? value : null;
    } catch {
      return null;
    }
  }
  // Receipt decimals are accepted only when they are exactly zero Rupiah cents.
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(text)) {
    if (!text.endsWith(',00')) return null;
    text = text.slice(0, -3).replaceAll('.', '');
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(text)) {
    if (!text.endsWith('.00')) return null;
    text = text.slice(0, -3).replaceAll(',', '');
  } else if (/^\d+[.,]\d{2}$/.test(text)) {
    if (!/[.,]00$/.test(text)) return null;
    text = text.slice(0, -3);
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) text = text.replace(/[.,]/g, '');
  if (!/^\d{1,13}$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_AMOUNT ? number : null;
}

const MONEY =
  /(?:\b(?:rp\.?|idr)\s*)?\d+(?:\s*[.,]\s*\d+|\s+\d{3}(?!\d))*(?:\s*(?:ribu|juta|rb|jt|k))?(?:\s*,-)?(?![a-z0-9])/gi;
function lineAmounts(line: string, plain = false) {
  return [...line.matchAll(MONEY)].flatMap((match) => {
    const raw = match[0];
    if (!plain && !/(?:rp|idr|[.,]\d{3}|rb|ribu|jt|juta)/i.test(raw)) return [];
    const value = receiptAmount(raw);
    return value === null ? [] : [value];
  });
}
function amountAfter(lines: string[], label: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const match = label.exec(lines[i]);
    if (!match) continue;
    if (/\bsub\s*$/i.test(lines[i].slice(0, match.index))) continue;
    const tail = lines[i].slice(match.index + match[0].length);
    if (
      /^\s*(?:diskon|discount|pajak|tax|item|produk|qty|poin|points|ongkir|pengiriman|delivery|shipping)\b/i.test(
        tail,
      )
    )
      continue;
    const values = lineAmounts(tail, true);
    if (values.length) return values.at(-1)!;
    const next = lines[i + 1] ?? '';
    if (/^(?:\s*(?:rp\.?|idr)?\s*\d[\d.,\s-]*)$/i.test(next)) {
      const following = lineAmounts(next, true);
      if (following.length) return following.at(-1)!;
    }
  }
  return null;
}
const monthNames: Record<string, number> = {
  jan: 1,
  januari: 1,
  january: 1,
  feb: 2,
  februari: 2,
  february: 2,
  mar: 3,
  maret: 3,
  march: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  agu: 8,
  agt: 8,
  agustus: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
  dec: 12,
  december: 12,
};
function extractDate(text: string): string | null {
  const candidates: string[] = [];
  for (const m of text.matchAll(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g))
    candidates.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  for (const m of text.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g))
    candidates.push(
      `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    );
  for (const m of text.matchAll(/\b(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\b/gi)) {
    const month = monthNames[m[2].toLowerCase()];
    if (month)
      candidates.push(`${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  return candidates.find((date) => dateSchema.safeParse(date).success) ?? null;
}
const brands: Record<string, string[]> = {
  bni: ['bni', 'wondr'],
  mandiri: ['mandiri', 'livin'],
  bri: ['bri', 'brimo'],
  bca: ['bca'],
  jago: ['jago'],
  gopay: ['gopay', 'go pay'],
  shopeepay: ['shopeepay', 'shopee pay'],
  ovo: ['ovo'],
  dana: ['dana'],
  linkaja: ['linkaja', 'link aja'],
  seabank: ['seabank', 'sea bank'],
  jenius: ['jenius'],
  bsi: ['bsi'],
};
function matchAccount(text: string, accounts: Account[]): string | null {
  const haystack = ` ${normalize(text)} `;
  const ranked = accounts
    .filter((a) => !a.archived)
    .map((account) => {
      const full = normalize(account.name);
      const short = full
        .replace(/\b(bank|rekening|dompet|pribadi|bisnis|utama)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const qualified =
        full
          .replace(/\b(bank|rekening|dompet)\b/g, '')
          .trim()
          .split(/\s+/).length > 1;
      let score =
        full && haystack.includes(` ${full} `)
          ? qualified
            ? 100
            : 30
          : short.length >= 3 && haystack.includes(` ${short} `)
            ? 30
            : 0;
      for (const aliases of Object.values(brands)) {
        if (
          aliases.some((alias) => ` ${full} `.includes(` ${alias} `)) &&
          aliases.some((alias) => haystack.includes(` ${alias} `))
        )
          score = Math.max(score, 30);
      }
      // 'Dana' alone in 'dana masuk' is not evidence of the DANA wallet.
      if (
        short === 'dana' &&
        /\bdana (masuk|keluar|diterima|transfer)\b|\b(sumber|jumlah|total) dana\b/.test(
          normalize(text),
        ) &&
        !/\b(e wallet|dompet|aplikasi|via) dana\b/.test(normalize(text))
      )
        score = 0;
      return { id: account.id, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score) ? ranked[0].id : null;
}
const sourceLabel = /\b(?:dari|from|sumber|pengirim|rekening asal|akun asal|rekening debit)\b/i;
const destinationLabel = /\b(?:ke|to|tujuan|penerima|destination|rekening kredit)\b/i;
function directionalAccount(
  lines: string[],
  label: RegExp,
  opposite: RegExp,
  accounts: Account[],
): string | null {
  for (let i = 0; i < lines.length; i++) {
    const match = label.exec(lines[i]);
    if (!match) continue;
    const tail = lines[i].slice(match.index + match[0].length);
    const nextLabel = opposite.exec(tail);
    const segment = [nextLabel ? tail.slice(0, nextLabel.index) : tail];
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      if (nextLabel) break;
      if (opposite.test(lines[j]) || /(?:nominal|total|biaya|tanggal)/i.test(lines[j])) break;
      segment.push(lines[j]);
    }
    const account = matchAccount(segment.join(' '), accounts);
    if (account) return account;
  }
  return null;
}
const categoryRules: [RegExp, RegExp][] = [
  [/kopi|coffee|cafe|kafe/i, /kopi|makan|minum/i],
  [/makan|resto|restoran|restaurant|ayam|nasi|bakso|warung|food/i, /makan|minum/i],
  [
    /bensin|pertamina|parkir|transport|go ride|goride|grab|ojek|taksi|taxi|toll/i,
    /transport|bensin/i,
  ],
  [/indomaret|alfamart|supermarket|belanja|shopping|retail/i, /belanja|sembako|groceries/i],
  [/listrik|internet|pulsa|tagihan|pln|telkom/i, /tagihan|pulsa|internet/i],
  [/dokter|apotek|obat|kesehatan|klinik/i, /kesehatan|obat/i],
  [/pendidikan|kuliah|sekolah|kursus/i, /pendidikan/i],
  [/gaji|salary|payroll/i, /gaji|upah/i],
  [/bonus|insentif|thr/i, /bonus|thr/i],
  [/hadiah|gift/i, /hadiah/i],
  [/cashback/i, /cashback/i],
];
function matchCategory(text: string, kind: PhotoKind | null, categories: Category[]) {
  if (!kind || kind === 'transfer') return null;
  const available = categories.filter((c) => c.kind === kind);
  const exact = available.filter(
    (c) =>
      c.name.length >= 4 && normalize(text).includes(normalize(c.name)) && !/lainnya/i.test(c.name),
  );
  if (exact.length === 1) return exact[0].id;
  for (const [content, category] of categoryRules) {
    if (!content.test(text)) continue;
    const found = available.filter((c) => category.test(c.name));
    if (found.length === 1) return found[0].id;
  }
  return null;
}

/** Conservative suggestions only: never writes financial data or invents missing fields. */
export function extractPhotoTransaction(
  raw: string,
  accounts: Account[],
  categories: Category[],
  override?: PhotoKind,
): PhotoDraft {
  const text = raw.slice(0, 16000).replace(/\u00a0/g, ' ');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const source = directionalAccount(lines, sourceLabel, destinationLabel, accounts);
  const destination = directionalAccount(lines, destinationLabel, sourceLabel, accounts);
  const incoming =
    /pemasukan|uang masuk|dana masuk|transfer masuk|transfer diterima|menerima transfer|berhasil diterima|received|credited|gaji|salary|payroll|cashback/i.test(
      text,
    );
  const outgoing =
    /pengeluaran|pembayaran|bayar|paid|debit|transfer berhasil|transfer sukses|transfer keluar|berhasil dikirim|top.?up/i.test(
      text,
    );
  const receipt = /total|subtotal|struk|receipt|terima kasih/i.test(text);
  let kind: PhotoKind | null =
    source && destination && source !== destination
      ? 'transfer'
      : incoming
        ? 'income'
        : outgoing || receipt
          ? 'expense'
          : null;
  const unfinished =
    /\b(?:gagal|failed|dibatalkan|cancelled|canceled|pending|menunggu pembayaran|sedang diproses|belum dibayar)\b/i.test(
      text,
    );
  if (unfinished) kind = null;
  if (override) kind = override;
  const principal = amountAfter(
    lines,
    /(?:nominal(?: transfer| transaksi)?|jumlah transfer|transfer amount|jumlah diterima|amount received|jumlah uang|amount)\s*:?/i,
  );
  const total = amountAfter(
    lines,
    /\b(?:grand\s*total|total\s*(?:pembayaran|bayar|tagihan|transaksi|debit|payment)?|jumlah pembayaran)\s*:?/i,
  );
  const fee =
    amountAfter(
      lines,
      /(?:biaya\s*(?:admin(?:istrasi)?|transfer|layanan)|admin\s*(?:fee)?|transfer fee)\s*:?/i,
    ) ?? 0;
  const currencyValues = lines
    .filter(
      (line) =>
        !/(?:saldo|balance|rekening|account|referensi|reference|kembalian|change|biaya|admin|subtotal|telepon|phone|invoice|pesanan|\bid\b)/i.test(
          line,
        ),
    )
    .flatMap((line) => lineAmounts(line));
  const unique = [...new Set(currencyValues)];
  let amount =
    kind === 'transfer'
      ? (principal ?? total)
      : kind === 'income'
        ? (principal ?? total)
        : (total ?? principal);
  const inclusiveTotal = /\btotal\s*(?:pembayaran|bayar|debit|payment)\b/i.test(text);
  if (kind === 'transfer' && principal === null && fee && total !== null)
    amount = inclusiveTotal && total > fee ? total - fee : null;
  if (amount === null && principal === null && total === null && unique.length === 1)
    amount = unique[0];
  if (kind === 'expense' && outgoing && fee && !total && principal && principal + fee <= MAX_AMOUNT)
    amount = principal + fee;
  const foreignCurrency = /\b(?:usd|eur|sgd|myr|aud|gbp)\b|\$/.test(text.toLowerCase());
  if (foreignCurrency) amount = null;
  const account_id =
    kind === 'transfer'
      ? source
      : kind === 'income'
        ? (destination ??
          matchAccount(lines.filter((line) => !sourceLabel.test(line)).join(' '), accounts))
        : (source ??
          matchAccount(lines.filter((line) => !destinationLabel.test(line)).join(' '), accounts));
  const category_id = matchCategory(text, kind, categories);
  const date = extractDate(text);
  let note = '';
  if (kind === 'transfer')
    note = `Transfer ${accounts.find((a) => a.id === source)?.name ?? ''} → ${accounts.find((a) => a.id === destination)?.name ?? ''}`;
  else if (kind === 'income')
    note =
      lines.find((line) =>
        /gaji|salary|payroll|cashback|bonus|hadiah|transfer masuk|dana masuk/i.test(line),
      ) ?? 'Pemasukan';
  else if (kind === 'expense')
    note =
      lines.find(
        (line) =>
          !/(?:\d{3,}|transfer|tanggal|rekening|referensi|struk|receipt|total|berhasil|bukti)/i.test(
            line,
          ),
      ) ?? 'Pengeluaran';
  const warnings: string[] = [];
  if (!kind) warnings.push('Pilih jenis transaksi.');
  if (unfinished)
    warnings.push('Status transaksi pada foto belum berhasil. Periksa sebelum mencatat.');
  if (amount === null) warnings.push('Nominal belum terbaca dengan jelas.');
  if (foreignCurrency) warnings.push('Mata uang selain Rupiah perlu diisi manual.');
  if (!date) warnings.push('Tanggal belum terbaca.');
  if (!account_id) warnings.push(kind === 'income' ? 'Pilih akun penerima.' : 'Pilih akun asal.');
  if (kind === 'transfer' && (!destination || source === destination))
    warnings.push('Pilih akun tujuan yang berbeda.');
  if (kind && kind !== 'transfer' && !category_id) warnings.push('Pilih kategori.');
  if (!override && outgoing && /transfer|top.?up/i.test(text) && kind === 'expense')
    warnings.push(
      'Transfer ke pihak lain dibaca sebagai pengeluaran. Jika antar akunmu, pilih Transfer.',
    );
  return {
    kind,
    amount,
    fee: kind === 'transfer' ? fee : 0,
    date,
    account_id,
    to_account_id: kind === 'transfer' && source !== destination ? destination : null,
    category_id,
    note: note.slice(0, 200),
    warnings,
  };
}
