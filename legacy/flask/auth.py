"""Sign up, log in and log out. Every other page requires a logged-in user (load_user)."""
import re
import sqlite3

from flask import Blueprint, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

import db

bp = Blueprint("auth", __name__)

USERNAME_RE = re.compile(r"[a-z0-9_.]{3,30}")
MIN_PASSWORD = 8
PUBLIC_ENDPOINTS = {"auth.login", "auth.signup", "static"}


def load_user():
    """Before each request: set g.user from the session, and send guests to the login page."""
    user_id = session.get("user_id")
    g.user = db.get_user(user_id) if user_id else None
    if g.user is None and request.endpoint not in PUBLIC_ENDPOINTS:
        session.clear()
        target = None
        if request.method == "GET":
            target = request.full_path if request.query_string else request.path
        return redirect(url_for("auth.login", next=target))
    return None


def _safe_next(target):
    """Only follow ?next= to a path on this site (no //evil.example or full URLs)."""
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return url_for("main.dashboard")


def _log_in(user_id):
    session.clear()
    session["user_id"] = user_id
    session.permanent = True


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("main.dashboard"))
    errors = []
    username = request.form.get("username", "").strip().lower()
    if request.method == "POST":
        user = db.get_user_by_username(username)
        # Same message either way, so the form doesn't reveal which usernames exist.
        if user is None or not check_password_hash(user["password_hash"], request.form.get("password", "")):
            errors.append("Nama pengguna atau kata sandi salah.")
        else:
            _log_in(user["id"])
            return redirect(_safe_next(request.args.get("next")))
    return render_template("login.html", username=username, errors=errors), 401 if errors else 200


@bp.route("/signup", methods=["GET", "POST"])
def signup():
    if g.user:
        return redirect(url_for("main.dashboard"))
    errors = []
    username = request.form.get("username", "").strip().lower()
    if request.method == "POST":
        password = request.form.get("password", "")
        if not USERNAME_RE.fullmatch(username):
            errors.append("Nama pengguna 3–30 karakter: huruf kecil, angka, titik, atau garis bawah.")
        if len(password) < MIN_PASSWORD:
            errors.append(f"Kata sandi minimal {MIN_PASSWORD} karakter.")
        elif password != request.form.get("confirm", ""):
            errors.append("Konfirmasi kata sandi tidak sama.")
        if not errors:
            try:
                user_id = db.create_user(username, generate_password_hash(password))
            except sqlite3.IntegrityError:
                errors.append(f"Nama pengguna \"{username}\" sudah dipakai.")
            else:
                _log_in(user_id)
                flash(f"Akun {username} dibuat. Masuk dengan akun ini di perangkat lain "
                      "untuk melihat data yang sama.", "success")
                return redirect(url_for("main.dashboard"))
    return render_template(
        "signup.html", username=username, errors=errors, first_user=db.user_count() == 0
    ), 400 if errors else 200


@bp.post("/logout")
def logout():
    session.clear()
    flash("Kamu sudah keluar.", "success")
    return redirect(url_for("auth.login"))
