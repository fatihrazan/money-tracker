# Money Tracker

Aplikasi web pribadi untuk mencatat uang masuk dan keluar dari semua bank dan e-wallet,
dengan saldo yang dihitung otomatis.

## Menjalankan

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/flask --app app run
```

Buka http://localhost:5000, lalu **Daftar** untuk membuat akun. Masuk dengan akun yang
sama di perangkat lain untuk melihat dan mencatat data yang sama. Login tersimpan 30 hari
di tiap perangkat.

Akun pertama yang didaftarkan menjadi pemilik semua data yang sudah tercatat sebelum ada
fitur login. Akun berikutnya mulai dengan data sendiri yang terpisah; setiap pengguna
hanya bisa melihat datanya sendiri.

Supaya bisa dibuka dari HP di jaringan Wi-Fi yang sama, jalankan dengan
`--host 0.0.0.0`, lalu buka `http://<IP-laptop>:5000` di HP. Koneksinya belum memakai
HTTPS, jadi kata sandi dikirim tanpa enkripsi: pakai hanya di Wi-Fi rumah yang kamu
percaya, jangan di Wi-Fi publik, dan jangan pakai kata sandi yang sama dengan akun lain.
Siapa pun yang bisa membuka alamat itu juga bisa mendaftar akun baru.

Data tersimpan di `instance/money.db`. Salin file itu untuk membuat cadangan.
`instance/secret_key` adalah kunci sesi login; jika dihapus, semua perangkat harus masuk
ulang. Bisa juga diganti lewat variabel lingkungan `SECRET_KEY`.

## Tes

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

## Struktur

- `app.py`: rute dan validasi form
- `auth.py`: daftar, masuk, keluar, dan kewajiban login di setiap halaman
- `db.py`: skema SQLite, migrasi, dan query per pengguna (termasuk perhitungan saldo)
- `money.py`: membaca nominal ("25rb", "1,5jt", "25.000") dan format Rupiah atau tanggal
- `templates/`, `static/`: tampilan
