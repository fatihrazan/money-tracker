# Deploy Netlify + Neon

Kode sudah disiapkan untuk web Next.js, PostgreSQL Neon, Telegram webhook, dan sinkronisasi Gmail setiap 5 menit. Paket gratis tetap mengikuti kuota masing-masing penyedia. Akun Netlify dan Neon perlu dibuat oleh pemilik aplikasi sebelum situs dapat diterbitkan.

## 1. Buat akun dan proyek Neon

Daftar di https://console.neon.tech dan buat proyek pada paket Free. Pilih region dekat pengguna/Netlify. Di **Connect**, salin dua connection string: pooled untuk runtime dan direct/non-pooled untuk migrasi. Pertahankan parameter TLS lainnya yang diberikan Neon; ubah `sslmode=require` menjadi `sslmode=verify-full` untuk memverifikasi sertifikat dan hostname.

## 2. Siapkan konfigurasi privat

Dari root proyek:

```powershell
npm run deploy:prepare
```

Perintah membuat `.env.production` jika belum ada, menyalin konfigurasi bot/Google yang tersedia di `.env`, serta membuat secret webhook dan kunci enkripsi Gmail. File lama tidak ditimpa. `.env` lokal tetap memakai PostgreSQL lokal dan polling.

Isi `.env.production`:

- `DATABASE_URL`: URL Neon pooled.
- `DIRECT_DATABASE_URL`: URL Neon direct, hanya untuk migrasi dari komputer ini.
- `APP_ORIGIN`: origin Netlify produksi, contoh `https://money-tracker-anda.netlify.app`, tanpa trailing slash. Isi setelah memilih nama situs.

Jangan upload `.env`, `.env.production`, folder `instance`, `.postgres`, atau file backup ke repository. `.env.production.example` hanya berisi contoh kosong yang aman dibagikan.

## 3. Buat proyek Netlify

Daftar di https://app.netlify.com/signup. Setelah login, buat proyek untuk aplikasi ini dan pilih nama situs agar URL produksi diketahui. Isi URL itu di `APP_ORIGIN`.

**Jalur yang disarankan di Windows: build langsung di Netlify dari repository Git.** Buat repository privat di penyedia Git yang kamu gunakan, push source proyek, lalu di Netlify pilih **Add new project ? Import an existing project** dan hubungkan repository tersebut. Kamu dapat mengganti nama situs setelah dibuat.

Untuk repository baru dari folder ini, setelah menyiapkan remote repository:

```powershell
git init
git add .gitignore .env.example .env.production.example .prettierignore .prettierrc netlify.toml package.json package-lock.json tsconfig.json compose.yaml README.md apps/web packages scripts tests docs netlify
git diff --cached --name-only
# Pastikan file rahasia/data runtime tidak masuk daftar, lalu commit dan push ke remote milikmu.
```

File rahasia diabaikan oleh `.gitignore`; jangan memakai `git add -f`. Hindari upload seluruh folder melalui drag-and-drop karena cara itu tidak mengikuti `.gitignore`.

CLI tersedia sebagai alternatif jika mesin mendukung symlink (Linux/WSL atau Windows yang sudah memiliki izin tersebut). `npm run deploy:login` membuka login browser. Saat deploy, pilih/buat situs melalui CLI. Tidak ada repository Git yang diperlukan untuk jalur CLI.

Konfigurasi build sudah disimpan di `netlify.toml`:

| Pengaturan          | Nilai                    |
| ------------------- | ------------------------ |
| Base directory      | root proyek              |
| Build command       | `npm run build`          |
| Publish directory   | `apps/web/.next`         |
| Functions directory | `netlify/functions`      |
| Runtime build       | Node 22                  |
| Next.js adapter     | `@netlify/plugin-nextjs` |

Jika menggunakan integrasi Git, atur package directory ke `apps/web` dan pastikan base tetap root serta konfigurasi root `netlify.toml` dipakai. Semua workspace di `packages/` wajib ikut source. Jangan gunakan drag-and-drop folder `.next` sebagai situs statis; aplikasi memerlukan fungsi server.

CLI Netlify yang dipakai memerlukan Node 22.13+. Script `deploy:login`, `deploy:build`, dan `deploy:netlify` memakai Node 22 melalui npm exec agar instalasi Node sistem tidak berubah.

## 4. Migrasi Neon dan environment Netlify

```powershell
npm run deploy:check
npm run db:migrate:production
```

Migrasi produksi hanya menerima URL Neon direct dengan TLS terverifikasi. Perintah ini membuat skema; **data keuangan lokal belum disalin**. Untuk memindahkan data lama, lakukan migrasi database terpisah setelah menyiapkan backup. Jangan mengimpor ulang SQLite ke database yang sudah berisi transaksi.

Di Netlify **Project configuration → Environment variables**, masukkan nilai dari `.env.production` untuk konteks production dan scope yang mencakup Functions. Masukkan `DATABASE_URL`, `APP_ORIGIN`, `COOKIE_SECURE`, `APP_TIMEZONE`, `PG_POOL_MAX`, semua `TELEGRAM_*`, `GMAIL_SYNC_ENABLED`, `GMAIL_SCHEDULE_ENABLED`, serta konfigurasi Google/Gmail jika digunakan. **Jangan upload `DIRECT_DATABASE_URL`**; fungsi runtime cukup memakai koneksi pooled.

Untuk serverless, nilai pentingnya:

```text
COOKIE_SECURE=true
PG_POOL_MAX=3
TELEGRAM_TRANSPORT=webhook
TELEGRAM_ENABLED=false
GMAIL_SYNC_ENABLED=false
GMAIL_SCHEDULE_ENABLED=true
```

Jangan berikan kredensial produksi kepada Deploy Previews atau branch dari pihak lain. Jika environment diubah, lakukan deployment ulang agar fungsi memakai nilai terbaru.

## 5. Build dan deploy

Untuk jalur repository Git, setelah mengisi runtime environment dan menjalankan migrasi Neon, pilih **Deploys ? Trigger deploy ? Deploy site** di Netlify. Netlify membangun proyek di lingkungan Linux berdasarkan `netlify.toml`.

Untuk jalur CLI pada mesin yang mendukung symlink:

```powershell
npm run deploy:build
npm run deploy:netlify
```

Build pertama dapat mengunduh CLI dan adapter. Deployment produksi memerlukan login dan pemilihan akun/proyek Netlify. Pada Windows ini, pengujian adapter lokal mencapai build Next.js yang sukses tetapi gagal menyalin symlink dengan `EPERM`; gunakan build di Netlify sebagai jalur utama. Pengaturan Windows tidak diubah. Pastikan URL hasil deploy sama dengan `APP_ORIGIN`; jika nama situs berubah, sesuaikan environment dan deploy ulang. Aset OCR disiapkan melalui `postinstall` dan ikut build web.

## 6. Aktifkan webhook Telegram

Hentikan worker polling lokal memakai Ctrl+C sebelum memindahkan bot ke deployment online. Bot yang sama tidak dapat memakai polling dan webhook bersamaan.

```powershell
npm run telegram:webhook
npm run telegram:webhook -- --status
```

Script memeriksa identitas bot dan endpoint produksi dengan secret yang sama, kemudian mendaftarkan webhook tanpa membuang update tertunda. Endpoint `/api/telegram/webhook` memeriksa header secret, membatasi ukuran payload, menyimpan receipt atomik, lalu mengirim balasan sebelum mengakui update. Retry tidak menggandakan transaksi; balasan masih bisa terkirim ulang setelah kegagalan koneksi.

Login web online dan tautkan Telegram melalui **Integrasi**. Database Neon yang baru memiliki akun/tautan tersendiri; tautan dari database lokal tidak otomatis dipindahkan.

Untuk kembali ke polling, jalankan `npm run telegram:webhook -- --delete`, lalu gunakan konfigurasi lokal `TELEGRAM_TRANSPORT=polling` dan restart web/worker lokal. Menghapus webhook tidak menghapus transaksi atau update tertunda.

## 7. Google dan Gmail bila digunakan

Tambahkan origin produksi serta redirect URI `https://NAMA-SITUS.netlify.app/api/google/callback` pada OAuth client Google. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `GMAIL_TOKEN_KEY` pada runtime Netlify, deploy ulang, lalu hubungkan Google/Gmail dari web online.

Netlify menjalankan `gmail-sync` setiap 5 menit untuk published production deploy. Fungsi terjadwal tidak menyediakan endpoint HTTP publik. Pemindaian memakai budget 20 detik, lease per pengguna yang kompatibel dengan Neon transaction pooling, receipt deduplikasi, serta pagination/watermark yang dapat dilanjutkan. Jika antrean banyak, pemindaian diteruskan pada jadwal berikutnya. Pengaturan `GMAIL_SCHEDULE_ENABLED=false` menonaktifkan pekerjaan. Tanpa konfigurasi Google, pekerjaan tidak membaca Gmail.

Periksa halaman Functions Netlify untuk `gmail-sync` dan gunakan **Run now** bila perlu. Status aktif pada web memperhitungkan jeda jadwal 5 menit. Alur OAuth/Gmail yang berjalan online memerlukan aplikasi dan izin Google yang valid.

Referensi: [Next.js di Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [Netlify CLI build](https://cli.netlify.com/commands/build/), [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling), [Telegram webhook](https://core.telegram.org/bots/api#setwebhook).
