# Migrasi data

Importer mempertahankan pengguna/hash password, akun/saldo awal/arsip, kategori/anggaran, serta transaksi/catatan/tanggal/penyesuaian. ID integer dipetakan ke UUID. Sesi Flask tidak diimpor; pengguna login ulang.

SQLite dibuka melalui `mode=ro`, tanpa menghapus atau menulis ulang sumber. Sesudah impor, PostgreSQL dan SQLite tidak disinkronkan; gunakan aplikasi baru untuk pencatatan berikutnya.

## Proses

1. Hentikan penulisan di Flask dan cadangkan SQLite.
2. Konfigurasi `.env` ke PostgreSQL kosong.
3. Jalankan `npm run db:migrate`.
4. Periksa dengan `npm run db:import -- instance/money.db --dry-run`.
5. Jalankan `npm run db:import -- instance/money.db`.
6. Saldo tiap akun dibandingkan sebelum commit; kegagalan membatalkan seluruh impor.
7. Login ke Next.js dengan kredensial lama.

Target yang sudah berisi pengguna/akun/kategori/transaksi ditolak agar tidak menggandakan atau menimpa data. Verifikasi password mendukung scrypt/PBKDF2 Werkzeug.

## Database tanpa login

Tentukan pemilik dengan `--owner nama_pengguna` dan environment `MIGRATION_OWNER_PASSWORD` minimal 8 karakter. Isi password secara lokal dan hapus environment tersebut setelah impor; jangan commit. Baris dengan `user_id NULL` diberikan ke pengguna pertama sesuai perilaku versi Flask.

Timestamp transaksi lama ditafsirkan sebagai UTC+07:00; periksa asumsi jika sumber dibuat di zona waktu berbeda.

## Biaya lama

Flask tidak menyimpan ID transfer asal pada transaksi biaya. Importer tidak menebak relasinya: biaya hasil impor tetap independen dan dikelola terpisah. Transfer baru memiliki biaya terhubung yang ikut diperbarui/dihapus.

## Cadangan

Gunakan `pg_dump`/`pg_restore` untuk PostgreSQL. `.env`, `.postgres`, dan `.local` diabaikan Git. Helper `scripts/postgres.ps1` mengelola cluster project, terpisah dari service lain.

Flask di `legacy/flask` merupakan referensi. Default instance path berubah setelah pemindahan kode; jika perlu menjalankannya untuk pemeriksaan, arahkan konfigurasi `DATABASE` secara eksplisit ke salinan database. Jangan memakai dua versi untuk mencatat data yang sama setelah cutover.
