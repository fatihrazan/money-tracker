"""Money Tracker: a personal web app for tracking money across banks and e-wallets."""
import os
import secrets
import sqlite3
from datetime import date, timedelta

from flask import Blueprint, Flask, abort, flash, redirect, render_template, request, url_for

import auth
import db
from money import (day_header, format_date, format_number, format_rupiah, month_label,
                   parse_amount, shift_month)

KIND_LABELS = {
    "expense": "Pengeluaran",
    "income": "Pemasukan",
    "transfer": "Transfer",
    "adjustment": "Penyesuaian",
}
ACCOUNT_TYPES = {"bank": "Bank", "ewallet": "E-wallet", "cash": "Tunai"}
AMOUNT_HINT = "Contoh nominal: 25000, 25.000, 25rb, 1,5jt."

# Category icon by keyword, so user-made categories ("Kopi", "Bensin", "Kos") get a fitting
# icon too. Matched against the start of each word in the name; first hit wins.
CATEGORY_ICONS = [
    ("admin", "percent"), ("biaya", "percent"), ("pajak", "percent"),
    ("kopi", "coffee"), ("ngopi", "coffee"),
    ("makan", "utensils"), ("minum", "utensils"), ("jajan", "utensils"), ("kuliner", "utensils"),
    ("groceries", "cart"), ("sembako", "cart"), ("dapur", "cart"),
    ("bensin", "fuel"), ("bbm", "fuel"),
    ("liburan", "plane"), ("travel", "plane"), ("tiket", "plane"),
    ("transport", "car"), ("ojek", "car"), ("parkir", "car"), ("tol", "car"), ("kendaraan", "car"),
    ("belanja", "bag"), ("pakaian", "bag"), ("shopping", "bag"), ("kosmetik", "bag"), ("skincare", "bag"),
    ("pulsa", "phone"), ("kuota", "phone"), ("internet", "wifi"), ("wifi", "wifi"),
    ("tagihan", "receipt"), ("listrik", "receipt"), ("cicilan", "receipt"), ("langganan", "receipt"),
    ("sewa", "home"), ("kos", "home"), ("rumah", "home"),
    ("hiburan", "film"), ("film", "film"), ("game", "film"), ("nonton", "film"),
    ("kesehatan", "health"), ("obat", "health"), ("dokter", "health"), ("olahraga", "health"),
    ("pendidikan", "graduation"), ("sekolah", "graduation"), ("kuliah", "graduation"), ("kursus", "graduation"), ("buku", "graduation"),
    ("sedekah", "heart"), ("donasi", "heart"), ("zakat", "heart"), ("amal", "heart"),
    ("gaji", "briefcase"), ("upah", "briefcase"), ("freelance", "briefcase"), ("usaha", "briefcase"),
    ("bonus", "star"), ("thr", "star"), ("insentif", "star"),
    ("hadiah", "gift"), ("kado", "gift"),
    ("cashback", "coins"), ("refund", "coins"), ("bunga", "coins"),
    ("investasi", "trending-up"), ("dividen", "trending-up"), ("tabungan", "trending-up"),
    ("lain", "more"),
]


# Account colours: each bank / e-wallet's brand colour, matched by keyword in the name
# (start of a word, first hit wins). Text on them is always white, so light brand colours
# are darkened (same hue) until white text reaches 4.5:1 contrast (WCAG AA).
ACCOUNT_COLORS = [
    ("bni", "#c7520b"), ("mandiri", "#003d79"), ("jago", "#9c6e01"), ("blu", "#007ead"),
    ("bca", "#0060af"), ("bri", "#00529c"), ("bsi", "#008480"), ("btn", "#005aab"),
    ("cimb", "#7a0019"), ("danamon", "#bb5b08"), ("permata", "#008848"), ("jenius", "#007fae"),
    ("seabank", "#cf4900"), ("gopay", "#00809e"), ("ovo", "#4c3494"), ("dana", "#0f7ac9"),
    ("shopee", "#de3412"), ("linkaja", "#e81f25"),
    ("tunai", "#2b8473"), ("cash", "#2b8473"), ("dompet", "#2b8473"),
]
# Accounts with no known brand fall back to a colour by type.
ACCOUNT_TYPE_COLORS = {"bank": "#715ef2", "ewallet": "#34845f", "cash": "#2b8473"}


def account_style(account):
    words = account["name"].lower().split()
    for keyword, color in ACCOUNT_COLORS:
        if any(word.startswith(keyword) for word in words):
            break
    else:
        color = ACCOUNT_TYPE_COLORS.get(account["type"], "#9c6d07")
    return f"--block: {color};"


# Each user's avatar gets one of the palette's solid colours, picked from their username
# so it stays the same on every device.
AVATAR_COLORS = ["--block-pink", "--block-teal", "--block-amber", "--block-green", "--block-orange"]


def avatar_style(username):
    return f"--avatar: var({AVATAR_COLORS[sum(map(ord, username)) % len(AVATAR_COLORS)]});"


def category_icon(name):
    words = name.lower().replace("&", " ").split()
    for keyword, icon in CATEGORY_ICONS:
        if any(word.startswith(keyword) for word in words):
            return icon
    return "tag"

bp = Blueprint("main", __name__)


def _secret_key(instance_path):
    """A key that survives restarts, so logins stay valid: $SECRET_KEY, else instance/secret_key."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(instance_path, "secret_key")
    if not os.path.exists(path):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        DATABASE=os.path.join(app.instance_path, "money.db"),
        # Stay logged in on each device for 30 days. SameSite=Lax keeps other sites from
        # submitting forms here with the user's session.
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_HTTPONLY=True,
    )
    if test_config:
        app.config.update(test_config)
    os.makedirs(app.instance_path, exist_ok=True)
    if not app.config.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = _secret_key(app.instance_path)

    app.teardown_appcontext(db.close_db)
    with app.app_context():
        db.init_db()

    app.jinja_env.filters.update(
        rupiah=format_rupiah, number=format_number, tanggal=format_date,
        day_header=day_header, month_label=month_label, category_icon=category_icon,
        account_style=account_style, avatar_style=avatar_style,
    )
    app.jinja_env.globals.update(KIND_LABELS=KIND_LABELS, ACCOUNT_TYPES=ACCOUNT_TYPES)
    app.register_blueprint(auth.bp)
    app.register_blueprint(bp)
    app.before_request(auth.load_user)
    return app


def _to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _this_month():
    return date.today().strftime("%Y-%m")


def parse_transaction_form(form):
    """Validate an expense/income/transfer form. Returns (data, errors)."""
    errors = []
    kind = form.get("kind", "expense")
    if kind not in ("expense", "income", "transfer"):
        errors.append("Jenis transaksi tidak valid.")

    amount = None
    try:
        amount = parse_amount(form.get("amount", ""))
    except ValueError:
        errors.append(f"Nominal tidak valid. {AMOUNT_HINT}")
    else:
        if amount <= 0:
            errors.append("Nominal harus lebih dari Rp0.")

    account_id = _to_int(form.get("account_id"))
    if account_id is None or db.get_account(account_id) is None:
        errors.append("Pilih akun.")

    to_account_id = category_id = None
    if kind == "transfer":
        to_account_id = _to_int(form.get("to_account_id"))
        if to_account_id is None or db.get_account(to_account_id) is None:
            errors.append("Pilih akun tujuan.")
        elif to_account_id == account_id:
            errors.append("Akun asal dan tujuan tidak boleh sama.")
    else:
        category_id = _to_int(form.get("category_id"))
        category = db.get_category(category_id) if category_id else None
        if category is None or category["kind"] != kind:
            errors.append("Pilih kategori.")

    tx_date = form.get("date") or date.today().isoformat()
    try:
        date.fromisoformat(tx_date)
    except ValueError:
        errors.append("Tanggal tidak valid.")

    data = {
        "kind": kind,
        "amount": amount,
        "account_id": account_id,
        "to_account_id": to_account_id,
        "category_id": category_id,
        "note": form.get("note", "").strip()[:200],
        "date": tx_date,
    }
    return data, errors


def _tx_form_context(form, include_archived=False):
    return {
        "form": form,
        "accounts": db.accounts(include_archived),
        "expense_categories": db.categories("expense"),
        "income_categories": db.categories("income"),
    }


def _default_form():
    last = db.last_used_expense()
    return {
        "kind": "expense",
        "account_id": last["account_id"] if last else "",
        "category_id": last["category_id"] if last else "",
        "date": date.today().isoformat(),
    }


# Budgets

BUDGET_WARN_AT = 0.8  # "almost used up" from 80% of the monthly budget


def budget_info(row):
    """Progress of one category's monthly budget: share used, what's left, and its state."""
    budget, spent = row["budget"], row["spent"]
    used = spent / budget
    state = "over" if spent > budget else "warn" if used >= BUDGET_WARN_AT else "ok"
    return {"id": row["id"], "name": row["name"], "budget": budget, "spent": spent,
            "percent": round(used * 100), "left": budget - spent, "state": state}


def budget_overview(month):
    rows = [budget_info(r) for r in db.expense_categories_with_spent(month) if r["budget"]]
    total = {"budget": sum(r["budget"] for r in rows), "spent": sum(r["spent"] for r in rows)}
    return rows, (budget_info({"id": None, "name": "", **total}) if rows else None)


def flash_budget_warning(data):
    """After saving an expense, warn if its category's budget for that month is nearly or fully used."""
    if data["kind"] != "expense":
        return
    month = data["date"][:7]
    row = next((r for r in db.expense_categories_with_spent(month) if r["id"] == data["category_id"]), None)
    if row is None or not row["budget"]:
        return
    info = budget_info(row)
    when = "bulan ini" if month == _this_month() else month_label(month)
    if info["state"] == "over":
        flash(f"Anggaran {info['name']} {when} terlewati {format_rupiah(-info['left'])} "
              f"({info['percent']}% dari {format_rupiah(info['budget'])}).", "warning")
    elif info["state"] == "warn":
        flash(f"Anggaran {info['name']} {when} tinggal {format_rupiah(info['left'])} "
              f"({info['percent']}% terpakai).", "warning")


def _dashboard_context(form):
    balances = db.accounts_with_balance()
    return {
        "balances": balances,
        "total": sum(a["balance"] for a in balances),
        "month": _this_month(),
        "summary": db.month_summary(_this_month()),
        "recent": db.list_transactions(limit=8),
        "quick_fills": db.quick_fills(),
        "needs_setup": db.needs_setup(),
        **_tx_form_context(form),
    }


# Dashboard and transactions

@bp.get("/")
def dashboard():
    return render_template("dashboard.html", **_dashboard_context(_default_form()))


@bp.post("/transactions")
def create_transaction():
    data, errors = parse_transaction_form(request.form)
    fee = 0
    if data["kind"] == "transfer" and request.form.get("fee", "").strip():
        try:
            fee = parse_amount(request.form["fee"])
        except ValueError:
            errors.append(f"Biaya admin tidak valid. {AMOUNT_HINT}")
        else:
            if fee < 0:
                errors.append("Biaya admin tidak boleh negatif.")
    if errors:
        context = _dashboard_context(request.form.to_dict())
        return render_template("dashboard.html", errors=errors, **context), 400

    db.insert_transaction(data)
    if fee:
        to_account = db.get_account(data["to_account_id"])
        db.insert_transaction({
            "kind": "expense",
            "amount": fee,
            "account_id": data["account_id"],
            "to_account_id": None,
            "category_id": db.fee_category_id(),
            "note": f"Biaya transfer ke {to_account['name']}",
            "date": data["date"],
        })
    db.get_db().commit()

    message = f"{KIND_LABELS[data['kind']]} {format_rupiah(data['amount'])} tersimpan."
    if fee:
        message += f" Biaya admin {format_rupiah(fee)} dicatat sebagai pengeluaran."
    flash(message, "success")
    flash_budget_warning(data)
    return redirect(url_for("main.dashboard"))


@bp.get("/transactions")
def transactions():
    month = request.args.get("month", "")
    try:
        date.fromisoformat(f"{month}-01")
    except ValueError:
        month = _this_month()
    account_id = _to_int(request.args.get("account"))
    return render_template(
        "transactions.html",
        txs=db.list_transactions(month=month, account_id=account_id),
        summary=db.month_summary(month, account_id),
        month=month,
        prev_month=shift_month(month, -1),
        next_month=shift_month(month, 1),
        accounts=db.accounts(include_archived=True),
        account_id=account_id,
    )


@bp.route("/transactions/<int:tx_id>/edit", methods=["GET", "POST"])
def edit_transaction(tx_id):
    tx = db.get_transaction(tx_id) or abort(404)
    errors = []
    if request.method == "POST" and tx["kind"] != "adjustment":
        data, errors = parse_transaction_form(request.form)
        if not errors:
            db.update_transaction(tx_id, data)
            db.get_db().commit()
            flash("Transaksi diperbarui.", "success")
            flash_budget_warning(data)
            return redirect(url_for("main.transactions", month=data["date"][:7]))
        form = request.form.to_dict()
    else:
        form = dict(tx)
        form["amount"] = format_number(tx["amount"])
    return render_template(
        "transaction_edit.html", tx=tx, errors=errors,
        **_tx_form_context(form, include_archived=True),
    ), 400 if errors else 200


@bp.post("/transactions/<int:tx_id>/delete")
def delete_transaction(tx_id):
    tx = db.get_transaction(tx_id) or abort(404)
    db.delete_transaction(tx_id)
    db.get_db().commit()
    flash("Transaksi dihapus.", "success")
    return redirect(url_for("main.transactions", month=tx["date"][:7]))


# Accounts

def parse_account_form(form):
    errors = []
    name = form.get("name", "").strip()[:50]
    if not name:
        errors.append("Nama akun wajib diisi.")
    account_type = form.get("type")
    if account_type not in ACCOUNT_TYPES:
        errors.append("Jenis akun tidak valid.")
    initial_balance = 0
    if form.get("initial_balance", "").strip():
        try:
            initial_balance = parse_amount(form["initial_balance"])
        except ValueError:
            errors.append(f"Saldo awal tidak valid. {AMOUNT_HINT}")
    return {"name": name, "type": account_type, "initial_balance": initial_balance}, errors


@bp.get("/accounts")
def accounts():
    return render_template(
        "accounts.html",
        active=db.accounts_with_balance(),
        archived=db.accounts_with_balance(archived=True),
    )


@bp.post("/accounts")
def create_account():
    data, errors = parse_account_form(request.form)
    if not errors:
        try:
            db.insert_account(data)
            db.get_db().commit()
        except sqlite3.IntegrityError:
            errors.append(f"Akun \"{data['name']}\" sudah ada.")
    for error in errors:
        flash(error, "error")
    if not errors:
        flash(f"Akun {data['name']} ditambahkan.", "success")
    return redirect(url_for("main.accounts"))


@bp.route("/accounts/<int:account_id>/edit", methods=["GET", "POST"])
def edit_account(account_id):
    account = db.get_account(account_id) or abort(404)
    errors = []
    form = dict(account)
    form["initial_balance"] = format_number(account["initial_balance"])
    if request.method == "POST":
        data, errors = parse_account_form(request.form)
        if not errors:
            try:
                db.update_account(account_id, data)
                db.get_db().commit()
            except sqlite3.IntegrityError:
                errors.append(f"Akun \"{data['name']}\" sudah ada.")
            else:
                flash(f"Akun {data['name']} diperbarui.", "success")
                return redirect(url_for("main.accounts"))
        form = request.form.to_dict()
    return render_template(
        "account_edit.html", account=account, form=form, errors=errors
    ), 400 if errors else 200


@bp.post("/accounts/<int:account_id>/archive")
def toggle_archive(account_id):
    account = db.account_with_balance(account_id) or abort(404)
    if not account["archived"] and account["balance"] != 0:
        flash(
            f"Saldo {account['name']} masih {format_rupiah(account['balance'])}. "
            "Pindahkan atau cocokkan saldonya ke Rp0 dulu sebelum diarsipkan.",
            "error",
        )
    else:
        db.set_archived(account_id, not account["archived"])
        db.get_db().commit()
        state = "diaktifkan lagi" if account["archived"] else "diarsipkan"
        flash(f"Akun {account['name']} {state}.", "success")
    return redirect(url_for("main.accounts"))


@bp.route("/accounts/<int:account_id>/reconcile", methods=["GET", "POST"])
def reconcile_account(account_id):
    account = db.account_with_balance(account_id) or abort(404)
    errors = []
    if request.method == "POST":
        try:
            actual = parse_amount(request.form.get("actual", ""))
        except ValueError:
            errors.append(f"Saldo tidak valid. {AMOUNT_HINT}")
        else:
            diff = actual - account["balance"]
            if diff == 0:
                flash(f"Saldo {account['name']} sudah cocok.", "success")
            else:
                db.insert_transaction({
                    "kind": "adjustment",
                    "amount": diff,
                    "account_id": account_id,
                    "to_account_id": None,
                    "category_id": None,
                    "note": f"Tercatat {format_rupiah(account['balance'])}, "
                            f"saldo asli {format_rupiah(actual)}",
                    "date": date.today().isoformat(),
                })
                db.get_db().commit()
                sign = "+" if diff > 0 else ""
                flash(
                    f"Selisih {sign}{format_rupiah(diff)} dicatat sebagai penyesuaian. "
                    f"Saldo {account['name']} sekarang {format_rupiah(actual)}.",
                    "success",
                )
            return redirect(url_for("main.accounts"))
    return render_template(
        "reconcile.html", account=account, errors=errors
    ), 400 if errors else 200


# Categories

@bp.get("/categories")
def categories():
    rows = db.categories_with_usage()
    budgets, budget_total = budget_overview(_this_month())
    return render_template(
        "categories.html",
        expense=[c for c in rows if c["kind"] == "expense"],
        income=[c for c in rows if c["kind"] == "income"],
        month=_this_month(),
        budgets=budgets,
        budget_total=budget_total,
    )


@bp.route("/budgets", methods=["GET", "POST"])
def budgets():
    month = _this_month()
    rows = db.expense_categories_with_spent(month)
    errors = []
    form = {f"budget-{r['id']}": format_number(r["budget"]) if r["budget"] else "" for r in rows}
    if request.method == "POST":
        form = {key: request.form.get(key, "").strip() for key in form}
        values = {}
        for r in rows:
            text = form[f"budget-{r['id']}"]
            if not text:
                values[r["id"]] = None
                continue
            try:
                amount = parse_amount(text)
            except ValueError:
                errors.append(f"Anggaran {r['name']} tidak valid. {AMOUNT_HINT}")
                continue
            if amount <= 0:
                errors.append(f"Anggaran {r['name']} harus lebih dari Rp0, atau kosongkan untuk tanpa batas.")
            else:
                values[r["id"]] = amount
        if not errors:
            for category_id, amount in values.items():
                db.set_budget(category_id, amount)
            db.get_db().commit()
            flash("Anggaran disimpan.", "success")
            return redirect(url_for("main.categories"))
    return render_template(
        "budgets.html", rows=rows, form=form, month=month, errors=errors
    ), 400 if errors else 200


@bp.post("/categories")
def create_category():
    name = request.form.get("name", "").strip()[:50]
    kind = request.form.get("kind")
    if not name or kind not in ("expense", "income"):
        flash("Isi nama dan jenis kategori.", "error")
    else:
        try:
            db.insert_category(name, kind)
            db.get_db().commit()
            flash(f"Kategori {name} ditambahkan.", "success")
        except sqlite3.IntegrityError:
            flash(f"Kategori \"{name}\" sudah ada.", "error")
    return redirect(url_for("main.categories"))


@bp.post("/categories/<int:category_id>/delete")
def delete_category(category_id):
    category = db.get_category(category_id) or abort(404)
    used = db.category_usage(category_id)
    if used:
        flash(f"Kategori {category['name']} masih dipakai {used} transaksi.", "error")
    else:
        db.delete_category(category_id)
        db.get_db().commit()
        flash(f"Kategori {category['name']} dihapus.", "success")
    return redirect(url_for("main.categories"))


if __name__ == "__main__":
    create_app().run(debug=True)
