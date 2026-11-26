"""SQLite storage. Amounts are whole rupiah stored as INTEGER.

Transaction kinds and their effect on balances:
  expense     account_id loses amount
  income      account_id gains amount
  transfer    account_id loses amount, to_account_id gains it (not an expense)
  adjustment  account_id changes by the signed amount (from balance reconciliation)

Every account, category and transaction belongs to a user (user_id). Queries here are
always scoped to the logged-in user, g.user; rows of other users are never returned.
"""
import shutil
import sqlite3

from flask import current_app, g

from money import shift_month

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users (id),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('bank', 'ewallet', 'cash')),
    initial_balance INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users (id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    budget INTEGER CHECK (budget > 0),  -- monthly limit for expense categories; NULL = none
    UNIQUE (user_id, name, kind)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users (id),
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'adjustment')),
    amount INTEGER NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    to_account_id INTEGER REFERENCES accounts (id),
    category_id INTEGER REFERENCES categories (id),
    note TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions (user_id, date);
"""

DEFAULT_ACCOUNTS = [
    ("BNI", "bank"),
    ("Mandiri", "bank"),
    ("Bank Jago", "bank"),
    ("GoPay", "ewallet"),
    ("ShopeePay", "ewallet"),
    ("Tunai", "cash"),
]

FEE_CATEGORY = "Biaya Admin"

DEFAULT_CATEGORIES = {
    "expense": ["Makan & Minum", "Transportasi", "Belanja", "Tagihan", "Hiburan",
                "Kesehatan", "Pendidikan", FEE_CATEGORY, "Lainnya"],
    "income": ["Gaji", "Bonus", "Hadiah", "Cashback", "Lainnya"],
}

BALANCE_SQL = """
SELECT a.*, a.initial_balance + COALESCE((
    SELECT SUM(CASE
        WHEN t.kind = 'transfer' AND t.to_account_id = a.id THEN t.amount
        WHEN t.kind IN ('expense', 'transfer') THEN -t.amount
        ELSE t.amount
    END)
    FROM transactions t
    WHERE t.account_id = a.id OR t.to_account_id = a.id
), 0) AS balance
FROM accounts a
WHERE a.user_id = ?
"""

TRANSACTION_SQL = """
SELECT t.*, a.name AS account_name, ta.name AS to_account_name, c.name AS category_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.user_id = ?
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def _uid():
    """The logged-in user's id. Every data query goes through this."""
    return g.user["id"]


def init_db():
    conn = get_db()
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(accounts)")}
    if columns and "user_id" not in columns:
        _migrate_to_users(conn)
    conn.executescript(SCHEMA)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(categories)")}
    if "budget" not in columns:
        conn.execute("ALTER TABLE categories ADD COLUMN budget INTEGER CHECK (budget > 0)")
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def _migrate_to_users(conn):
    """Upgrade a single-user database: add user_id everywhere and make names unique per user.

    Existing rows keep user_id NULL until the first user signs up and claims them
    (see create_user). A copy of the database file is kept next to it first.
    """
    path = current_app.config["DATABASE"]
    shutil.copy2(path, f"{path}.pre-login-backup")
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript("""
        BEGIN;
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE accounts_new (
            id INTEGER PRIMARY KEY,
            user_id INTEGER REFERENCES users (id),
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('bank', 'ewallet', 'cash')),
            initial_balance INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            UNIQUE (user_id, name)
        );
        INSERT INTO accounts_new (id, name, type, initial_balance, archived)
            SELECT id, name, type, initial_balance, archived FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
        CREATE TABLE categories_new (
            id INTEGER PRIMARY KEY,
            user_id INTEGER REFERENCES users (id),
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
            UNIQUE (user_id, name, kind)
        );
        INSERT INTO categories_new (id, name, kind) SELECT id, name, kind FROM categories;
        DROP TABLE categories;
        ALTER TABLE categories_new RENAME TO categories;
        ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users (id);
        DROP INDEX IF EXISTS idx_transactions_date;
        COMMIT;
    """)
    conn.execute("PRAGMA foreign_keys = ON")
    problems = conn.execute("PRAGMA foreign_key_check").fetchall()
    if problems:
        raise RuntimeError(f"Migration left broken references: {problems[:5]}")


# Users

def get_user(user_id):
    return get_db().execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()


def user_count():
    return get_db().execute("SELECT COUNT(*) FROM users").fetchone()[0]


def get_user_by_username(username):
    return get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def create_user(username, password_hash):
    """Create a user and give them data to start with. Raises sqlite3.IntegrityError if taken.

    The very first user inherits the data from before logins existed (rows with no
    user_id). Anyone who still has no accounts or categories gets the defaults.
    """
    conn = get_db()
    first = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    user_id = conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, password_hash)
    ).lastrowid
    if first:
        for table in ("accounts", "categories", "transactions"):
            conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL", (user_id,))
    if not conn.execute("SELECT 1 FROM accounts WHERE user_id = ?", (user_id,)).fetchone():
        conn.executemany(
            "INSERT INTO accounts (user_id, name, type) VALUES (?, ?, ?)",
            [(user_id, name, kind) for name, kind in DEFAULT_ACCOUNTS],
        )
    if not conn.execute("SELECT 1 FROM categories WHERE user_id = ?", (user_id,)).fetchone():
        conn.executemany(
            "INSERT INTO categories (user_id, name, kind) VALUES (?, ?, ?)",
            [(user_id, name, kind) for kind, names in DEFAULT_CATEGORIES.items() for name in names],
        )
    conn.commit()
    return user_id


# Accounts

def accounts(include_archived=False):
    where = "" if include_archived else "AND archived = 0"
    return get_db().execute(
        f"SELECT * FROM accounts WHERE user_id = ? {where} ORDER BY archived, id", (_uid(),)
    ).fetchall()


def get_account(account_id):
    return get_db().execute(
        "SELECT * FROM accounts WHERE id = ? AND user_id = ?", (account_id, _uid())
    ).fetchone()


def accounts_with_balance(archived=False):
    return get_db().execute(
        BALANCE_SQL + " AND a.archived = ? ORDER BY a.id", (_uid(), int(archived))
    ).fetchall()


def account_with_balance(account_id):
    return get_db().execute(BALANCE_SQL + " AND a.id = ?", (_uid(), account_id)).fetchone()


def insert_account(data):
    get_db().execute(
        "INSERT INTO accounts (user_id, name, type, initial_balance)"
        " VALUES (:user_id, :name, :type, :initial_balance)",
        {**data, "user_id": _uid()},
    )


def update_account(account_id, data):
    get_db().execute(
        "UPDATE accounts SET name = :name, type = :type, initial_balance = :initial_balance"
        " WHERE id = :id AND user_id = :user_id",
        {**data, "id": account_id, "user_id": _uid()},
    )


def set_archived(account_id, archived):
    get_db().execute(
        "UPDATE accounts SET archived = ? WHERE id = ? AND user_id = ?",
        (int(archived), account_id, _uid()),
    )


def needs_setup():
    """True until the user has entered starting balances or recorded anything."""
    uid = _uid()
    row = get_db().execute(
        "SELECT (SELECT COUNT(*) FROM accounts WHERE user_id = ? AND initial_balance != 0)"
        " + (SELECT COUNT(*) FROM transactions WHERE user_id = ?)",
        (uid, uid),
    ).fetchone()
    return row[0] == 0


# Categories

def categories(kind=None):
    if kind:
        return get_db().execute(
            "SELECT * FROM categories WHERE user_id = ? AND kind = ? ORDER BY id", (_uid(), kind)
        ).fetchall()
    return get_db().execute(
        "SELECT * FROM categories WHERE user_id = ? ORDER BY kind, id", (_uid(),)
    ).fetchall()


def categories_with_usage():
    return get_db().execute(
        "SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS used,"
        " (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.category_id = c.id) AS total"
        " FROM categories c WHERE c.user_id = ? ORDER BY c.kind, c.id",
        (_uid(),),
    ).fetchall()


def get_category(category_id):
    return get_db().execute(
        "SELECT * FROM categories WHERE id = ? AND user_id = ?", (category_id, _uid())
    ).fetchone()


def insert_category(name, kind):
    get_db().execute(
        "INSERT INTO categories (user_id, name, kind) VALUES (?, ?, ?)", (_uid(), name, kind)
    )


def category_usage(category_id):
    return get_db().execute(
        "SELECT COUNT(*) FROM transactions WHERE category_id = ? AND user_id = ?",
        (category_id, _uid()),
    ).fetchone()[0]


def delete_category(category_id):
    get_db().execute("DELETE FROM categories WHERE id = ? AND user_id = ?", (category_id, _uid()))


# Budgets: a monthly spending limit per expense category

def expense_categories_with_spent(month):
    """All expense categories with their budget (or None) and what was spent in `month`."""
    return get_db().execute(
        "SELECT c.id, c.name, c.budget, COALESCE((SELECT SUM(t.amount) FROM transactions t"
        "   WHERE t.category_id = c.id AND t.kind = 'expense' AND t.date >= ? AND t.date < ?), 0) AS spent"
        " FROM categories c WHERE c.user_id = ? AND c.kind = 'expense' ORDER BY c.id",
        (f"{month}-01", f"{shift_month(month, 1)}-01", _uid()),
    ).fetchall()


def set_budget(category_id, budget):
    get_db().execute(
        "UPDATE categories SET budget = ? WHERE id = ? AND user_id = ? AND kind = 'expense'",
        (budget, category_id, _uid()),
    )


def fee_category_id():
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM categories WHERE user_id = ? AND name = ? AND kind = 'expense'",
        (_uid(), FEE_CATEGORY),
    ).fetchone()
    if row:
        return row["id"]
    return conn.execute(
        "INSERT INTO categories (user_id, name, kind) VALUES (?, ?, 'expense')",
        (_uid(), FEE_CATEGORY),
    ).lastrowid


# Transactions

def insert_transaction(data):
    return get_db().execute(
        "INSERT INTO transactions"
        " (user_id, kind, amount, account_id, to_account_id, category_id, note, date)"
        " VALUES (:user_id, :kind, :amount, :account_id, :to_account_id, :category_id, :note, :date)",
        {**data, "user_id": _uid()},
    ).lastrowid


def update_transaction(tx_id, data):
    get_db().execute(
        "UPDATE transactions SET kind = :kind, amount = :amount, account_id = :account_id,"
        " to_account_id = :to_account_id, category_id = :category_id, note = :note, date = :date"
        " WHERE id = :id AND user_id = :user_id",
        {**data, "id": tx_id, "user_id": _uid()},
    )


def get_transaction(tx_id):
    return get_db().execute(TRANSACTION_SQL + " AND t.id = ?", (_uid(), tx_id)).fetchone()


def delete_transaction(tx_id):
    get_db().execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, _uid()))


def list_transactions(month=None, account_id=None, limit=None):
    sql, params = TRANSACTION_SQL, [_uid()]
    if month:
        sql += " AND t.date >= ? AND t.date < ?"
        params += [f"{month}-01", f"{shift_month(month, 1)}-01"]
    if account_id:
        sql += " AND (t.account_id = ? OR t.to_account_id = ?)"
        params += [account_id, account_id]
    sql += " ORDER BY t.date DESC, t.id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return get_db().execute(sql, params).fetchall()


def month_summary(month, account_id=None):
    """Income and expense totals for a month. Transfers and adjustments are excluded."""
    sql = (
        "SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount END), 0) AS income,"
        " COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense"
        " FROM transactions WHERE user_id = ? AND date >= ? AND date < ?"
    )
    params = [_uid(), f"{month}-01", f"{shift_month(month, 1)}-01"]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    return get_db().execute(sql, params).fetchone()


def quick_fills(limit=6):
    """Expenses repeated at least twice in the last 90 days, most frequent first."""
    rows = get_db().execute(
        "SELECT note, amount, account_id, category_id, COUNT(*) AS times"
        " FROM transactions"
        " WHERE user_id = ? AND kind = 'expense' AND note != ''"
        " AND date >= date('now', 'localtime', '-90 days')"
        " GROUP BY lower(note), amount, account_id, category_id"
        " HAVING times >= 2"
        " ORDER BY times DESC, MAX(id) DESC"
        " LIMIT ?",
        (_uid(), limit),
    ).fetchall()
    return [dict(row) for row in rows]


def last_used_expense():
    return get_db().execute(
        "SELECT account_id, category_id FROM transactions WHERE user_id = ? AND kind = 'expense'"
        " ORDER BY id DESC LIMIT 1",
        (_uid(),),
    ).fetchone()
