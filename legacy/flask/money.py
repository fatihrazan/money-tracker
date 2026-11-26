"""Parsing and formatting of rupiah amounts and dates (Indonesian conventions)."""
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

_MULTIPLIERS = {"rb": 1_000, "ribu": 1_000, "k": 1_000, "jt": 1_000_000, "juta": 1_000_000}
_AMOUNT_RE = re.compile(r"(?P<number>\d[\d.,]*)(?P<suffix>rb|ribu|k|jt|juta)?")
_GROUPED_RE = re.compile(r"\d{1,3}(\.\d{3})+|\d{1,3}(,\d{3})+")

DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
          "Agustus", "September", "Oktober", "November", "Desember"]


def parse_amount(text: str) -> int:
    """Parse a rupiah amount the way people type it.

    '25000', '25.000', 'Rp 25.000', '25rb', '25k', '1,5jt', '1.5 juta', '-50rb'.
    Raises ValueError for anything else.
    """
    s = text.strip().lower().replace(" ", "")
    negative = s.startswith("-")
    if negative:
        s = s[1:]
    if s.startswith("rp"):
        s = s[2:]
    m = _AMOUNT_RE.fullmatch(s)
    if not m:
        raise ValueError(f"invalid amount: {text!r}")

    number, suffix = m["number"], m["suffix"]
    if suffix:
        # With a suffix the separator is a decimal point: 1,5jt / 1.5jt
        try:
            value = Decimal(number.replace(",", ".")) * _MULTIPLIERS[suffix]
        except InvalidOperation:
            raise ValueError(f"invalid amount: {text!r}") from None
        if value != value.to_integral_value():
            raise ValueError(f"amount below one rupiah: {text!r}")
        value = int(value)
    elif number.isdigit():
        value = int(number)
    elif _GROUPED_RE.fullmatch(number):
        # Without a suffix separators group thousands: 25.000 / 1.250.000
        value = int(re.sub(r"[.,]", "", number))
    else:
        raise ValueError(f"invalid amount: {text!r}")
    return -value if negative else value


def format_number(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def format_rupiah(n: int) -> str:
    return f"{'-' if n < 0 else ''}Rp{format_number(abs(n))}"


def format_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {MONTHS[d.month - 1][:3]} {d.year}"


def day_header(iso: str, today: date | None = None) -> str:
    d = date.fromisoformat(iso)
    today = today or date.today()
    if d == today:
        return "Hari ini"
    if d == today - timedelta(days=1):
        return "Kemarin"
    return f"{DAYS[d.weekday()]}, {format_date(iso)}"


def month_label(month: str) -> str:
    year, m = month.split("-")
    return f"{MONTHS[int(m) - 1]} {year}"


def shift_month(month: str, delta: int) -> str:
    year, m = map(int, month.split("-"))
    index = year * 12 + (m - 1) + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"
