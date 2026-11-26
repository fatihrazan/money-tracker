// Reconstructed from the supplied screenshots, with synthetic names, accounts,
// merchant identifiers, and references. These are not original bank MIME files.
export const bniReference = 'TEST-BNI-20261031-001';
export const mandiriReference = 'TEST-MANDIRI-20260928-001';

const bniOpening =
  'Terima kasih udah bertransaksi dengan wondr by BNI! Kamu baru aja bayar pakai QRIS dengan detail sebagai berikut:';
const bniRows = [
  ['Penerima', 'TOKO CONTOH'],
  ['Sumber dana', 'PENGGUNA CONTOH'],
  ['', 'TAPLUS MUDA • *******123'],
  ['Tanggal & waktu transaksi', ''],
  ['Tanggal', '31 Okt 2026'],
  ['Waktu', '09:52:16 WIB'],
  ['Detail pembayaran', ''],
  ['Nominal', 'Rp35.000'],
  ['Total', 'Rp35.000'],
  ['Detail merchant', ''],
  ['Merchant ID', '000000000001234'],
  ['Merchant PAN', '9360000000000000001'],
  ['Terminal ID', 'TEST-TERMINAL'],
  ['Nama acquirer', 'BCA'],
  ['Detail transaksi', ''],
  ['Customer PAN', '9360000000000000002'],
  ['Nama issuer', 'BNI'],
  ['Jenis transaksi', 'QRIS'],
  ['Reference ID', bniReference],
  ['Kode RRN', 'TEST-RRN-7777'],
];
const mandiriRows = [
  ['Penerima', 'PENERIMA CONTOH'],
  ['', 'Bank Mandiri - 0000000000123'],
  ['Tanggal', '28 Sep 2026'],
  ['Jam', '12:13:30 WIB'],
  ['Jumlah Transfer', 'Rp 25.000,00'],
  ['No. Referensi', mandiriReference],
  ['Keterangan', '-'],
  ['Rekening Sumber', 'PENGGUNA CONTOH'],
  ['', '****4321'],
];
const mandiriOpening =
  "Livin' by mandiri\nTransfer Berhasil\nHalo PENGGUNA CONTOH,\nBerikut adalah detail transaksi Anda:";
const rowsAsText = (rows: string[][]) => rows.flat().filter(Boolean).join('\n');
const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rowsAsHtml = (rows: string[][]) =>
  rows
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td align="right">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

export const bniQrisText = `Hai, PENGGUNA CONTOH\n${bniOpening}\n${rowsAsText(bniRows)}\nButuh bantuan?\nBNI Call 1500046`;
export const mandiriTransferText = `${mandiriOpening}\n${rowsAsText(mandiriRows)}`;
export const bniQrisHtml = `<html><body><table><tr><td><h3>Hai, PENGGUNA CONTOH</h3><p>${bniOpening}</p><table>${rowsAsHtml(bniRows)}</table><p>Butuh bantuan?</p><p>BNI Call 1500046</p></td></tr></table></body></html>`;
export const mandiriTransferHtml = `<html><body><table><tr><td><img alt="Livin by mandiri" src="https://example.invalid/logo.png"><h2>Transfer Berhasil</h2><p>Halo PENGGUNA CONTOH,</p><p>Berikut adalah detail transaksi Anda:</p><table>${rowsAsHtml(mandiriRows)}</table></td></tr></table></body></html>`;
