# Login Google dan impor email bank

Login Google dan izin membaca Gmail merupakan dua alur terpisah. Login hanya meminta identitas/email. Setelah masuk, pengguna membuka **menu profil → Google & email transaksi** untuk mengizinkan Gmail dan membuat aturan. Email yang lolos aturan serta parser langsung dicatat tanpa konfirmasi per transaksi.

## Aktivasi Google Cloud

1. Buat atau pilih proyek di [Google Cloud Console](https://console.cloud.google.com/).
2. Aktifkan **Gmail API**. Konfigurasikan Google Auth Platform: nama aplikasi, email dukungan, audience, dan daftar test users untuk pengembangan.
3. Tambahkan scope `openid`, `email`, dan `https://www.googleapis.com/auth/gmail.readonly` pada konfigurasi data access.
4. Buat OAuth client dengan tipe **Web application**. Daftarkan redirect URI **persis**:

   ```text
   http://localhost:3000/api/google/callback
   ```

   Untuk deployment, gunakan `https://domain-aplikasi/api/google/callback` dan set `APP_ORIGIN` ke origin tersebut, tanpa slash terakhir. Akses HTTP memakai IP LAN tidak didukung untuk OAuth; gunakan localhost atau HTTPS.

5. Isi root `.env` (jangan kirim secret melalui chat atau commit ke Git):

   ```dotenv
   APP_ORIGIN=http://localhost:3000
   GOOGLE_CLIENT_ID=client-id-dari-google
   GOOGLE_CLIENT_SECRET=client-secret-dari-google
   GMAIL_TOKEN_KEY=kunci-base64-32-byte
   GMAIL_SYNC_ENABLED=true
   ```

   Buat kunci enkripsi sekali dengan:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Simpan hasilnya sebagai `GMAIL_TOKEN_KEY`. Kunci harus tetap sama setelah restart dan pada semua instance aplikasi/worker. Mengganti kunci mengharuskan koneksi Gmail diotorisasi ulang. Simpan cadangan kunci secara terpisah dari database.

6. Jalankan `npm run db:migrate`, kemudian restart `npm run dev` atau `npm start`.

Google menjelaskan alur client web, redirect URI, dan refresh token pada [panduan OAuth server](https://developers.google.com/identity/protocols/oauth2/web-server). Token offline memungkinkan sinkronisasi saat pengguna tidak membuka browser.

Mode **Testing** untuk aplikasi eksternal yang meminta Gmail menerbitkan refresh token dengan masa berlaku tujuh hari. Setelah habis, hubungkan ulang Gmail. Lihat [masa berlaku token Google](https://developers.google.com/identity/protocols/oauth2#expiration).

`gmail.readonly` adalah [restricted scope](https://developers.google.com/workspace/gmail/api/auth/scopes). Penggunaan publik perlu memenuhi persyaratan verifikasi dan, jika berlaku, penilaian keamanan Google; penggunaan pribadi/pengembangan memiliki pengecualian tertentu. Rujuk [persyaratan resmi](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) sebelum membuka aplikasi untuk pengguna umum.

## Memakai akun yang sudah ada

Masuk dengan nama pengguna dan kata sandi lama. Dari profil buka **Google & email transaksi**, lalu **Tautkan akun Google**. Setelah tertaut, tombol Google pada halaman login membuka akun yang sama beserta data lama.

Login Google yang belum tertaut membuat akun baru. Aplikasi tidak menggabungkan akun otomatis berdasarkan kemiripan username/email. Satu identitas Google hanya terhubung ke satu pengguna; Gmail yang dihubungkan harus memakai identitas Google yang sama. Akun yang dibuat melalui Google tidak memiliki kata sandi lokal.

## Aturan impor

1. Klik **Hubungkan Gmail** dan berikan izin membaca email. Persetujuan Google diperlukan sekali pada awal koneksi atau ketika akses perlu diperbarui.
2. Klik **Tambah aturan**, lalu pilih **Format email bank**: BNI wondr untuk pembayaran QRIS, Mandiri Livin’ untuk transfer keluar, atau **Isi sendiri**. Pilihan bank mengisi pengirim, subjek, dan penanda isi sesuai contoh yang didukung; semua isian tetap dapat diedit.
3. Pilih jenis transaksi, rekening sumber/penerima, dan kategori. Untuk pemindahan antar rekening milik sendiri gunakan **Transfer antar akun sendiri**, lalu pilih rekening tujuan.
4. Pastikan aturan cukup spesifik untuk membedakan pembayaran, transfer keluar, dan dana masuk. Jika satu email cocok dengan beberapa aturan, sistem melewatinya dan menjelaskan penyebabnya di riwayat.

Parser mendukung email teks/HTML berlabel: status berhasil, nominal Rupiah, tanggal `DD/MM/YYYY`, `YYYY-MM-DD`, atau nama bulan seperti `31 Okt 2026`, dan nomor referensi transaksi. Nama/singkatan bulan Indonesia sepanjang tahun didukung. Label umum mencakup `Nominal`, `Jumlah Transaksi`, `Total`, `Biaya Admin`, `Tanggal Transaksi`, dan `Nomor Referensi`. Nominal dan biaya diperiksa terhadap total bila tersedia. Sel tabel HTML dipisahkan menjadi baris agar label dan nilainya tidak menyatu.

Format berikut ditambahkan berdasarkan contoh isi email yang diberikan:

| Format                             | Nominal                                    | Tanggal                           | Referensi       | Jenis pencatatan                                                                           |
| ---------------------------------- | ------------------------------------------ | --------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| wondr by BNI, pembayaran QRIS      | `Nominal` dan `Total`, misalnya `Rp35.000` | `Tanggal`, misalnya `31 Okt 2026` | `Reference ID`  | Pengeluaran                                                                                |
| Livin' by Mandiri, transfer keluar | `Jumlah Transfer`, misalnya `Rp 25.000,00` | `Tanggal`, misalnya `28 Sep 2026` | `No. Referensi` | Pengeluaran untuk transfer ke pihak lain; transfer antar akun hanya untuk rekening sendiri |

Format QRIS BNI memakai kalimat konfirmasi “Kamu baru aja bayar pakai QRIS” bersama identitas format wondr, issuer BNI, dan jenis QRIS sebagai bukti selesai, meskipun tidak ada kata `berhasil`. `Merchant ID`, `Merchant PAN`, `Customer PAN`, rekening penerima, dan `Kode RRN` tidak digunakan sebagai nominal atau pengganti `Reference ID`. Notifikasi transfer keluar tidak boleh dipetakan menjadi pemasukan. Jika Mandiri tidak mencantumkan biaya, parser tidak menambahkan biaya yang tidak ada di email.

Pilihan format memakai header asli yang dikonfirmasi melalui screenshot:

| Format                           | Pengirim                          | Subjek mengandung     | Isi mengandung     |
| -------------------------------- | --------------------------------- | --------------------- | ------------------ |
| BNI wondr — Pembayaran QRIS      | `wondr@bni.co.id`                 | `Transaksi berhasil!` | `bayar pakai QRIS` |
| Mandiri Livin’ — Transfer keluar | `noreply.livin@bankmandiri.co.id` | `Transfer Berhasil`   | `Jumlah Transfer`  |

Subjek BNI cukup umum, sehingga penanda isi membatasi aturan pada pembayaran QRIS. Kedua pilihan awalnya memakai jenis **Pengeluaran**. Rekening dan kategori wajib dipilih sendiri; nama bank tidak menentukan kepemilikan rekening. Untuk Mandiri, ubah jenis menjadi **Transfer antar akun sendiri** hanya jika penerima adalah rekening milik pengguna. Mengganti pilihan format mengosongkan pilihan rekening/kategori/tujuan agar pemetaan bank sebelumnya tidak terbawa. Aturan yang sudah tersimpan tetap memakai pengaturan pengguna saat diedit.

Alamat dan subjek di atas berlaku untuk contoh yang diberikan, bukan seluruh jenis email bank tersebut. Untuk format lain, **pengirim** adalah alamat lengkap pada detail pengirim dan **subjek** adalah judul email pada header Gmail.

Tes memakai teks dan rekonstruksi tabel HTML dari screenshot, dengan nama, rekening, dan referensi disamarkan; bukan MIME email asli atau pembacaan Gmail langsung. Dukungan ini terbatas pada format tersebut, belum seluruh jenis email BNI/Mandiri. Email berupa lampiran PDF/gambar, mutasi rekening berkala, mata uang asing, atau format tidak dikenali akan dilewati.

Pengirim harus cocok tepat dan header penerimaan Gmail harus menunjukkan DMARC lolos untuk domain pengirim. Isi email tidak dijalankan sebagai instruksi, tidak digunakan untuk menentukan pengguna/rekening tanpa aturan, dan tidak dikirim ke layanan AI.

## Jadwal, data, dan duplikat

- `npm run dev` / `npm start` menyalakan worker otomatis jika client Google dan kunci Gmail sudah tersedia. Worker memeriksa email sekitar setiap 60 detik. Komputer/server serta PostgreSQL harus tetap aktif; ketika perangkat mati, impor tertunda sampai server kembali hidup.
- Untuk deployment dengan proses terpisah: set `GMAIL_SYNC_ENABLED=false` pada proses web, lalu jalankan `npm run gmail:worker`. Alternatif scheduler: panggil `npm run gmail:sync` tiap menit. Gunakan env dan database yang sama. Netlify memakai fungsi terjadwal `gmail-sync` setiap 5 menit dengan `GMAIL_SCHEDULE_ENABLED=true` serta `GMAIL_SYNC_ENABLED=false`; lihat [panduan deployment](deployment-netlify.md). Tidak ada timer yang bergantung pada request web.
- Worker memakai penguncian per pengguna untuk mencegah sinkronisasi bertumpuk. Pagination dan batas waktu scan tersimpan di database; scan dilanjutkan setelah gangguan tanpa memajukan penanda melewati halaman yang gagal.
- Email sebelum koneksi atau aturan pertama dibuat tidak diimpor. Jeda mempertahankan titik sinkronisasi, sehingga email selama jeda diproses setelah dilanjutkan. Setelah **Putuskan Gmail**, koneksi ulang memulai periode baru.
- ID email dan hash pengirim + nomor referensi + tanggal mencegah impor ulang, termasuk setelah transaksi hasil impor dihapus pengguna. Deduplicasi ini tidak menyamakan transaksi manual dengan email secara perkiraan, dan tidak otomatis menyatukan dua notifikasi berbeda dari bank asal/tujuan dengan referensi berbeda. Untuk transfer sendiri, aktifkan aturan hanya pada satu sisi notifikasi.
- Pengeluaran hasil impor mengikuti perhitungan saldo dan budget yang sama dengan transaksi manual. Sumbernya bertanda **Otomatis dari Gmail**. Koreksi/hapus transaksi tersedia melalui alur transaksi biasa.
- Isi/subjek email lengkap dan token akses sementara tidak disimpan. Database menyimpan aturan, ID email, referensi dalam bentuk hash, status/alasan, dan transaksi hasil ekstraksi. Refresh token dienkripsi AES-256-GCM dan terikat pada pengguna serta identitas Google.
- **Putuskan Gmail** menghapus token dari aplikasi dan menghentikan impor; login Google dan transaksi tetap ada. Untuk mencabut grant di sisi Google, hapus akses aplikasi dari [koneksi akun Google](https://myaccount.google.com/connections).
- Status worker dan 30 hasil impor terbaru tersedia di halaman integrasi. Email yang gagal dikenali tidak menunggu konfirmasi, melainkan dilewati dengan alasan. Riwayat yang sudah diproses tidak dicoba kembali otomatis saat aturan diedit.

## Validasi

`npm test` mencakup parser dan enkripsi. `npm run test:ui` mencakup formulir aturan. `scripts/test-integration.ps1` memakai database `_test` dan skema sementara untuk OAuth state, penautan, kepemilikan, deduplicasi, transaksi atomik, pause/disconnect, dan pemulihan pagination. Respons Google/Gmail pada tes dimock; uji OAuth nyata membutuhkan client Google serta izin pengguna.
