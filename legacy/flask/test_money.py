import pytest

from money import day_header, format_rupiah, month_label, parse_amount, shift_month


@pytest.mark.parametrize("text, expected", [
    ("25000", 25_000),
    ("25.000", 25_000),
    ("25,000", 25_000),
    ("1.250.000", 1_250_000),
    ("Rp 18.500", 18_500),
    ("rp18500", 18_500),
    ("25rb", 25_000),
    ("25 ribu", 25_000),
    ("25k", 25_000),
    ("1,5jt", 1_500_000),
    ("1.5 juta", 1_500_000),
    ("1,25rb", 1_250),
    ("-50rb", -50_000),
    ("0", 0),
])
def test_parse_amount(text, expected):
    assert parse_amount(text) == expected


@pytest.mark.parametrize("text", ["", "abc", "1.5", "25.00", "1.2.3rb", "1,2345rb", "25rbu", "1.000,000"])
def test_parse_amount_rejects(text):
    with pytest.raises(ValueError):
        parse_amount(text)


def test_format_rupiah():
    assert format_rupiah(1_250_000) == "Rp1.250.000"
    assert format_rupiah(-25_000) == "-Rp25.000"
    assert format_rupiah(0) == "Rp0"


def test_dates():
    from datetime import date
    today = date(2026, 10, 17)
    assert day_header("2026-10-17", today) == "Hari ini"
    assert day_header("2026-10-16", today) == "Kemarin"
    assert day_header("2026-10-15", today) == "Kamis, 15 Okt 2026"
    assert month_label("2026-10") == "Oktober 2026"
    assert shift_month("2026-12", 1) == "2027-01"
    assert shift_month("2026-01", -1) == "2025-12"
