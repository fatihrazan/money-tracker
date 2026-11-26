import { dateSchema, parseAmount, transactionSchema, type Account, type Category } from './index';

type Accounts = Pick<Account, 'id' | 'name' | 'archived'>[];
type Categories = Pick<Category, 'id' | 'name' | 'kind'>[];
type Kind = 'expense' | 'income' | 'transfer';
export type NaturalField =
  'kind' | 'amount' | 'account_id' | 'to_account_id' | 'category_id' | 'fee' | 'date';
export type NaturalConversation = {
  kind?: Kind;
  amount?: number;
  account_id?: string;
  to_account_id?: string;
  category_id?: string;
  fee?: number;
  date?: string;
  note: string;
  awaiting?: NaturalField;
};
export class NaturalInputError extends Error {}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text: string, phrase: string) => ` ${norm(text)} `.includes(` ${norm(phrase)} `);
const dateShift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthNames = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
];

function readDate(text: string, reference: string) {
  const dates: string[] = [];
  let rest = text.toLowerCase();
  rest = rest.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (value) => {
    dates.push(value);
    return ' ';
  });
  rest = rest.replace(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g, (_, d, m, y) => {
    dates.push(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return ' ';
  });
  rest = rest.replace(
    new RegExp(`\\b(\\d{1,2})\\s+(${monthNames.join('|')})(?:\\s+(\\d{4}))?\\b`, 'g'),
    (_, d, m, y) => {
      dates.push(
        `${y ?? reference.slice(0, 4)}-${String(monthNames.indexOf(m) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`,
      );
      return ' ';
    },
  );
  rest = rest.replace(
    /\b(hari ini|tadi malam|tadi pagi|tadi siang|tadi sore|barusan|kemarin lusa|kemarin|kemaren|dua hari lalu|besok|lusa)\b/g,
    (value) => {
      dates.push(
        dateShift(
          reference,
          /kemarin lusa|dua hari lalu/.test(value)
            ? -2
            : /kemarin|kemaren/.test(value)
              ? -1
              : value === 'besok'
                ? 1
                : value === 'lusa'
                  ? 2
                  : 0,
        ),
      );
      return ' ';
    },
  );
  const unique = [...new Set(dates)];
  const unresolved =
    (/\btanggal\b/.test(rest) && !dates.length) ||
    /\b(minggu lalu|bulan lalu|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/.test(rest) ||
    /\b\d{1,2}[/.-]\d{1,2}\b/.test(rest);
  return {
    rest,
    date: unique.length === 1 && dateSchema.safeParse(unique[0]).success ? unique[0] : undefined,
    uncertain:
      unique.length > 1 || dates.some((d) => !dateSchema.safeParse(d).success) || unresolved,
  };
}

const ones: Record<string, number> = {
  nol: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
};
function wordNumber(words: string[]): number | undefined {
  if (!words.length) return undefined;
  for (const [word, scale] of [
    ['juta', 1000000],
    ['ribu', 1000],
    ['ratus', 100],
    ['puluh', 10],
  ] as const) {
    const index = words.indexOf(word);
    if (index >= 0) {
      const left = wordNumber(words.slice(0, index));
      const right = index === words.length - 1 ? 0 : wordNumber(words.slice(index + 1));
      return left === undefined || right === undefined || left < 1 || right >= scale
        ? undefined
        : left * scale + right;
    }
  }
  if (words.length === 2 && words[1] === 'belas' && ones[words[0]] > 0 && ones[words[0]] < 10)
    return 10 + ones[words[0]];
  return words.length === 1 ? ones[words[0]] : undefined;
}
const numberWords =
  'nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|ratus|ribu|juta|seratus|seribu|sejuta';
function moneyTokens(text: string) {
  const found: { value: number; index: number; end: number; marked: boolean }[] = [];
  const regex =
    /(?<![\p{L}\p{N}])(?:rp\.?\s*)?-?\d+(?:[.,]\d+)*(?:\s*(?:ribu|juta|rb|jt|k))?(?![\p{L}\p{N}])/giu;
  for (const m of text.matchAll(regex)) {
    if (
      /^\s*(?:porsi|gelas|bungkus|orang|kali|buah|kopi|botol|pcs|liter)\b/i.test(
        text.slice(m.index! + m[0].length),
      )
    )
      continue;
    try {
      found.push({
        value: parseAmount(m[0].replace(/^rp\./i, 'rp')),
        index: m.index!,
        end: m.index! + m[0].length,
        marked: /rp|ribu|juta|rb|jt|k|[.,]\d{3}/i.test(m[0]),
      });
    } catch {
      /* Ask for a valid amount instead. */
    }
  }
  const wordPattern = new RegExp(
    `\\b(?:${numberWords})(?:\\s+(?:${numberWords}))*\\b(?:\\s+rupiah)?`,
    'gi',
  );
  for (const m of text.matchAll(wordPattern)) {
    if (!/ribu|juta|ratus|puluh|rupiah/i.test(m[0])) continue;
    const raw = m[0]
      .toLowerCase()
      .replace(/rupiah/g, '')
      .replace(/seratus/g, 'satu ratus')
      .replace(/seribu/g, 'satu ribu')
      .replace(/sejuta/g, 'satu juta')
      .trim();
    const value = wordNumber(raw.split(/\s+/));
    if (value !== undefined)
      found.push({ value, index: m.index!, end: m.index! + m[0].length, marked: true });
  }
  return found.sort((a, b) => a.index - b.index);
}

function mentions<T extends { id: string; name: string }>(
  text: string,
  items: T[],
  aliases: (item: T) => string[] = () => [],
) {
  const normalized = norm(text);
  const matches: { item: T; index: number; end: number }[] = [];
  for (const item of items) {
    for (const name of [item.name, ...aliases(item)]) {
      const key = norm(name);
      if (!key) continue;
      const regex = new RegExp(`(?:^| )(${escape(key)})(?= |$)`, 'g');
      for (const m of normalized.matchAll(regex)) {
        const start = m.index! + (m[0].startsWith(' ') ? 1 : 0);
        matches.push({ item, index: start, end: start + key.length });
      }
    }
  }
  // Prefer "BCA Utama" over an overlapping "BCA", while keeping genuinely ambiguous aliases.
  return matches
    .filter(
      (m) =>
        !matches.some(
          (other) =>
            other.index <= m.index &&
            other.end >= m.end &&
            other.end - other.index > m.end - m.index,
        ),
    )
    .filter(
      (m, i, all) => all.findIndex((x) => x.item.id === m.item.id && x.index === m.index) === i,
    )
    .sort((a, b) => a.index - b.index);
}
function accountAliases(a: Accounts[number]) {
  const n = norm(a.name);
  const result = [
    'bca',
    'bni',
    'bri',
    'mandiri',
    'gopay',
    'ovo',
    'dana',
    'shopeepay',
    'jago',
    'jenius',
    'seabank',
  ].filter((brand) => has(n, brand));
  if (/\b(tunai|cash|dompet|kontan)\b/.test(n)) result.push('cash', 'tunai', 'kontan');
  if (has(n, 'go pay')) result.push('gopay');
  if (has(n, 'gopay')) result.push('go pay');
  return result;
}
const uniqueItems = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((i) => [i.id, i])).values(),
];
const categoryGroups = [
  {
    names: /makan|minum|konsumsi|kuliner|jajan/i,
    cues: /\b(makan|sarapan|kopi|ngopi|nasi|restoran|warung|jajan|minum|snack|cemilan)\b/i,
  },
  {
    names: /transport|bensin|bbm/i,
    cues: /\b(bensin|pertalite|pertamax|bbm|ojek|grab|gojek|angkot|bus|parkir|tol)\b/i,
  },
  {
    names: /belanja|kebutuhan/i,
    cues: /\b(belanja|supermarket|indomaret|alfamart|sembako|sabun)\b/i,
  },
  { names: /gaji|salary/i, cues: /\b(gaji|gajian|salary|upah)\b/i },
  { names: /hiburan/i, cues: /\b(bioskop|nonton|netflix|spotify|game)\b/i },
  { names: /kesehatan|obat/i, cues: /\b(obat|dokter|apotek|rumah sakit)\b/i },
  { names: /tagihan|utilitas/i, cues: /\b(listrik|internet|wifi|air|pulsa)\b/i },
];
function inferCategory(text: string, items: Categories) {
  const exact = uniqueItems(mentions(text, items).map((m) => m.item));
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const candidates = items.filter((c) =>
    categoryGroups.some((g) => g.names.test(c.name) && g.cues.test(text)),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}
function inferKind(text: string): Kind | undefined {
  const n = norm(text);
  if (/\b(transfer|tf|top up|topup|pindah|pindahin|pindahkan|tarik tunai|isi saldo)\b/.test(n))
    return 'transfer';
  const income =
    /\b(pemasukan|masuk|terima|diterima|dapet|dapat|gaji|gajian|upah|penghasilan|bonus|pendapatan)\b/.test(
      n,
    );
  const expense =
    /\b(pengeluaran|keluar|beli|beliin|belanja|bayar|makan|sarapan|ngopi|jajan|bensin|habis|ongkos|donasi)\b/.test(
      n,
    );
  return income === expense ? undefined : income ? 'income' : 'expense';
}

export function understandTelegramText(
  text: string,
  accounts: Accounts,
  categories: Categories,
  reference: string,
  previous?: NaturalConversation,
) {
  const active = accounts.filter((a) => !a.archived);
  const n = norm(text);
  if (
    /\b(jangan|batalkan|batal|belum|rencana|rencananya|akan|mau|ingin|tidak jadi|gagal)\b/.test(n)
  )
    throw new NaturalInputError(
      'Pesan ini tampaknya belum merupakan transaksi yang terjadi. Untuk membatalkan percakapan, ketik /batal. Ceritakan transaksi yang ingin dicatat.',
    );
  if (/\b(usd|dolar|dollar|eur|euro|sgd|myr)\b|\$/i.test(text))
    throw new NaturalInputError('Bot mencatat Rupiah. Kirim nominal dalam Rupiah terlebih dahulu.');
  if (text.length > 1000)
    throw new NaturalInputError(
      'Ceritakan satu transaksi dalam pesan yang lebih singkat (maksimal 1000 karakter).',
    );
  const state: NaturalConversation = previous ? { ...previous } : { note: text.slice(0, 200) };
  const expected = state.awaiting;
  delete state.awaiting;
  const dates = readDate(text, reference);
  const accountMentions = mentions(text, active, accountAliases);
  const choices = uniqueItems(accountMentions.map((m) => m.item));
  let moneyText = dates.rest;
  // Account names can contain numbers; they are not transaction amounts.
  for (const a of accounts) moneyText = moneyText.replace(new RegExp(escape(a.name), 'gi'), ' ');
  const tokens = moneyTokens(moneyText);
  const feeLabel =
    /\b(?:biaya(?:\s+admin)?|admin(?:nya)?|fee|ongkos\s+admin)\s*(?:sebesar|nya|:|=)?\s*$/i;
  const fees = tokens.filter((t) => feeLabel.test(moneyText.slice(0, t.index)));
  const amounts = tokens.filter((t) => !fees.includes(t));
  const mainAmounts = amounts;
  const amount =
    mainAmounts.length === 1 && mainAmounts[0].value > 0 ? mainAmounts[0].value : undefined;
  const free =
    /\b(gratis|tanpa (?:biaya|admin)|bebas (?:biaya|admin)|tidak ada (?:biaya|admin)|ga ada (?:biaya|admin))\b/.test(
      n,
    );
  const fee =
    free && fees.length === 0
      ? 0
      : !free && fees.length === 1 && fees[0].value >= 0
        ? fees[0].value
        : undefined;
  let needsDate = false;
  if (!previous) {
    state.kind = inferKind(text);
    state.amount = amount;
    // A payment fee must not silently disappear from an ordinary expense.
    if (state.kind !== 'transfer' && fees.length) state.amount = undefined;
    if (/\b(total|termasuk|sudah termasuk)\b/.test(n) && state.kind === 'transfer' && fee !== 0)
      state.amount = undefined;
    if (state.kind === 'transfer') {
      const normalized = norm(text);
      const source = uniqueItems(
        accountMentions
          .filter((m) =>
            /\b(dari|pakai|pake|via|lewat|menggunakan)(?: (?:rekening|akun|bank|saldo))* $/.test(
              normalized.slice(0, m.index),
            ),
          )
          .map((m) => m.item),
      );
      const target = uniqueItems(
        accountMentions
          .filter((m) =>
            /\b(ke|menuju)(?: (?:rekening|akun|bank|saldo))* $/.test(normalized.slice(0, m.index)),
          )
          .map((m) => m.item),
      );
      state.account_id = source.length === 1 ? source[0].id : undefined;
      state.to_account_id = target.length === 1 ? target[0].id : undefined;
      if (choices.length === 2) {
        if (state.to_account_id && !state.account_id)
          state.account_id = choices.find((a) => a.id !== state.to_account_id)?.id;
        if (state.account_id && !state.to_account_id)
          state.to_account_id = choices.find((a) => a.id !== state.account_id)?.id;
      }
      state.fee = fee;
    } else {
      state.account_id = choices.length === 1 ? choices[0].id : undefined;
      if (state.kind)
        state.category_id = inferCategory(
          text,
          categories.filter((c) => c.kind === state.kind),
        )?.id;
    }
    state.date = dates.date ?? (dates.uncertain ? undefined : reference);
    needsDate = dates.uncertain;
  } else if (expected === 'kind') {
    state.kind = /^(masuk|pemasukan|income)$/.test(n)
      ? 'income'
      : /^(keluar|pengeluaran|expense)$/.test(n)
        ? 'expense'
        : inferKind(text);
    if (state.kind !== previous.kind) {
      delete state.category_id;
      delete state.to_account_id;
      delete state.fee;
    }
    if (state.kind && state.kind !== 'transfer')
      state.category_id = inferCategory(
        state.note,
        categories.filter((c) => c.kind === state.kind),
      )?.id;
  } else if (expected === 'amount') state.amount = amount;
  else if (expected === 'fee')
    state.fee =
      fee ??
      (!free && fees.length === 0 && tokens.length === 1 && tokens[0].value >= 0
        ? tokens[0].value
        : undefined);
  else if (expected === 'date') {
    state.date = dates.date;
    needsDate = !dates.date || dates.uncertain;
  } else if (expected === 'category_id')
    state.category_id = inferCategory(
      text,
      categories.filter((c) => c.kind === state.kind),
    )?.id;
  else if (expected === 'account_id' || expected === 'to_account_id')
    state[expected] = choices.length === 1 ? choices[0].id : undefined;

  if (state.account_id && !active.some((a) => a.id === state.account_id)) delete state.account_id;
  if (
    state.to_account_id &&
    (!active.some((a) => a.id === state.to_account_id) || state.to_account_id === state.account_id)
  )
    delete state.to_account_id;
  if (
    state.category_id &&
    !categories.some((c) => c.id === state.category_id && c.kind === state.kind)
  )
    delete state.category_id;
  const fields: NaturalField[] = [
    'kind',
    'amount',
    'account_id',
    ...(state.kind === 'transfer'
      ? (['to_account_id', 'fee'] as const)
      : (['category_id'] as const)),
    'date',
  ];
  const missing = needsDate ? 'date' : fields.find((field) => state[field] === undefined);
  if (missing) {
    state.awaiting = missing;
    const list = (items: { name: string }[]) =>
      items.length
        ? items
            .map((a) => a.name)
            .join(', ')
            .slice(0, 2000)
        : 'Belum tersedia; tambahkan melalui web terlebih dahulu.';
    const questions: Record<NaturalField, string> = {
      kind: 'Ini pengeluaran, pemasukan, atau transfer antar akun milikmu?',
      amount:
        'Berapa nominal satu transaksi ini dalam Rupiah? Contoh: 25 ribu. Untuk pengeluaran, sebutkan total termasuk biaya. Untuk transfer, sebutkan nominal pokok tanpa biaya admin. Jika ada beberapa transaksi, kirim satu per satu memakai /baru.',
      account_id: `Pakai akun mana${state.kind === 'transfer' ? ' sebagai asal' : state.kind === 'income' ? ' untuk menerima uang' : ''}? ${list(active)}`,
      to_account_id: `Ke akun milikmu yang mana? ${list(active.filter((a) => a.id !== state.account_id))}. Jika membayar orang lain, gunakan /baru dan ceritakan sebagai pengeluaran.`,
      category_id: `Masuk kategori apa? ${list(categories.filter((c) => c.kind === state.kind))}`,
      fee: 'Berapa biaya admin transfernya? Balas misalnya 2.500 atau gratis jika tidak ada biaya.',
      date: `Tanggal transaksinya belum jelas. Balas misalnya kemarin atau ${reference}.`,
    };
    return { state, question: questions[missing], parsed: undefined };
  }
  const payload = transactionSchema.parse({
    ...state,
    fee: state.kind === 'transfer' ? state.fee : 0,
    to_account_id: state.kind === 'transfer' ? state.to_account_id : null,
    category_id: state.kind === 'transfer' ? null : state.category_id,
  });
  return {
    state,
    question: undefined,
    parsed: {
      payload,
      account: active.find((a) => a.id === payload.account_id)!.name,
      target:
        payload.kind === 'transfer'
          ? active.find((a) => a.id === payload.to_account_id)!.name
          : categories.find((c) => c.id === payload.category_id)!.name,
    },
  };
}
