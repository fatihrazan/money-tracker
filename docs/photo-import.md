# Pencatatan dari foto

Di **Catat transaksi**, pilih **Isi dari foto**, kemudian **Pilih foto** atau **Kamera**. Satu foto diproses untuk satu transaksi. Foto bisa berupa struk, screenshot notifikasi, atau bukti transaksi bank/e-wallet.

1. OCR membaca tulisan dalam foto dan menampilkan pratinjau.
2. Aturan ekstraksi menyarankan jenis transaksi, nominal, tanggal, akun, kategori, catatan, dan biaya admin bila bisa dikenali.
3. Jenis transaksi dapat dikoreksi sebelum menekan **Gunakan hasil**. Teks OCR juga bisa diperbaiki lewat **Teks terbaca**.
4. Hasil mengisi form; belum ada transaksi yang disimpan. Lengkapi kolom yang belum terbaca dan periksa angka sebelum menekan **Simpan transaksi**.

Transfer yang sumber dan tujuannya cocok dengan dua akun aktif pengguna dapat dibaca sebagai transfer internal. Transfer ke rekening di luar akun pengguna disarankan sebagai pengeluaran. Pengguna tetap dapat mengganti jenisnya. Biaya admin transfer dipisahkan dari nominal pokok; nominal/saldo/kembalian/ref transaksi tidak diperlakukan sebagai hal yang sama.

## Batas pembacaan

- JPG, PNG, WebP, maksimal 12 MB; resolusi maksimal 50 megapiksel, dinormalisasi hingga sisi terpanjang 2400 piksel untuk OCR.
- Dukungan nominal Rupiah dan tanggal numerik/nama bulan Indonesia atau Inggris.
- Pencocokan akun/kategori bersifat aturan teks, bukan pemahaman universal terhadap setiap layout bank. Logo tanpa tulisan, foto buram, tulisan tangan, atau bukti terpotong bisa tidak terbaca.
- Informasi yang tidak jelas dibiarkan kosong. Akun dengan nama bank yang ambigu memerlukan pemilihan manual.
- Dokumen dengan banyak transaksi sekaligus belum didukung. Mata uang selain Rupiah perlu diisi manual.
- Foto tidak menjadi lampiran transaksi dan tidak disimpan di database. Transaksi pending/gagal ditandai untuk ditinjau.

## Pemrosesan dan aset

Engine **Tesseract.js** berjalan di Web Worker pada browser. Foto dan teks OCR tidak dikirim ke server atau API pihak ketiga; hanya data form yang dikonfirmasi pengguna disimpan melalui API transaksi yang sudah ada. Worker dihentikan setelah selesai/dibatalkan dan URL pratinjau dibersihkan. Cache browser hanya digunakan untuk aset bahasa OCR.

`scripts/prepare-ocr.mjs` menyalin worker, core WebAssembly, dan model Indonesia/Inggris dari dependency npm ke `apps/web/public/ocr`. Postinstall menyiapkan aset secara otomatis. `npm run ocr:prepare` dapat dijalankan ulang; sertakan folder tersebut saat deployment. Pemanggilan OCR menggunakan path origin aplikasi, tanpa CDN dan tanpa API key.

Parser ada di `packages/core/src/photo-transaction.ts` untuk memisahkan parser transaksi dari engine OCR browser. Kode browser ada di `apps/web/lib/scan-photo.ts`; engine di-load hanya saat foto dibaca. Alur pemilihan, pratinjau, progres, koreksi, dan pengisian form ada di `components/photo-import.tsx`.

Referensi: [API Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [aset lokal](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).

## Verifikasi

`npm test` menguji parser dengan struk/pemasukan/transfer, biaya, referensi, status gagal, data ambigu, dan nilai hilang. `npm run test:ui` menguji bahwa foto tidak langsung menyimpan transaksi, koreksi form, field wajib, serta pembatalan. `npm run test:ocr` membuat gambar struk sintetis lalu menjalankan engine OCR sungguhan dengan model lokal; tidak memakai foto/data pengguna.
