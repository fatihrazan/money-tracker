import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTelegramTransaction,
  understandTelegramText,
  type NaturalConversation,
} from '@money/core/telegram';
const accounts = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Tunai', archived: false },
  { id: '00000000-0000-4000-8000-000000000002', name: 'BCA', archived: false },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Lama', archived: true },
];
const categories = [
  { id: '00000000-0000-4000-8000-000000000004', name: 'Makanan', kind: 'expense' as const },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Gaji', kind: 'income' as const },
];
const parse = (s: string) =>
  parseTelegramTransaction(s, accounts, categories, '2026-11-03').payload;
test('Telegram parses Indonesian expense, income, explicit transfer fee and date', () => {
  assert.equal(parse('/keluar 25rb | tunai | makanan | makan').amount, 25000);
  assert.equal(parse('/masuk 1,5jt | BCA | Gaji').kind, 'income');
  const transfer = parse('/transfer 100rb | BCA | Tunai | 2500 | tarik | 2026-11-02');
  assert.equal(transfer.fee, 2500);
  assert.equal(transfer.amount, 100000);
  assert.equal(transfer.date, '2026-11-02');
});

const understand = (text: string, previous?: NaturalConversation) =>
  understandTelegramText(text, accounts, categories, '2026-11-04', previous);
test('everyday Indonesian recognizes spending, income, word amounts and relative dates', () => {
  const expense = understand('Tadi makan siang 25 ribu pakai BCA');
  assert.equal(expense.parsed?.payload.kind, 'expense');
  assert.equal(expense.parsed?.payload.amount, 25000);
  assert.equal(expense.parsed?.payload.category_id, categories[0].id);
  assert.equal(expense.parsed?.payload.account_id, accounts[1].id);
  assert.equal(expense.parsed?.payload.date, '2026-11-04');
  assert.equal(understand('gajian lima juta masuk BCA kemarin').parsed?.payload.amount, 5000000);
  assert.equal(understand('gajian lima juta masuk BCA kemarin').parsed?.payload.date, '2026-11-03');
  assert.equal(understand('ngopi dua puluh lima ribu bayar cash').parsed?.payload.amount, 25000);
  assert.equal(
    understand('makan 2 porsi 30rb pakai BCA tanggal 31 oktober 2026').parsed?.payload.date,
    '2026-10-31',
  );
});
test('natural transfers resolve reversed account order and ask for unknown fees', () => {
  const transfer = understand('Transfer ke Tunai 100rb dari BCA admin 2.500');
  assert.equal(transfer.parsed?.payload.account_id, accounts[1].id);
  assert.equal(transfer.parsed?.payload.to_account_id, accounts[0].id);
  assert.equal(transfer.parsed?.payload.fee, 2500);
  const missingFee = understand('pindahkan 100 ribu dari BCA ke Tunai');
  assert.equal(missingFee.state.awaiting, 'fee');
  assert.equal(understand('gratis', missingFee.state).parsed?.payload.fee, 0);
  assert.equal(understand('transfer dari BCA ke Tunai 100rb tanpa biaya').parsed?.payload.fee, 0);
});
test('natural conversation fills missing fields without replacing the original amount or note', () => {
  const first = understand('makan siang 25 ribu');
  assert.equal(first.state.awaiting, 'account_id');
  assert.match(first.question!, /BCA/);
  const complete = understand('pakai BCA', first.state);
  assert.equal(complete.parsed?.payload.amount, 25000);
  assert.equal(complete.parsed?.payload.note, 'makan siang 25 ribu');
  const unknownCategory = understand('bayar servis 75rb pakai BCA');
  assert.equal(unknownCategory.state.awaiting, 'category_id');
  assert.equal(
    understand('Makanan', unknownCategory.state).parsed?.payload.category_id,
    categories[0].id,
  );
});
test('ambiguous, invalid, foreign and hypothetical inputs never become completed drafts', () => {
  for (const text of [
    'makan 25rb dan 30000 pakai BCA',
    'makan -25rb pakai BCA',
    'makan 25rb pakai Lama',
    'makan 25rb pakai BCA tanggal 2026-02-30',
    'makan 25rb pakai BCA minggu lalu',
    'transfer total 102500 dari BCA ke Tunai termasuk admin 2500',
    'bayar makan 25rb pakai BCA admin 2500',
  ])
    assert.equal(understand(text).parsed, undefined, text);
  for (const text of [
    'besok mau beli nasi 25rb pakai BCA',
    'jangan catat makan 25rb',
    'makan 25 USD pakai BCA',
  ])
    assert.throws(() => understand(text));
  const duplicate = [
    ...accounts,
    { ...accounts[1], id: '00000000-0000-4000-8000-000000000010', name: 'BCA Tabungan' },
  ];
  assert.equal(
    understandTelegramText('makan 25rb via BCA', duplicate, categories, '2026-11-04').state
      .awaiting,
    'account_id',
  );
});
test('Telegram rejects unknown, archived, ambiguous and invalid financial references', () => {
  for (const s of [
    '/keluar 1rb | Lama | Makanan',
    '/keluar -1 | Tunai | Makanan',
    '/masuk 10rb | BCA | Makanan',
    '/transfer 10rb | BCA | BCA | 0',
    '/transfer 10rb | BCA | Tunai',
    '/keluar 10rb | Tunai | Makanan | x | 2026-02-30',
    '/keluar 1rb | Tunai | Makanan | x | 2026-11-03 | extra',
  ])
    assert.throws(() => parse(s));
  assert.throws(() =>
    parseTelegramTransaction(
      '/keluar 1rb | Tunai | Makanan',
      [...accounts, { ...accounts[0], id: accounts[1].id }],
      categories,
      '2026-11-03',
    ),
  );
});
