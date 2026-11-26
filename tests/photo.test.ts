import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPhotoTransaction, receiptAmount } from '@money/core/photo-transaction';
import type { Account, Category } from '@money/core';
import { validatePhoto, PHOTO_LIMIT } from '../apps/web/lib/scan-photo';

const accounts: Account[] = [
  ['bni', 'BNI', 'bank'],
  ['gopay', 'GoPay', 'ewallet'],
  ['jago', 'Bank Jago', 'bank'],
  ['dana', 'DANA', 'ewallet'],
].map(([id, name, type]) => ({
  id,
  name,
  type: type as Account['type'],
  archived: false,
  initial_balance: 0,
  balance: 0,
}));
const categories: Category[] = [
  ['food', 'Makan & Minum', 'expense'],
  ['shopping', 'Belanja', 'expense'],
  ['salary', 'Gaji', 'income'],
  ['bonus', 'Bonus', 'income'],
].map(([id, name, kind]) => ({
  id,
  name,
  kind: kind as Category['kind'],
  budget: null,
  spent: 0,
  total: 0,
  used: 0,
}));
const read = (text: string) => extractPhotoTransaction(text, accounts, categories);

for (const [text, expected] of [
  ['Rp25.000,00', 25000],
  ['IDR 25,000.00', 25000],
  ['25000.00', 25000],
  ['25.000', 25000],
  ['25rb', 25000],
  ['1,5jt', 1500000],
  ['Rp20.000,-', 20000],
] as const)
  test(`receipt money ${text}`, () => assert.equal(receiptAmount(text), expected));
for (const text of ['12.50', '25.000,50', '1.2.3', '9999999999999999999', '0'])
  test(`reject receipt money ${text}`, () => assert.equal(receiptAmount(text), null));

test('receipt prefers final total, ignores subtotal, discount, tax and cash/change', () => {
  const draft = read(
    'KOPI PAGI\n30/10/2026\nSubtotal Rp18.000\nTotal pajak Rp2.000\nTotal diskon Rp1.000\nTOTAL BAYAR Rp20.000,00\nTunai Rp50.000\nKembalian Rp30.000\nPembayaran GoPay',
  );
  assert.equal(draft.kind, 'expense');
  assert.equal(draft.amount, 20000);
  assert.equal(draft.date, '2026-10-30');
  assert.equal(draft.category_id, 'food');
  assert.equal(draft.account_id, 'gopay');
  assert.equal(draft.note, 'KOPI PAGI');
});
test('spaced OCR numbers and split subtotal labels do not truncate the nominal', () => {
  const draft = read('KOPI PAGI\nSUB TOTAL Rp18.000\nTOTAL BAYAR Rp 20 000\n30/10/2026');
  assert.equal(draft.amount, 20000);
});
test('internal transfer distinguishes principal from total debit and admin fee', () => {
  const draft = read(
    'Transfer berhasil\n30 Oktober 2026\nRekening sumber BNI\nRekening tujuan GoPay\nNominal transfer Rp100.000\nBiaya admin Rp2.500\nTotal pembayaran Rp102.500',
  );
  assert.equal(draft.kind, 'transfer');
  assert.equal(draft.amount, 100000);
  assert.equal(draft.fee, 2500);
  assert.equal(draft.account_id, 'bni');
  assert.equal(draft.to_account_id, 'gopay');
  assert.equal(draft.category_id, null);
});
test('external transfer is an expense including admin fees', () => {
  const draft = read(
    'Transfer berhasil\nDari BNI\nKe BCA\nNominal transfer Rp100.000\nBiaya admin Rp2.500\nTotal pembayaran Rp102.500\n30 Okt 2026',
  );
  assert.equal(draft.kind, 'expense');
  assert.equal(draft.amount, 102500);
  assert.equal(draft.fee, 0);
  assert.equal(draft.account_id, 'bni');
  assert.equal(draft.to_account_id, null);
  const withoutTotal = read(
    'Transfer berhasil\nDari BNI\nKe BCA\nNominal transfer Rp100.000\nBiaya admin Rp2.500',
  );
  assert.equal(withoutTotal.amount, 102500);
});
test('transfer totals that explicitly include admin are not charged twice', () => {
  const draft = read(
    'Transfer berhasil\nDari BNI\nKe GoPay\nTotal pembayaran Rp101.000\nBiaya admin Rp1.000',
  );
  assert.equal(draft.kind, 'transfer');
  assert.equal(draft.amount, 100000);
  assert.equal(draft.fee, 1000);
  const ambiguous = read(
    'Transfer berhasil\nDari BNI\nKe GoPay\nTotal Rp101.000\nBiaya admin Rp1.000',
  );
  assert.equal(ambiguous.amount, null);
});
test('failed or pending transactions are not presented as successful transactions', () => {
  assert.equal(read('Transfer gagal\nDari BNI\nKe GoPay\nNominal Rp25.000').kind, null);
  assert.equal(read('Menunggu pembayaran\nTotal Rp50.000').kind, null);
});
test('income uses receiving account instead of external sender', () => {
  const draft = read(
    'Dana masuk\nDari BCA\nKe Bank Jago\nGaji Oktober\nJumlah diterima\nRp5.000.000,00\n30/10/26',
  );
  assert.equal(draft.kind, 'income');
  assert.equal(draft.amount, 5000000);
  assert.equal(draft.account_id, 'jago');
  assert.equal(draft.category_id, 'salary');
  assert.equal(draft.date, '2026-10-30');
});
test('inline direction labels identify both accounts', () => {
  const draft = read('Transfer berhasil\nDari BNI ke GoPay\nNominal Rp50.000\n30-10-2026');
  assert.equal(draft.kind, 'transfer');
  assert.equal(draft.account_id, 'bni');
  assert.equal(draft.to_account_id, 'gopay');
});
test('unknown information stays empty and does not pick first account/category or today', () => {
  const draft = read('Pembayaran berhasil\nTotal Rp75.000\nReferensi 123456789012345');
  assert.equal(draft.amount, 75000);
  assert.equal(draft.account_id, null);
  assert.equal(draft.category_id, null);
  assert.equal(draft.date, null);
  assert.ok(draft.warnings.length >= 3);
});
test('balance, references and impossible dates are never treated as a payment', () => {
  const draft = read(
    'Saldo Rp9.000.000\nNo rekening 1234567890\nReferensi 99999999999\nTanggal 31/02/2026',
  );
  assert.equal(draft.amount, null);
  assert.equal(draft.date, null);
  assert.equal(draft.kind, null);
});
test('ambiguous accounts of the same bank require user selection', () => {
  const ambiguous = [...accounts, { ...accounts[0], id: 'bni2', name: 'BNI Pribadi' }];
  assert.equal(
    extractPhotoTransaction('Pembayaran berhasil\nDari BNI\nTotal Rp50.000', ambiguous, categories)
      .account_id,
    null,
  );
  assert.equal(
    extractPhotoTransaction(
      'Pembayaran berhasil\nDari BNI Pribadi\nTotal Rp50.000',
      ambiguous,
      categories,
    ).account_id,
    'bni2',
  );
});
test('DANA is not inferred from generic dana masuk or sumber dana phrases', () => {
  assert.equal(read('Dana masuk\nRp25.000').account_id, null);
  assert.equal(
    read('Transfer berhasil\nSumber dana BNI\nTujuan GoPay\nNominal Rp25.000').account_id,
    'bni',
  );
});
test('foreign currency and multiple unlabelled amounts require correction', () => {
  assert.equal(read('TOTAL USD 25.00').amount, null);
  assert.equal(read('Pembayaran berhasil\nRp20.000\nRp50.000').amount, null);
});
test('user can override kind without losing principal/fee evidence', () => {
  const draft = extractPhotoTransaction(
    'Transfer berhasil\nDari BNI\nKe BCA\nNominal Rp100.000\nBiaya admin Rp1.000\nTotal Rp101.000',
    accounts,
    categories,
    'transfer',
  );
  assert.equal(draft.kind, 'transfer');
  assert.equal(draft.amount, 100000);
  assert.equal(draft.fee, 1000);
  assert.equal(draft.to_account_id, null);
});
test('archived accounts are not matched and missing categories are not invented', () => {
  const draft = extractPhotoTransaction(
    'Pembayaran berhasil GoPay\nTOTAL Rp20.000\nKopi',
    accounts.map((a) => ({ ...a, archived: a.id === 'gopay' })),
    [],
  );
  assert.equal(draft.account_id, null);
  assert.equal(draft.category_id, null);
});
test('photo validation accepts supported formats and rejects huge, empty or executable uploads', () => {
  assert.doesNotThrow(() => validatePhoto({ name: 'foto.jpg', type: 'image/jpeg', size: 3000 }));
  assert.throws(
    () => validatePhoto({ name: 'foto.jpg', type: 'image/jpeg', size: PHOTO_LIMIT + 1 }),
    /12 MB/,
  );
  assert.throws(() => validatePhoto({ name: 'foto.png', type: 'image/png', size: 0 }), /kosong/);
  assert.throws(() => validatePhoto({ name: 'foto.svg', type: 'image/svg+xml', size: 200 }), /JPG/);
  assert.throws(
    () => validatePhoto({ name: 'data.pdf', type: 'application/pdf', size: 200 }),
    /JPG/,
  );
});
