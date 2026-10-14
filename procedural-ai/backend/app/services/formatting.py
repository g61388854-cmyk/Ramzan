from __future__ import annotations

from datetime import date, datetime

MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября",
              "октября", "ноября", "декабря"]


def to_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def fmt_date(value) -> str:
    d = to_date(value)
    return d.strftime("%d.%m.%Y") if d else (str(value) if value else "")


def fmt_date_long(value) -> str:
    d = to_date(value)
    if not d:
        return str(value) if value else ""
    return f"«{d.day:02d}» {MONTHS_GEN[d.month - 1]} {d.year} г."


def fmt_date_text(value) -> str:
    d = to_date(value)
    if not d:
        return str(value) if value else ""
    return f"{d.day} {MONTHS_GEN[d.month - 1]} {d.year} года"


def fmt_time(value) -> str:
    if not value:
        return ""
    s = str(value)[:5]
    try:
        h, m = s.split(":")
        return f"{int(h):02d} ч {int(m):02d} мин"
    except ValueError:
        return s


def short_name(full: str | None) -> str:
    """«Иванов Иван Иванович» → «И.И. Иванов»."""
    if not full:
        return ""
    parts = full.split()
    if len(parts) < 2:
        return full
    initials = "".join(p[0] + "." for p in parts[1:3])
    return f"{initials} {parts[0]}"
