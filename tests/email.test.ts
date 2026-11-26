import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBankEmail, emailRuleSchema } from '@money/core/email-transactions';
import { messageContent, type GmailMessage } from '../apps/web/lib/gmail';
import { encryptRefreshToken, decryptRefreshToken } from '../apps/web/lib/google';
import {
  bniQrisText,
  bniQrisHtml,
  bniReference,
  mandiriTransferText,
  mandiriTransferHtml,
  mandiriReference,
} from './fixtures/bank-emails';

const email = `Transaksi berhasil
Tanggal Transaksi: 31/10/2026 12:15 WIB
Nominal: Rp100.000,00
Biaya Admin: Rp2.500,00
Total: Rp102.500,00
Nomor Referensi: REF-123456
Saldo tersedia: Rp9.000.000`;

function htmlMessage(html: string): GmailMessage {
  return {
    id: 'sample',
    internalDate: '1793400000000',
    payload: {
      mimeType: 'text/html',
      body: { data: Buffer.from(html).toString('base64url') },
    },
  };
}

test('wondr BNI QRIS screenshot layout parses without a generic success word', () => {
  const expected = { ok: true, amount: 35000, fee: 0, date: '2026-10-31', reference: bniReference };
  assert.deepEqual(parseBankEmail('Notifikasi pembayaran', bniQrisText, 'expense'), expected);
  const htmlText = messageContent(htmlMessage(bniQrisHtml)).body;
  assert.match(htmlText, /Nominal\s+Rp35\.000/);
  assert.deepEqual(parseBankEmail('Notifikasi pembayaran', htmlText, 'expense'), expected);
  // Text/plain can put the value on the same line, while the heading stays separate.
  const inline = bniQrisText
    .replace('Tanggal\n31 Okt 2026', 'Tanggal   31 Okt 2026')
    .replace('Nominal\nRp35.000', 'Nominal: Rp35.000');
  assert.deepEqual(parseBankEmail('', inline, 'expense'), expected);
  for (const kind of ['income', 'transfer'] as const)
    assert.equal(parseBankEmail('', bniQrisText, kind).ok, false);
});

test('Livin Mandiri outgoing transfer supports named months, cents, and No. Referensi', () => {
  const expected = {
    ok: true,
    amount: 25000,
    fee: 0,
    date: '2026-09-28',
    reference: mandiriReference,
  };
  for (const body of [mandiriTransferText, messageContent(htmlMessage(mandiriTransferHtml)).body]) {
    assert.deepEqual(parseBankEmail('', body, 'expense'), expected);
    assert.deepEqual(parseBankEmail('', body, 'transfer'), expected);
    assert.equal(parseBankEmail('', body, 'income').ok, false);
  }
});

test('bank dates support Indonesian month names and non-breaking spaces throughout the year', () => {
  for (const [index, aliases] of [
    'Jan Januari',
    'Feb Februari',
    'Mar Maret',
    'Apr April',
    'Mei',
    'Jun Juni',
    'Jul Juli',
    'Agu Agt Agustus',
    'Sep Sept September',
    'Okt Oktober',
    'Nov November',
    'Des Desember',
  ].entries()) {
    for (const alias of aliases.split(' ')) {
      const result = parseBankEmail(
        '',
        mandiriTransferText.replace('28 Sep 2026', `1\u00a0${alias.toUpperCase()}.\u202f2026`),
        'expense',
      );
      assert.ok(result.ok, alias);
      assert.equal(result.date, `2026-${String(index + 1).padStart(2, '0')}-01`);
    }
  }
});

test('bank receipt layouts reject inconsistent dates, references and failed transactions', () => {
  for (const body of [
    bniQrisText.replace('31 Okt 2026', '31 Sep 2026'),
    bniQrisText.replace('31 Okt 2026', '31 TidakAda 2026'),
    bniQrisText + '\nTanggal: 30 Okt 2026',
    bniQrisText + '\nReference ID: DIFFERENT-REF',
    bniQrisText.replace(`Reference ID\n${bniReference}`, ''),
    bniQrisText.replace('Total\nRp35.000', 'Total\nRp36.000'),
    bniQrisText + '\nStatus: gagal',
    bniQrisText.replace('Kamu baru aja bayar pakai QRIS', 'Ayo bayar pakai QRIS'),
    mandiriTransferText.replace('Transfer Berhasil', 'Transfer belum berhasil'),
    mandiriTransferText.replace('Transfer Berhasil', 'Status: pending'),
  ])
    assert.equal(parseBankEmail('', body, 'expense').ok, false);
  // A merchant ID, Customer PAN or RRN is not a fallback for the transaction reference.
  assert.equal(
    parseBankEmail(
      '',
      mandiriTransferText.replace(`No. Referensi\n${mandiriReference}`, ''),
      'expense',
    ).ok,
    false,
  );
});

test('empty text alternatives fall back to the HTML bank receipt without fetching its images', () => {
  const message: GmailMessage = {
    ...htmlMessage(''),
    payload: {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('  ').toString('base64url') } },
        htmlMessage(mandiriTransferHtml).payload!,
      ],
    },
  };
  const parsed = parseBankEmail('', messageContent(message).body, 'expense');
  assert.ok(parsed.ok);
  assert.equal(parsed.amount, 25000);
  assert.equal(parsed.reference, mandiriReference);
});

test('email parser distinguishes principal, total debit and transfer fees', () => {
  assert.deepEqual(parseBankEmail('Transaksi berhasil', email, 'expense'), {
    ok: true,
    amount: 102500,
    fee: 0,
    date: '2026-10-31',
    reference: 'REF-123456',
  });
  assert.deepEqual(parseBankEmail('Transaksi berhasil', email, 'transfer'), {
    ok: true,
    amount: 100000,
    fee: 2500,
    date: '2026-10-31',
    reference: 'REF-123456',
  });
  assert.equal(parseBankEmail('Transaksi berhasil', email, 'income').ok, false);
  assert.deepEqual(
    parseBankEmail(
      'Transfer successful',
      email.replace('Rp2.500,00', 'Rp0,00').replace('Rp102.500,00', 'Rp100.000,00'),
      'income',
    ),
    { ok: true, amount: 100000, fee: 0, date: '2026-10-31', reference: 'REF-123456' },
  );
});
test('unsafe or ambiguous emails are never converted into a guessed transaction', () => {
  for (const body of [
    email.replace('Transaksi berhasil', 'Transaksi gagal'),
    email.replace('Transaksi berhasil', 'Status: pending'),
    email.replace('Rp100.000,00', 'USD100.00'),
    email.replace('Rp102.500,00', 'Rp90.000,00'),
    email.replace('31/10/2026', '31/02/2026'),
    email.replace('Nomor Referensi: REF-123456', ''),
    email.replace('Tanggal Transaksi: 31/10/2026 12:15 WIB', ''),
    email + '\nNominal: Rp300.000',
    email.replace('Nominal: Rp100.000,00', '').replace('Total: Rp102.500,00', ''),
    email.replace('Transaksi berhasil', 'Notifikasi bank'),
  ])
    assert.equal(parseBankEmail('Notifikasi', body, 'expense').ok, false, body);
  assert.equal(parseBankEmail('Kode OTP transaksi', email, 'expense').ok, false);
  assert.equal(
    parseBankEmail('Transaksi berhasil', email.replace('Rp100.000,00', 'Rp100.000,50'), 'expense')
      .ok,
    false,
  );
});
test('HTML MIME extraction uses text alternatives and requires receiving-server authentication', () => {
  const message: GmailMessage = {
    id: '1',
    internalDate: '1793400000000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Bank <notify@bank.example>' },
        { name: 'Subject', value: 'Pembayaran berhasil' },
        {
          name: 'Authentication-Results',
          value: 'mx.google.com; dmarc=pass (p=REJECT) header.from=bank.example',
        },
      ],
      parts: [
        {
          mimeType: 'text/html',
          body: {
            data: Buffer.from(
              '<table><tr><td>Nominal:</td><td>Rp100.000</td></tr></table><script>alert(1)</script>',
            ).toString('base64url'),
          },
        },
        { mimeType: 'text/plain', body: { data: Buffer.from(email).toString('base64url') } },
      ],
    },
  };
  assert.equal(messageContent(message).body, email);
  assert.equal(messageContent(message).authenticated, true);
  message.payload!.parts!.pop();
  assert.match(messageContent(message).body, /Nominal/);
  assert.doesNotMatch(messageContent(message).body, /alert/);
  message.payload!.headers!.unshift({
    name: 'Authentication-Results',
    value: 'mx.google.com; dmarc=fail header.from=bank.example',
  });
  assert.equal(messageContent(message).authenticated, false, 'Ignore a later injected pass header');
});
test('refresh tokens are encrypted and bound to both application user and Google identity', (t) => {
  const previous = process.env.GMAIL_TOKEN_KEY;
  process.env.GMAIL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  t.after(() => {
    if (previous === undefined) delete process.env.GMAIL_TOKEN_KEY;
    else process.env.GMAIL_TOKEN_KEY = previous;
  });
  const encrypted = encryptRefreshToken('test-refresh-token', 'user-1', 'google-1');
  assert.equal(encrypted.includes('test-refresh-token'), false);
  assert.equal(decryptRefreshToken(encrypted, 'user-1', 'google-1'), 'test-refresh-token');
  assert.throws(() => decryptRefreshToken(encrypted, 'user-2', 'google-1'));
  assert.throws(() => decryptRefreshToken(encrypted, 'user-1', 'google-2'));
  assert.throws(() =>
    decryptRefreshToken(
      encrypted.replace(/^./, encrypted[0] === 'a' ? 'b' : 'a'),
      'user-1',
      'google-1',
    ),
  );
});
test('email rules require explicit account, category, and distinct transfer destination', () => {
  const rule = {
    name: 'Bank',
    sender: 'NOTIFY@bank.example',
    subject_contains: 'Pembayaran berhasil',
    kind: 'expense',
    account_id: 'e404bad9-53c9-44ed-afd5-c3d861350e67',
    category_id: 'bb3f83cb-1156-4c6b-9472-543bc0b81cda',
  };
  assert.equal(emailRuleSchema.parse(rule).sender, 'notify@bank.example');
  assert.equal(emailRuleSchema.safeParse({ ...rule, category_id: null }).success, false);
  assert.equal(
    emailRuleSchema.safeParse({ ...rule, kind: 'transfer', to_account_id: rule.account_id })
      .success,
    false,
  );
});
