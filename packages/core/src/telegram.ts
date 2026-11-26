import { transactionSchema, type Account, type Category } from './index';
export {
  understandTelegramText,
  NaturalInputError,
  type NaturalConversation,
} from './telegram-natural';

export const telegramHelp = `Ceritakan satu transaksi dengan bahasa sehari-hari, misalnya:
Tadi makan siang 25 ribu pakai BCA
Gajian lima juta masuk BCA kemarin
Transfer dari BCA ke GoPay 100rb admin 2500
Bot akan bertanya jika nominal, akun, kategori, tanggal, atau biaya belum jelas.
Balas pertanyaan bot seperti biasa, tanpa format khusus.
/batal - batalkan percakapan dan draf yang belum disimpan
/baru - mulai transaksi baru
Format lama juga tersedia:
/keluar 25rb | Tunai | Makanan | makan siang
/masuk 5jt | BCA | Gaji | gaji bulanan
/transfer 100rb | BCA | GoPay | 2500 | top up
Catatan opsional. Biaya transfer wajib diisi (0 jika gratis).
Tanggal hari ini; tambahkan | YYYY-MM-DD setelah catatan untuk tanggal lain.
/akun - daftar akun aktif
/kategori - daftar kategori
/bantuan - petunjuk
Periksa ringkasan lalu tekan Simpan. Draf berlaku 10 menit.`;

export function parseTelegramTransaction(
  text: string,
  accounts: Pick<Account, 'id' | 'name' | 'archived'>[],
  categories: Pick<Category, 'id' | 'name' | 'kind'>[],
  date: string,
) {
  const match = /^\/(keluar|masuk|transfer)(?:@[A-Za-z0-9_]+)?\s+(.+)$/is.exec(text.trim());
  if (!match) throw new Error('Perintah tidak dikenal. Ketik /bantuan.');
  const parts = match[2].split('|').map((s) => s.trim());
  const transfer = match[1] === 'transfer';
  const required = transfer ? 4 : 3;
  if (
    parts.length < required ||
    parts.length > required + 2 ||
    parts.slice(0, required).some((s) => !s)
  )
    throw new Error('Format belum lengkap. Ketik /bantuan.');
  const find = <T extends { id: string; name: string }>(
    items: T[],
    name: string,
    label: string,
  ) => {
    const matches = items.filter(
      (i) => i.name.toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID'),
    );
    if (matches.length !== 1) throw new Error(`${label} tidak ditemukan atau ambigu: ${name}.`);
    return matches[0];
  };
  const kind = transfer ? 'transfer' : match[1] === 'keluar' ? 'expense' : 'income';
  const active = accounts.filter((a) => !a.archived);
  const account = find(active, parts[1], 'Akun');
  const target = transfer
    ? find(active, parts[2], 'Akun tujuan')
    : find(
        categories.filter((c) => c.kind === kind),
        parts[2],
        'Kategori',
      );
  const payload = transactionSchema.parse({
    kind,
    amount: parts[0],
    account_id: account.id,
    to_account_id: transfer ? target.id : null,
    category_id: transfer ? null : target.id,
    fee: transfer ? parts[3] : 0,
    note: parts[required] ?? '',
    date: parts[required + 1] ?? date,
  });
  return { payload, account: account.name, target: target.name };
}
