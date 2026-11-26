# API v1

Base: `/api/v1`. Mutasi memakai `Content-Type: application/json`. Sukses: `{data: ...}`; gagal: `{error: {message: ...}}`. Respons pribadi menggunakan `Cache-Control: no-store`.

Telegram pada deployment serverless memakai route terpisah `POST /api/telegram/webhook`, dengan `Content-Type: application/json` dan header `X-Telegram-Bot-Api-Secret-Token`. Endpoint aktif hanya pada `TELEGRAM_TRANSPORT=webhook`, menerima update Telegram maksimal 64 KB, dan mengembalikan 503 agar Telegram melakukan retry jika proses atau pengiriman balasan gagal. Endpoint ini tidak memakai cookie login web. Lihat [deployment Netlify](deployment-netlify.md).

Google memakai route browser terpisah: `POST /api/google/start` dengan `{purpose: "login" | "link" | "gmail"}` menghasilkan URL consent dan cookie state HttpOnly. `GET /api/google/callback` memverifikasi state, PKCE, nonce, identitas Google, dan memasang sesi web. Alur link/Gmail memerlukan sesi web aktif. Lihat [setup](google-gmail.md).

## Integrasi Gmail

| Metode | Endpoint               | Body / hasil                                                                                                   |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/integrations/google` | Konfigurasi yang tersedia, email terhubung, status worker/koneksi, aturan, 30 hasil impor terbaru; tanpa token |
| PATCH  | `/integrations/gmail`  | `{action: "pause"                                                                                              | "resume" | "disconnect"}` |
| POST   | `/email-rules`         | `{name,sender,subject_contains,body_contains?,kind,account_id,to_account_id?,category_id?,enabled?}`           |
| PATCH  | `/email-rules/:id`     | Body aturan lengkap; `enabled:false` menonaktifkan aturan                                                      |

Impor otomatis hanya dijalankan worker server yang memakai identitas Gmail pemilik sesi OAuth; tidak ada endpoint publik untuk menjalankan impor seluruh pengguna. Transaksi hasil impor memiliki `source: "gmail"`; transaksi lainnya `source: "manual"`.

## Autentikasi

| Metode | Endpoint       | Body                          |
| ------ | -------------- | ----------------------------- |
| POST   | `/auth/signup` | `{username,password,confirm}` |
| POST   | `/auth/login`  | `{username,password}`         |
| POST   | `/auth/logout` | `{}`                          |
| GET    | `/auth/me`     | Tidak ada                     |

Web memakai cookie HttpOnly. Sesi berlaku 30 hari dan origin mutasi browser harus sesuai `APP_ORIGIN`. Dukungan bearer untuk klien HTTP tetap tersedia melalui `X-Auth-Mode: bearer` saat login/signup, kemudian `Authorization: Bearer <token>`.

## Integrasi Telegram

| Metode | Endpoint                      | Hasil                                                                   |
| ------ | ----------------------------- | ----------------------------------------------------------------------- |
| GET    | `/integrations/telegram`      | Status konfigurasi dan koneksi pengguna, username bot; tanpa token/kode |
| POST   | `/integrations/telegram/link` | `{url}` tautan sekali pakai, 10 menit; memerlukan sesi pengguna         |
| DELETE | `/integrations/telegram`      | Putuskan tautan dan hapus kode/draf pengguna                            |

Bot memakai long polling, tanpa endpoint webhook publik. Konfirmasi memakai layanan finance yang sama dengan web. Lihat [format perintah dan setup](telegram.md).

## Keuangan

| Metode | Endpoint                               | Body / hasil                                                                                           |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/snapshot?month=YYYY-MM&account=UUID` | User, akun, kategori, transaksi, ringkasan, total, isi cepat                                           |
| POST   | `/accounts`                            | `{name,type,initial_balance}`                                                                          |
| PATCH  | `/accounts/:id`                        | Body akun lengkap                                                                                      |
| POST   | `/accounts/:id/archive`                | `{archived:true}` atau `{archived:false}`; arsip mensyaratkan saldo Rp0                                |
| POST   | `/accounts/:id/reconcile`              | `{actual}`; buat penyesuaian                                                                           |
| POST   | `/transactions`                        | Transaksi baru; wajib header `Idempotency-Key` (UUID)                                                  |
| GET    | `/transactions?month=YYYY-MM`          | `{transactions,next_cursor}`; maksimal 50 baris, mendukung `account`, `start` dan `end`, `q`, `cursor` |
| PATCH  | `/transactions/:id`                    | Body transaksi lengkap                                                                                 |
| DELETE | `/transactions/:id`                    | `{}`; biaya terkait ikut dihapus                                                                       |
| POST   | `/categories`                          | `{name,kind,budget?}`; batas opsional untuk pengeluaran                                                |
| DELETE | `/categories/:id`                      | `{}`; kategori belum terpakai                                                                          |
| PUT    | `/budgets`                             | `[{id,budget}]`; `null` menghapus batas                                                                |

Jenis akun: `bank`, `ewallet`, `cash`. Jenis kategori: `income`, `expense`. Nominal menerima integer atau string format Indonesia. Contoh body transfer berikut memakai placeholder UUID; gantikan dengan ID asli.

`POST /categories` dan `PUT /budgets` menerima query `month=YYYY-MM` (default bulan sekarang). Batas positif atau `null` berlaku mulai bulan itu hingga perubahan berikutnya. Kategori pemasukan tidak dapat diberi batas. Pembaruan batch tetap atomik. Untuk rentang khusus, `spent` menjumlahkan pengeluaran sepanjang rentang dan `budget` memakai bulan tanggal akhir.

Gunakan UUID baru untuk setiap tindakan simpan manual dan kirim ulang UUID yang sama bila respons hilang. Replay mengembalikan hasil asli; payload berbeda dengan kunci yang sudah tersimpan menghasilkan 409. Biaya admin hanya dapat diubah atau dihapus melalui transfer asal.

`GET /snapshot` menerima `view=accounts|budgets|categories|transactions|dashboard` agar hanya data yang digunakan halaman itu dihitung. Tanpa `view`, snapshot lengkap menyertakan halaman transaksi pertama. Lanjutkan dengan `GET /transactions` dan `cursor` dari `next_cursor`, memakai filter yang sama.

```json
{
  "kind": "transfer",
  "amount": "100rb",
  "account_id": "UUID-asal",
  "to_account_id": "UUID-tujuan",
  "category_id": null,
  "fee": "1rb",
  "date": "2026-10-30",
  "note": "Top up"
}
```

Untuk `income`/`expense`, isi `category_id`, kosongkan tujuan, dan gunakan `fee: 0`. PATCH mengganti semua nilai termasuk biaya; kirim biaya yang ingin dipertahankan. Biaya terkait diubah melalui transfer asal. `adjustment` hanya dibuat melalui rekonsiliasi dan tidak bisa diedit.

Snapshot mengembalikan seluruh transaksi bulan terpilih, belum dipaginasi. Filter akun memengaruhi transaksi/ringkasan, bukan total uang global atau daftar kategori. Perubahan kontrak yang memutus kompatibilitas perlu versi API baru.

Status: 400 validasi/referensi, 401 sesi, 403 origin, 404 data/endpoint, 409 duplikat, 413 ukuran, 415 tipe konten, 429 login, 500 server.
