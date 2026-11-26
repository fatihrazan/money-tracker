# Arsitektur

```text
Web React ? API /api/v1 ? layanan auth/finance ? PostgreSQL
Bot Telegram ? worker ? layanan finance ? PostgreSQL
```

`apps/web/app` menentukan halaman dan boundary HTTP. Komponen React memakai `packages/api-client`. `apps/web/lib/finance.ts` menjalankan alur keuangan yang dipakai web dan bot. `packages/database` menyediakan pool, transaksi, dan migrasi SQL; `packages/core` menyediakan validasi serta parser nominal/perintah.

## Aturan data

Setiap akun/kategori/transaksi memiliki `user_id NOT NULL`. Foreign key komposit `(user_id,id)` mencegah referensi antar pengguna di level database. API juga memvalidasi kepemilikan.

Nominal Rupiah disimpan sebagai `bigint`, diterima sebagai integer aman, maksimal Rp9 triliun per input. Pecahan di bawah Rp1 ditolak. Driver menolak saldo agregat yang melebihi integer aman JavaScript.

View `account_balances` menghitung saldo awal + pemasukan - pengeluaran + transfer masuk - transfer keluar + penyesuaian. Ringkasan bulanan hanya mencakup pemasukan/pengeluaran. Total beranda memakai seluruh riwayat akun aktif.

Transfer dan biaya disimpan atomik. `parent_transfer_id` menghubungkan satu biaya dengan transfer; penghapusan transfer menghapus biayanya. Mutasi mengunci akun dalam urutan ID yang konsisten agar pencocokan saldo, pengarsipan, dan transaksi tidak saling menimpa. Aktifkan akun arsip sebelum mengubah saldo/riwayatnya.

Anggaran disimpan pada kategori dan berulang setiap bulan. Belum ada riwayat batas berbeda per bulan: perubahan batas juga memengaruhi tampilan bulan lama. Total kategori mencakup seluruh riwayat; progres anggaran memakai bulan terpilih.

Kategori pengeluaran menerima batas opsional saat dibuat. Menu Anggaran dan halaman Kategori memakai snapshot bulan terpilih untuk menampilkan sisa (`budget - spent`); beranda memakai bulan berjalan. Pemakaian mencakup seluruh akun, hanya transaksi pengeluaran pada rentang awal bulan inklusif hingga awal bulan berikutnya eksklusif. Sisa tidak diakumulasi antarbulan. Pembaruan satu anggaran hanya mengirim kategori tersebut ke `PUT /budgets`, sehingga batas kategori lain tetap utuh. Mengosongkan batas menyimpan `null` tanpa mengubah transaksi. Total sisa adalah selisih total batas dan pemakaian kategori berbatas; kategori yang terlewati tetap ditandai walaupun total sisa masih positif.

## Autentikasi

Password baru memakai scrypt; verifier mendukung hash Werkzeug scrypt/PBKDF2. Token sesi acak 256-bit disimpan sebagai SHA-256 di database, berlaku 30 hari, dan dicabut saat logout perangkat.

Web memakai cookie HttpOnly/SameSite=Lax. API juga mempertahankan dukungan bearer token untuk klien HTTP. Origin mutasi browser diperiksa, payload divalidasi Zod, dan CORS umum tidak diaktifkan. Login dibatasi per nama pengguna dalam jendela 15 menit.

Google OpenID Connect memakai authorization code + PKCE, state satu kali yang terikat cookie browser, nonce, dan verifikasi ID token oleh `google-auth-library`. Identitas memakai `sub`, bukan pencocokan email. Akun username dapat ditautkan melalui sesi aktif; akun Google baru memiliki `password_hash=NULL`. Izin Gmail bersifat terpisah, memakai scope readonly dan refresh token terenkripsi dengan kunci aplikasi. Worker lokal atau fungsi Netlify terjadwal memanggil Gmail dari identitas pengguna tersebut, mencocokkan aturan miliknya, kemudian menyimpan transaksi dan receipt deduplicasi dalam transaksi database yang sama. Receipt tetap ada setelah transaksi dihapus untuk mencegah impor ulang. Lihat [desain dan pengoperasian Gmail](google-gmail.md).

## Telegram

Parser bahasa Indonesia di `packages/core/src/telegram-natural.ts` mengekstrak transaksi dari teks sehari-hari tanpa layanan AI eksternal. Informasi yang ambigu ditanyakan satu per satu. `telegram_conversations` menyimpan state parsial dan field yang sedang ditanyakan, terikat pengguna/Telegram ID serta masa berlaku 10 menit. Penyelesaian percakapan hanya membuat draf; tombol Simpan tetap diperlukan. Receipt deduplikasi juga mencakup perubahan state percakapan. Disconnect, `/batal`, dan `/baru` menghapus state terkait.

Di lokal, worker long polling berjalan bersama dev/start atau sebagai proses terpisah. Netlify menggunakan endpoint webhook dengan secret header; receipt dan layanan finance sama dengan polling. Penautan memakai kode acak sekali pakai yang disimpan sebagai hash dan berlaku 10 menit. Telegram ID/chat pribadi unik ditautkan ke satu pengguna. Draf terikat pengguna dan Telegram ID; konfirmasi serta deduplikasi update dan penulisan transaksi/biaya commit secara atomik. Disconnect menghapus tautan, kode, dan draf; mutasi bot mengunci pengguna yang sama dengan disconnect. Offset persisten diteruskan setelah balasan terkirim; retry balasan tidak membuat transaksi baru. Worker memakai advisory lock agar hanya satu polling aktif per database. Lihat [pengoperasian Telegram](telegram.md).

Migrasi `003_mobile_login.sql` dipertahankan sebagai riwayat. Migrasi `004_telegram_web.sql` menghapus tabel login Android dan kolom redirect mobile. Source, build, dan alur login Android telah dihapus.

Manifest/metadata web app tersedia, tanpa service worker atau kemampuan offline. Data keuangan tetap membutuhkan server.

Versi dependency dikunci di `package-lock.json`. Implementasi mengikuti [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation) dan [transaksi node-postgres](https://node-postgres.com/features/transactions).
