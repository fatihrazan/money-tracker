# Bot Telegram

## Setup

Untuk hosting online tanpa worker terus menyala, gunakan [deployment Netlify + Neon dengan webhook](deployment-netlify.md). Panduan di bawah memakai polling untuk komputer lokal.

1. Di Telegram, buka akun resmi **@BotFather**, kirim `/newbot`, dan ikuti proses pembuatan. Simpan token pada `.env` root sebagai `TELEGRAM_BOT_TOKEN`; isi `TELEGRAM_BOT_USERNAME` tanpa `@`. Token hanya dibaca server.
2. Jalankan `npm run db:migrate` lalu restart `npm run dev` atau `npm start`. Worker otomatis berjalan jika kedua konfigurasi tersedia. Untuk proses terpisah, set `TELEGRAM_ENABLED=false` pada server web dan jalankan `npm run telegram:worker` di terminal lain.
3. Login web, buka **Integrasi**, tekan **Buat tautan Telegram**, buka tautan bot lalu tekan **Start**. Tautan bersifat rahasia, sekali pakai, dan berlaku 10 menit. Satu akun web terhubung ke satu akun Telegram.
4. Kirim `/akun` dan `/kategori` untuk melihat nama yang tersedia. Gunakan chat pribadi bot. Server, database, worker, dan internet harus aktif; tidak perlu domain HTTPS/tunnel untuk long polling.

## Bahasa sehari-hari

Tidak perlu perintah atau pemisah khusus. Ceritakan satu transaksi:

```text
Tadi makan siang 25 ribu pakai BCA
Gajian lima juta masuk BCA kemarin
Transfer dari BCA ke GoPay 100rb admin 2500
Top up GoPay 50rb pakai BCA gratis
```

Bot mengenali ungkapan transaksi Indonesia yang umum, nominal angka (`25rb`, `1,5jt`, `25.000`) atau kata (`dua puluh lima ribu`, `lima juta`), akun milik pengguna, kategori, biaya, dan tanggal. Nama bank atau alias cash/tunai boleh dipakai bila mengarah ke satu akun aktif. Kategori seperti Makanan bisa dicocokkan dari makan/ngopi; jika ada beberapa kandidat, bot bertanya. Akun/kategori baru dibuat melalui web.

Jika belum lengkap, cukup jawab pertanyaan bot dengan kalimat biasa:

```text
Kamu: makan siang 25 ribu
Bot: Pakai akun mana? BCA, Tunai, ...
Kamu: pakai BCA
Bot: [ringkasan dan tombol Simpan/Batal]
```

Percakapan terikat akun pengguna dan chat Telegram, tersimpan di database, dan berlaku 10 menit sejak balasan terakhir. `/akun`, `/kategori`, dan `/bantuan` tetap bisa dipakai di tengah percakapan. Ketik `/batal` untuk membatalkan percakapan serta seluruh draf yang belum disimpan, atau `/baru` untuk mulai transaksi lain. Perintah terstruktur yang valid menggantikan percakapan yang belum lengkap.

Tanggal default mengikuti `APP_TIMEZONE`; kata `kemarin`, `kemaren`, `tadi malam`, `dua hari lalu`, tanggal ISO, `04/11/2026`, dan `4 november 2026` dikenali. Tanggal yang tidak jelas atau tidak valid akan ditanyakan kembali. Biaya transfer tidak diasumsikan gratis: sebutkan nominal, `gratis`, atau `tanpa biaya`. Transfer berarti antar akun sendiri; untuk pembayaran kepada orang lain gunakan pengeluaran.

Pemahaman memakai parser bahasa Indonesia lokal, tanpa layanan AI tambahan atau API key. Ungkapan yang belum dikenali akan memerlukan penjelasan; bot tidak memahami semua bahasa atau semua variasi kalimat. Jika ada beberapa nominal/transaksi, bot meminta satu nominal pokok yang jelas. Pesan rencana, transaksi gagal, dan mata uang asing tidak langsung menjadi draf. Nominal tanpa satuan tetap berarti Rupiah, bukan otomatis ribuan. Periksa ringkasan sebelum menekan **Simpan**.

## Format perintah lama

```text
/keluar 25rb | Tunai | Makanan | makan siang
/masuk 5jt | BCA | Gaji | gaji bulanan
/transfer 100rb | BCA | GoPay | 2500 | top up
```

Kolom dipisahkan `|`. Nama akun/kategori dicocokkan penuh tanpa membedakan huruf besar/kecil; nama ambigu atau akun arsip ditolak. Catatan opsional, maksimal 200 karakter. Biaya transfer wajib diisi, termasuk `0` bila gratis. Transfer hanya untuk perpindahan antar akun milik sendiri; pembayaran ke pihak lain dicatat sebagai pengeluaran.

Tanggal default adalah hari saat pesan diproses, sesuai `APP_TIMEZONE`. Untuk tanggal lain, tambahkan tanggal sesudah catatan:

```text
/keluar 25rb | Tunai | Makanan | makan siang | 2026-11-03
/transfer 100rb | BCA | GoPay | 0 | | 2026-11-03
```

Bot menampilkan ringkasan. Tekan **Simpan** untuk mencatat atau **Batal**. Draf berlaku 10 menit; tombol hanya berlaku untuk pemiliknya. Saldo, ringkasan, dan anggaran memakai aturan web, termasuk biaya admin sebagai pengeluaran terpisah. Muat ulang halaman web untuk mengambil perubahan terbaru. `/bantuan` dan `/help` menampilkan petunjuk.

## Operasi

- Worker memverifikasi username terhadap `getMe`. Jika gagal, periksa token/username tanpa menyalinnya ke log atau chat.
- Worker memeriksa `getWebhookInfo` dan berhenti jika webhook masih aktif. Bot ini harus khusus untuk Money Tracker. Pada deployment Netlify, webhook memang harus aktif dan worker polling tidak dijalankan; hapus webhook hanya jika ingin kembali ke polling lokal. Jangan jalankan layanan lain yang memanggil `getUpdates` pada bot yang sama.
- Jalankan satu worker per database. Advisory lock mencegah dua worker lokal membaca offset yang sama. Offset terpisah per bot ID disimpan di PostgreSQL.
- Update Telegram dicatat bersama mutasi dalam satu transaksi database. Retry atau klik Simpan berulang tidak membuat transaksi ganda. Balasan bisa terkirim ulang bila proses berhenti setelah pengiriman tetapi sebelum offset diperbarui. Jika pengguna memblokir bot, buka blokir agar antrean balasan bisa diteruskan.
- **Putuskan Telegram** di web langsung mencabut akses dan membuang percakapan, draf, dan kode tertunda. Untuk mengganti bot, putuskan semua koneksi terlebih dahulu lalu ganti token/username dan restart worker.
- Pesan yang kamu kirim ke bot berada di layanan Telegram. Alur OCR foto web tetap diproses lokal; bot ini menerima perintah teks.
- Cadangkan database. Tabel `telegram_updates` berisi receipt deduplikasi dan balasan; jangan menghapus receipt untuk update yang masih dapat dikirim ulang.

Referensi resmi: [BotFather](https://core.telegram.org/bots/features#botfather), [Bot API: getUpdates, sendMessage, callback queries](https://core.telegram.org/bots/api).
