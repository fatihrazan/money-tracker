import os
import sqlite3
from contextlib import contextmanager
from datetime import date

import pytest
from flask import g

import db
from app import AVATAR_COLORS, _secret_key, account_style, avatar_style, category_icon, create_app

PASSWORD = "rahasia123"


@pytest.fixture
def app(tmp_path):
    return create_app({"TESTING": True, "SECRET_KEY": "test", "DATABASE": str(tmp_path / "test.db")})


def signup(client, username="fatih", password=PASSWORD, confirm=None):
    return client.post("/signup", data={
        "username": username, "password": password, "confirm": password if confirm is None else confirm,
    })


@pytest.fixture
def client(app):
    """A client logged in as the first user, "fatih" (user id 1)."""
    client = app.test_client()
    assert signup(client).status_code == 302
    return client


@contextmanager
def as_user(app, user_id=1):
    with app.test_request_context():
        g.user = {"id": user_id}
        yield


def ids(app, user_id=1):
    """Account and category ids by name."""
    with as_user(app, user_id):
        accounts = {a["name"]: a["id"] for a in db.accounts()}
        categories = {(c["kind"], c["name"]): c["id"] for c in db.categories()}
    return accounts, categories


def balances(app):
    with as_user(app):
        return {a["name"]: a["balance"] for a in db.accounts_with_balance()}


def set_initial(client, app, name, amount):
    accounts, _ = ids(app)
    response = client.post(f"/accounts/{accounts[name]}/edit", data={
        "name": name, "type": "bank" if name in ("BNI", "Mandiri", "Bank Jago") else "ewallet",
        "initial_balance": amount,
    })
    assert response.status_code == 302


def test_seeded_accounts_and_dashboard(client):
    response = client.get("/")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    for name in ["BNI", "Mandiri", "Bank Jago", "GoPay", "ShopeePay"]:
        assert name in page
    assert "Mulai di sini" in page


def test_expense_income_and_transfer_with_fee(client, app):
    accounts, categories = ids(app)
    set_initial(client, app, "BNI", "1jt")
    set_initial(client, app, "GoPay", "50rb")

    # Expense from GoPay
    response = client.post("/transactions", data={
        "kind": "expense", "amount": "25rb", "account_id": accounts["GoPay"],
        "category_id": categories[("expense", "Makan & Minum")], "note": "Makan siang",
        "date": date.today().isoformat(),
    })
    assert response.status_code == 302

    # Top up GoPay from BNI with an admin fee
    client.post("/transactions", data={
        "kind": "transfer", "amount": "100.000", "account_id": accounts["BNI"],
        "to_account_id": accounts["GoPay"], "fee": "1rb", "date": date.today().isoformat(),
    })

    # Salary into BNI
    client.post("/transactions", data={
        "kind": "income", "amount": "5jt", "account_id": accounts["BNI"],
        "category_id": categories[("income", "Gaji")], "date": date.today().isoformat(),
    })

    b = balances(app)
    assert b["GoPay"] == 50_000 - 25_000 + 100_000
    assert b["BNI"] == 1_000_000 - 100_000 - 1_000 + 5_000_000

    with as_user(app):
        summary = db.month_summary(date.today().strftime("%Y-%m"))
    # The transfer itself is not an expense, only the fee is.
    assert summary["expense"] == 25_000 + 1_000
    assert summary["income"] == 5_000_000


def test_invalid_transaction_keeps_input(client, app):
    accounts, categories = ids(app)
    response = client.post("/transactions", data={
        "kind": "expense", "amount": "dua puluh", "account_id": accounts["GoPay"],
        "category_id": categories[("expense", "Belanja")], "note": "Sabun",
        "date": date.today().isoformat(),
    })
    assert response.status_code == 400
    page = response.get_data(as_text=True)
    assert "Nominal tidak valid" in page
    assert 'value="Sabun"' in page


def test_transfer_to_same_account_rejected(client, app):
    accounts, _ = ids(app)
    response = client.post("/transactions", data={
        "kind": "transfer", "amount": "10rb", "account_id": accounts["BNI"],
        "to_account_id": accounts["BNI"], "date": date.today().isoformat(),
    })
    assert response.status_code == 400
    assert "tidak boleh sama" in response.get_data(as_text=True)


def test_category_must_match_kind(client, app):
    accounts, categories = ids(app)
    response = client.post("/transactions", data={
        "kind": "expense", "amount": "10rb", "account_id": accounts["BNI"],
        "category_id": categories[("income", "Gaji")], "date": date.today().isoformat(),
    })
    assert response.status_code == 400


def test_reconcile_records_adjustment(client, app):
    accounts, _ = ids(app)
    set_initial(client, app, "ShopeePay", "200rb")
    response = client.post(f"/accounts/{accounts['ShopeePay']}/reconcile", data={"actual": "185.500"})
    assert response.status_code == 302
    assert balances(app)["ShopeePay"] == 185_500

    with as_user(app):
        summary = db.month_summary(date.today().strftime("%Y-%m"))
        assert summary["expense"] == 0  # adjustments are not spending


def test_edit_and_delete_transaction(client, app):
    accounts, categories = ids(app)
    client.post("/transactions", data={
        "kind": "expense", "amount": "30rb", "account_id": accounts["Mandiri"],
        "category_id": categories[("expense", "Belanja")], "date": date.today().isoformat(),
    })
    with as_user(app):
        tx_id = db.list_transactions()[0]["id"]

    assert client.get(f"/transactions/{tx_id}/edit").status_code == 200
    client.post(f"/transactions/{tx_id}/edit", data={
        "kind": "expense", "amount": "35rb", "account_id": accounts["Mandiri"],
        "category_id": categories[("expense", "Belanja")], "date": date.today().isoformat(),
    })
    assert balances(app)["Mandiri"] == -35_000

    client.post(f"/transactions/{tx_id}/delete")
    assert balances(app)["Mandiri"] == 0


def test_archive_requires_zero_balance(client, app):
    accounts, _ = ids(app)
    set_initial(client, app, "Bank Jago", "10rb")
    client.post(f"/accounts/{accounts['Bank Jago']}/archive")
    assert "Bank Jago" in balances(app)

    set_initial(client, app, "Bank Jago", "0")
    client.post(f"/accounts/{accounts['Bank Jago']}/archive")
    assert "Bank Jago" not in balances(app)


def test_used_category_cannot_be_deleted(client, app):
    accounts, categories = ids(app)
    belanja = categories[("expense", "Belanja")]
    client.post("/transactions", data={
        "kind": "expense", "amount": "10rb", "account_id": accounts["BNI"],
        "category_id": belanja, "date": date.today().isoformat(),
    })
    client.post(f"/categories/{belanja}/delete")
    with as_user(app):
        assert db.get_category(belanja) is not None


def test_quick_fills_appear_after_repeats(client, app):
    accounts, categories = ids(app)
    for _ in range(2):
        client.post("/transactions", data={
            "kind": "expense", "amount": "18rb", "account_id": accounts["GoPay"],
            "category_id": categories[("expense", "Makan & Minum")], "note": "Kopi",
            "date": date.today().isoformat(),
        })
    page = client.get("/").get_data(as_text=True)
    assert "Kopi · Rp18.000" in page


def test_pages_render(client):
    for url in ["/transactions", "/transactions?month=2026-01", "/accounts", "/categories",
                "/accounts/1/edit", "/accounts/1/reconcile"]:
        assert client.get(url).status_code == 200, url


@pytest.mark.parametrize("name, expected", [
    ("Makan & Minum", "utensils"),
    ("Transportasi", "car"),
    ("Biaya Admin", "percent"),
    ("Lainnya", "more"),
    ("Gaji", "briefcase"),
    ("Kopi Pagi", "coffee"),
    ("Kosmetik", "bag"),
    ("Kos", "home"),
    ("Sesuatu", "tag"),
])
def test_category_icon(name, expected):
    assert category_icon(name) == expected


def test_categories_page_uses_icons(client):
    html = client.get("/categories").get_data(as_text=True)
    assert '<span class="tx-icon tone-expense"><svg' in html
    assert '<span class="tx-icon tone-expense">M</span>' not in html


def test_categories_page_shows_expense_totals(client, app):
    accounts, categories = ids(app)
    for amount in ("25rb", "15.500"):
        client.post("/transactions", data={
            "kind": "expense", "amount": amount, "account_id": accounts["BNI"],
            "category_id": categories[("expense", "Belanja")], "date": date.today().isoformat(),
        })
    html = client.get("/categories").get_data(as_text=True)
    assert "-Rp40.500" in html


def test_categories_page_shows_income_totals(client, app):
    accounts, categories = ids(app)
    client.post("/transactions", data={
        "kind": "income", "amount": "1,5jt", "account_id": accounts["BNI"],
        "category_id": categories[("income", "Gaji")], "date": date.today().isoformat(),
    })
    html = client.get("/categories").get_data(as_text=True)
    assert "+Rp1.500.000" in html


@pytest.mark.parametrize("name, kind, expected", [
    ("BNI", "bank", "#c7520b"),
    ("Bank Jago", "bank", "#9c6e01"),
    ("GoPay", "ewallet", "#00809e"),
    ("Danamon", "bank", "#bb5b08"),
    ("DANA", "ewallet", "#0f7ac9"),
    ("Bank Lokal", "bank", "#715ef2"),
    ("Celengan", "cash", "#2b8473"),
])
def test_account_style(name, kind, expected):
    assert account_style({"name": name, "type": kind}) == f"--block: {expected};"


def test_account_colors_are_readable_with_white_text():
    from app import ACCOUNT_COLORS, ACCOUNT_TYPE_COLORS

    def luminance(color):
        def channel(c):
            return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        r, g, b = (channel(int(color[i:i + 2], 16) / 255) for i in (1, 3, 5))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    for color in [c for _, c in ACCOUNT_COLORS] + list(ACCOUNT_TYPE_COLORS.values()):
        assert 1.05 / (luminance(color) + 0.05) >= 4.5, color


# Accounts, login and separate data per user

def test_guests_are_sent_to_login(app):
    guest = app.test_client()
    response = guest.get("/transactions?month=2026-10")
    assert response.status_code == 302
    assert response.headers["Location"].startswith("/login?next=")
    assert guest.post("/transactions", data={}).status_code == 302
    assert guest.get("/login").status_code == 200
    assert guest.get("/signup").status_code == 200


def test_signup_validation(app):
    guest = app.test_client()
    assert "Nama pengguna 3–30" in signup(guest, username="a").get_data(as_text=True)
    assert "minimal 8" in signup(guest, password="pendek").get_data(as_text=True)
    assert "tidak sama" in signup(guest, confirm="lainlagi123").get_data(as_text=True)
    assert signup(guest, username="Fatih").status_code == 302  # stored lowercase
    other = app.test_client()
    page = signup(other, username="fatih").get_data(as_text=True)
    assert "sudah dipakai" in page


def test_login_and_logout(client, app):
    client.post("/logout")
    assert client.get("/").status_code == 302

    device = app.test_client()
    wrong = device.post("/login", data={"username": "fatih", "password": "salah-sekali"})
    assert wrong.status_code == 401
    assert "salah" in wrong.get_data(as_text=True)
    unknown = device.post("/login", data={"username": "siapa", "password": PASSWORD})
    assert unknown.get_data(as_text=True).count("Nama pengguna atau kata sandi salah") == 1

    ok = device.post("/login?next=/categories", data={"username": "FATIH ", "password": PASSWORD})
    assert ok.headers["Location"] == "/categories"
    assert device.get("/").status_code == 200


def test_login_ignores_offsite_next(client, app):
    device = app.test_client()
    for target in ("//evil.example", "https://evil.example", "/\\evil.example"):
        response = device.post(f"/login?next={target}", data={"username": "fatih", "password": PASSWORD})
        assert response.headers["Location"] == "/", target


def test_same_account_on_two_devices(client, app):
    accounts, categories = ids(app)
    client.post("/transactions", data={
        "kind": "expense", "amount": "12rb", "account_id": accounts["BNI"],
        "category_id": categories[("expense", "Belanja")], "note": "Sabun dari HP",
        "date": date.today().isoformat(),
    })
    laptop = app.test_client()
    laptop.post("/login", data={"username": "fatih", "password": PASSWORD})
    assert "Sabun dari HP" in laptop.get("/").get_data(as_text=True)


def test_users_cannot_see_or_touch_each_others_data(client, app):
    accounts, categories = ids(app)
    client.post("/transactions", data={
        "kind": "expense", "amount": "50rb", "account_id": accounts["BNI"],
        "category_id": categories[("expense", "Belanja")], "note": "Rahasia fatih",
        "date": date.today().isoformat(),
    })
    with as_user(app):
        tx_id = db.list_transactions()[0]["id"]

    other = app.test_client()
    signup(other, username="sari")
    page = other.get("/").get_data(as_text=True)
    assert "Rahasia fatih" not in page and "BNI" in page  # sari has her own default accounts
    assert "Rahasia fatih" not in other.get("/transactions").get_data(as_text=True)
    assert other.get(f"/transactions/{tx_id}/edit").status_code == 404
    assert other.post(f"/transactions/{tx_id}/delete").status_code == 404
    assert other.get(f"/accounts/{accounts['BNI']}/edit").status_code == 404
    assert other.post(f"/categories/{categories[('expense', 'Belanja')]}/delete").status_code == 404

    sari_accounts, sari_categories = ids(app, user_id=2)
    response = other.post("/transactions", data={
        "kind": "expense", "amount": "1rb", "account_id": accounts["BNI"],
        "category_id": sari_categories[("expense", "Belanja")], "date": date.today().isoformat(),
    })
    assert response.status_code == 400  # fatih's account id is not one of sari's accounts
    assert balances(app)["BNI"] == -50_000


def test_secret_key_survives_restarts(tmp_path, monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    first = _secret_key(str(tmp_path))
    assert _secret_key(str(tmp_path)) == first and len(first) == 64
    assert oct(os.stat(tmp_path / "secret_key").st_mode & 0o777) == "0o600"


LEGACY_SCHEMA = """
CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('bank', 'ewallet', 'cash')),
    initial_balance INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')), UNIQUE (name, kind));
CREATE TABLE transactions (id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'adjustment')),
    amount INTEGER NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts (id),
    to_account_id INTEGER REFERENCES accounts (id), category_id INTEGER REFERENCES categories (id),
    note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
CREATE INDEX idx_transactions_date ON transactions (date);
INSERT INTO accounts (id, name, type, initial_balance) VALUES (1, 'Dompet Lama', 'cash', 100000);
INSERT INTO categories (id, name, kind) VALUES (1, 'Kopi', 'expense');
INSERT INTO transactions (kind, amount, account_id, category_id, note, date)
    VALUES ('expense', 18000, 1, 1, 'Kopi susu lama', '2026-10-01');
"""


def test_old_database_is_migrated_and_given_to_the_first_user(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(LEGACY_SCHEMA)
    conn.close()

    app = create_app({"TESTING": True, "SECRET_KEY": "test", "DATABASE": str(path)})
    assert (tmp_path / "old.db.pre-login-backup").exists()

    owner = app.test_client()
    assert "semua data yang sudah tercatat" in owner.get("/signup").get_data(as_text=True)
    signup(owner)
    page = owner.get("/transactions?month=2026-10").get_data(as_text=True)
    assert "Kopi susu lama" in page and "Dompet Lama" in page
    assert balances(app) == {"Dompet Lama": 82_000}  # no defaults added on top of old data

    newcomer = app.test_client()
    assert "semua data yang sudah tercatat" not in newcomer.get("/signup").get_data(as_text=True)
    signup(newcomer, username="sari")
    page = newcomer.get("/transactions?month=2026-10").get_data(as_text=True)
    assert "Kopi susu lama" not in page and "Dompet Lama" not in page

    # Opening the migrated database again leaves it alone.
    create_app({"TESTING": True, "SECRET_KEY": "test", "DATABASE": str(path)})
    assert balances(app) == {"Dompet Lama": 82_000}


def test_avatar_color_is_from_the_palette_and_stable(client):
    styles = {avatar_style(name) for name in ("fatih", "sari", "budi", "ani", "dewi", "rudi")}
    assert all(any(color in s for color in AVATAR_COLORS) for s in styles)
    assert len(styles) > 1
    assert avatar_style("fatih") == avatar_style("fatih")
    assert avatar_style("fatih") in client.get("/").get_data(as_text=True)


# Budgets

def spend(client, app, category, amount, day=None):
    accounts, categories = ids(app)
    return client.post("/transactions", data={
        "kind": "expense", "amount": amount, "account_id": accounts["BNI"],
        "category_id": categories[("expense", category)], "date": day or date.today().isoformat(),
    }, follow_redirects=True)


def set_budgets(client, app, **budgets):
    _, categories = ids(app)
    form = {f"budget-{categories[('expense', name.replace('_', ' '))]}": value for name, value in budgets.items()}
    return client.post("/budgets", data=form)


def test_budget_page_saves_and_clears(client, app):
    assert "Belum ada anggaran" in client.get("/categories").get_data(as_text=True)
    assert client.get("/budgets").status_code == 200
    assert set_budgets(client, app, Belanja="500rb", Hiburan="200.000").status_code == 302
    with as_user(app):
        budgets = {r["name"]: r["budget"] for r in db.expense_categories_with_spent("2026-10")}
    assert budgets["Belanja"] == 500_000 and budgets["Hiburan"] == 200_000 and budgets["Tagihan"] is None

    set_budgets(client, app, Belanja="", Hiburan="200.000")
    with as_user(app):
        assert {r["name"]: r["budget"] for r in db.expense_categories_with_spent("2026-10")}["Belanja"] is None


def test_budget_validation(client, app):
    response = set_budgets(client, app, Belanja="banyak", Hiburan="0")
    assert response.status_code == 400
    page = response.get_data(as_text=True)
    assert "Anggaran Belanja tidak valid" in page and "Anggaran Hiburan harus lebih dari Rp0" in page
    assert 'value="banyak"' in page  # input kept
    with as_user(app):
        assert all(r["budget"] is None for r in db.expense_categories_with_spent("2026-10"))


def test_budget_card_shows_progress_and_state(client, app):
    set_budgets(client, app, Belanja="100rb", Hiburan="100rb", Tagihan="100rb")
    spend(client, app, "Belanja", "30rb")
    spend(client, app, "Hiburan", "85rb")
    spend(client, app, "Tagihan", "120rb")
    spend(client, app, "Belanja", "999rb", day="2000-01-15")  # another month: not counted
    page = client.get("/categories").get_data(as_text=True)
    assert "Sisa Rp70.000 · 30% terpakai" in page
    assert "Hampir habis" in page and "Sisa Rp15.000 · 85% terpakai" in page
    assert "Terlewati" in page and "Lewat Rp20.000 · 120%" in page
    assert "Rp235.000 <span>/ Rp300.000</span>" in page


def test_saving_an_expense_warns_near_and_over_budget(client, app):
    set_budgets(client, app, Belanja="100rb")
    assert "Anggaran Belanja" not in spend(client, app, "Belanja", "50rb").get_data(as_text=True)
    page = spend(client, app, "Belanja", "35rb").get_data(as_text=True)
    assert "Anggaran Belanja bulan ini tinggal Rp15.000 (85% terpakai)." in page
    page = spend(client, app, "Belanja", "40rb").get_data(as_text=True)
    assert "Anggaran Belanja bulan ini terlewati Rp25.000 (125% dari Rp100.000)." in page
    # Categories without a budget never warn.
    assert "Anggaran Hiburan" not in spend(client, app, "Hiburan", "5jt").get_data(as_text=True)


def test_budgets_are_per_user(client, app):
    _, categories = ids(app)
    other = app.test_client()
    signup(other, username="sari")
    other.post("/budgets", data={f"budget-{categories[('expense', 'Belanja')]}": "1rb"})
    with as_user(app):
        assert all(r["budget"] is None for r in db.expense_categories_with_spent("2026-10"))
    assert "Belum ada anggaran" in client.get("/categories").get_data(as_text=True)


def test_budget_column_added_to_existing_database(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(LEGACY_SCHEMA)
    conn.close()
    create_app({"TESTING": True, "SECRET_KEY": "test", "DATABASE": str(path)})
    conn = sqlite3.connect(path)
    assert "budget" in {row[1] for row in conn.execute("PRAGMA table_info(categories)")}
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
