# Money Tracker v2

Aplikasi pencatatan uang masuk/keluar lintas bank, e-wallet, dan tunai. Stack baru: **Next.js 16 App Router, React 19, TypeScript, Zod, PostgreSQL 18**, dalam npm workspaces.

## Struktur

```text
apps/web/                Halaman React, layanan finance/auth, API /api/v1
packages/core/           Validasi, tipe data, nominal Rupiah, tanggal/anggaran
packages/database/       Pool PostgreSQL, transaksi atomik, migrasi SQL
packages/api-client/     Klien HTTP untuk web
scripts/                Migrasi skema, impor SQLite, helper PostgreSQL Windows
tests/                  Tes unit dan integrasi PostgreSQL/API
docs/                   Arsitektur, API, panduan migrasi
legacy/flask/           Kode Flask sebagai referensi
instance/               SQLite asli dan kunci lama; tidak diubah atau di-commit
```

## Menjalankan di komputer ini

PostgreSQL khusus project sudah diinisialisasi di **127.0.0.1:5433**, dengan data di `.postgres/`. Server PostgreSQL yang sebelumnya ada di port 5432 tidak diubah. Password acak tersimpan di `.env` lokal yang diabaikan Git.

```powershell
# Cek status; jalankan start bila belum hidup.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/postgres.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/postgres.ps1 start

npm ci
npm run db:migrate
npm run dev
```

Buka **http://localhost:3000**. Data SQLite project sudah diimpor. Login memakai nama pengguna dan kata sandi yang sama; sesi Flask lama tidak dibawa. Jangan impor ulang ke database yang sudah berisi data.

Untuk produksi lokal: `npm run build`, lalu `npm start`. Semua perintah npm dijalankan dari root; script web memuat `.env` root sebelum menjalankan Next.js.

## Setup checkout baru

Memerlukan Node.js **20.20+** dan PostgreSQL. Pilih salah satu cara berikut.

**Docker**:

```powershell
Copy-Item .env.example .env
docker compose up -d
npm ci
npm run db:migrate
npm run dev
```

**PostgreSQL Windows sudah terpasang**, tanpa Docker:

```powershell
# Hanya jika .env dan .postgres belum ada.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/postgres.ps1 init
npm ci
npm run db:migrate
npm run dev
```

**PostgreSQL lain/managed**: salin `.env.example` ke `.env`, isi `DATABASE_URL`, lalu jalankan migrasi. Ikuti persyaratan TLS penyedia; aplikasi tidak menonaktifkan verifikasi sertifikat.

## Fitur

- Daftar/login/logout, password scrypt, sesi perangkat 30 hari, data terpisah per pengguna.
- Login/daftar Google dan penautan akun lama. Impor email bank lewat Gmail berjalan otomatis setelah izin serta aturan rekening/kategori disiapkan; lihat [setup Google & Gmail](docs/google-gmail.md).
- Akun bank/e-wallet/tunai, saldo awal, arsip, pencocokan saldo.
- Pemasukan, pengeluaran, transfer/biaya admin, ubah/hapus transaksi.
- Saldo dihitung dari seluruh riwayat; transfer dan penyesuaian tidak dihitung dalam pemasukan/pengeluaran.
- Transfer baru memiliki biaya admin terhubung yang ikut diperbarui/dihapus.
- Kategori, anggaran bulanan berulang, progres dan peringatan dari 80% pemakaian.
- Menu **Anggaran** untuk menambah/mengubah batas per kategori, memilih bulan, dan melihat batas, terpakai, sisa, atau kelebihan anggaran. Batas juga bisa diisi saat menambah kategori pengeluaran; ringkasannya tampil di beranda.
- Filter bulan/akun, input `25rb`/`25.000`/`1,5jt`, isi cepat pengeluaran berulang.
- **Isi dari foto**: unggah struk/bukti transaksi atau gunakan kamera, periksa hasil, lalu isi form pengeluaran/pemasukan/transfer. OCR lokal tanpa API key; foto tidak disimpan di server.
- Responsif, tema netral/teal terang dan gelap, dropdown/kalender kustom, serta animasi yang mengikuti preferensi reduced motion.

## Tracking anggaran per kategori

1. Buka **Anggaran → Tambah anggaran**, pilih kategori pengeluaran, lalu isi batas bulanan (misalnya `500rb`). Kamu juga bisa mengisi batas saat membuat kategori baru di **Kategori**.
2. Catat pengeluaran seperti biasa. Pemakaian kategori dijumlahkan dari semua akun berdasarkan tanggal transaksi pada bulan yang dipilih.
3. Gunakan panah bulan untuk melihat batas, terpakai, dan sisa setiap kategori. Status berubah menjadi **Hampir habis** mulai 80%, **Habis** saat tepat 100%, dan **Terlewati** jika melebihi batas.
4. Klik **Ubah batas** untuk mengganti anggaran. Kosongkan nominal lalu simpan untuk menghapus batas tanpa menghapus transaksi.

Batas berlaku dari bulan yang dipilih hingga perubahan berikutnya. Bulan sebelumnya tetap memakai batas lama. Untuk rentang tanggal, pemakaian mengikuti rentang dan batas mengikuti bulan tanggal akhir. Batas lama dari migrasi tetap menjadi batas awal. Menghapus batas tidak menghapus transaksi. Sisa tidak dibawa ke bulan berikutnya.

## Impor SQLite

```powershell
npm run db:import -- instance/money.db --dry-run
npm run db:import -- instance/money.db
```

Memerlukan Python 3, tanpa Flask/dependency tambahan. Sumber dibuka read-only. Target wajib kosong. Impor atomik memetakan ID ke UUID dan membandingkan saldo setiap akun sebelum commit. Hash password Werkzeug tetap dapat dipakai untuk login. Lihat [panduan migrasi](docs/migration.md).

## Pemeriksaan

```powershell
npm test
npm run test:ui
npm run test:ocr
npm run test:db
npm run typecheck
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-integration.ps1
```

`npm run test:db` menyiapkan PostgreSQL sementara di port acak, menjalankan tes integrasi, lalu membersihkannya. Di Windows perintah ini memakai instalasi PostgreSQL bila `initdb` ada di PATH; selain itu diperlukan Docker aktif. Perintah yang sama dipakai di CI. Untuk database uji yang sudah ada, set `TEST_DATABASE_URL` ke database berakhiran `_test` lalu jalankan `npm run test:integration`, atau gunakan helper PowerShell di atas untuk cluster lokal yang aktif. Tes impor memerlukan Python 3.

OCR memerlukan aset worker, WebAssembly, dan model Indonesia/Inggris. `npm ci` menyiapkannya melalui `postinstall` ke `apps/web/public/ocr/` (diabaikan Git). Jika install script dinonaktifkan, jalankan `npm run ocr:prepare` sebelum dev/build. Folder ini harus ikut deployment. Lihat [fitur foto](docs/photo-import.md).

## Bot Telegram

Aplikasi berfokus pada web. Bot Telegram dapat mencatat pengeluaran, pemasukan, dan transfer ke database yang sama. Buat bot melalui **@BotFather**, isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_BOT_USERNAME` pada `.env`, jalankan `npm run db:migrate`, lalu restart `npm run dev` atau `npm start`. Worker otomatis berjalan bersama web ketika konfigurasi tersedia. Untuk worker terpisah, set `TELEGRAM_ENABLED=false` dan jalankan `npm run telegram:worker`.

Buka **Integrasi ? Buat tautan Telegram ? Buka bot Telegram**, lalu tekan **Start**. Tautan sekali pakai berlaku 10 menit. Ceritakan transaksi dengan bahasa sehari-hari, memakai akun milikmu:

```text
Tadi makan siang 25 ribu pakai BCA
Gajian lima juta masuk BCA kemarin
Transfer dari BCA ke GoPay 100rb admin 2500
```

Bot bertanya jika akun, kategori, nominal, tanggal, atau biaya belum jelas; jawab dengan teks biasa. Periksa ringkasan dan tekan **Simpan** atau **Batal**. Tidak ada transaksi tersimpan sebelum konfirmasi. Ketik `/batal` atau `/baru` untuk membuang draf dan memulai ulang. Ketik `/akun`, `/kategori`, atau `/bantuan` untuk petunjuk. Lihat [panduan Telegram](docs/telegram.md).

Lihat [arsitektur](docs/architecture.md) dan [kontrak API](docs/api.md).

## Hosting Netlify + Neon

Deployment serverless disiapkan melalui `netlify.toml`. Telegram memakai webhook dan Gmail memakai fungsi terjadwal 5 menit. Jalankan `npm run deploy:prepare`, isi `.env.production`, lalu ikuti [panduan deployment](docs/deployment-netlify.md). Akun penyedia, database Neon, dan environment produksi diperlukan sebelum publikasi; data lokal tidak otomatis dipindahkan.

## Konfigurasi

- `APP_ORIGIN`: origin web yang boleh mengirim mutasi. Untuk akses melalui IP LAN, ganti sesuai alamat yang dipakai dan restart server.
- `COOKIE_SECURE=false`: HTTP lokal; gunakan `true` untuk deployment HTTPS.
- `APP_TIMEZONE=Asia/Jakarta`: tanggal otomatis server.
- Cadangkan PostgreSQL memakai `pg_dump`; `.postgres/` merupakan data runtime.
- Pencatatan manual, foto web, impor notifikasi Gmail, dan bot Telegram tersedia. Impor Gmail memerlukan konfigurasi OAuth, server aktif, dan format email yang dikenali; koneksi langsung ke API bank dan reset password/email belum termasuk setup lokal ini.
