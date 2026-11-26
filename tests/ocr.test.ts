import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWorker, OEM } from 'tesseract.js';
import { extractPhotoTransaction } from '@money/core/photo-transaction';

test(
  'real OCR reads a generated receipt using self-hosted Indonesian and English models',
  { timeout: 90000 },
  async () => {
    const lines = [
      'KOPI PAGI',
      '30/10/2026',
      'Metode pembayaran GoPay',
      'SUBTOTAL Rp18.000',
      'PAJAK Rp2.000',
      'TOTAL Rp20.000',
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="white"/>${lines.map((line, i) => `<text x="50" y="${80 + i * 85}" fill="black" font-family="Arial" font-size="44">${line}</text>`).join('')}</svg>`;
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    const worker = await createWorker(['ind', 'eng'], OEM.LSTM_ONLY, {
      langPath: fileURLToPath(new URL('../apps/web/public/ocr/lang/', import.meta.url)),
      gzip: true,
      cacheMethod: 'none',
    });
    try {
      await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      const result = await worker.recognize(image);
      assert.ok(result.data.text.length > 20);
      const draft = extractPhotoTransaction(
        result.data.text,
        [
          {
            id: 'gopay',
            name: 'GoPay',
            type: 'ewallet',
            initial_balance: 0,
            balance: 0,
            archived: false,
          },
        ],
        [
          {
            id: 'food',
            name: 'Makan & Minum',
            kind: 'expense',
            budget: null,
            spent: 0,
            total: 0,
            used: 0,
          },
        ],
      );
      assert.equal(draft.amount, 20000);
      assert.equal(draft.date, '2026-10-30');
      assert.equal(draft.kind, 'expense');
      assert.equal(draft.account_id, 'gopay');
      assert.equal(draft.category_id, 'food');
    } finally {
      await worker.terminate();
    }
  },
);
