"""Robust date parsing for Excel cells and file names."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Optional

import pandas as pd

from app.utils.text import clean_text

_EXCEL_EPOCH = datetime(1899, 12, 30)

# Explicit formats tried before the generic parser (day-first wins for ambiguity).
_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%d.%m.%Y",
    "%d-%b-%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%y",
    "%d %b %y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%m/%d/%Y",
    "%Y/%m/%d",
    "%Y%m%d",
)

_FILENAME_PATTERNS = (
    # 30-10-2026, 30_10_2026, 30.10.2026, 2-11-2026
    (re.compile(r"(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})(?!\d)"), "dmy"),
    # 20261023
    (re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)"), "ymd"),
    # 10162026 (mmddyyyy)
    (re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)"), "mdy"),
    # 16 Oct 26 / 16 Oct 2026 / 19_oct_2026
    (re.compile(r"(?<!\d)(\d{1,2})[ _-]?([A-Za-z]{3,9})[ _-]?(\d{2,4})(?!\d)"), "dMy"),
)


@dataclass
class ParsedDate:
    value: Optional[date]
    raw: Optional[str]
    source: str  # cell | filename | none
    valid: bool
    note: Optional[str] = None


def _from_components(day: int, month: int, year: int) -> Optional[date]:
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date_value(value: Any) -> Optional[date]:
    """Parse a single cell into a date. Returns None when not interpretable."""
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value != value:  # NaN
            return None
        if 20000 < float(value) < 80000:  # Excel serial range ~1954..2119
            return (_EXCEL_EPOCH + timedelta(days=float(value))).date()
        return None
    text = clean_text(value)
    if not text:
        return None
    for fmt in _FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    # Attempt to repair swapped day/month such as '19/15/2026'
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", text)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        for d, mo in ((a, b), (b, a)):
            parsed = _from_components(d, mo, y)
            if parsed:
                return parsed
        return None
    try:
        parsed = pd.to_datetime(text, dayfirst=True, errors="coerce")
        return None if pd.isna(parsed) else parsed.date()
    except Exception:
        return None


def parse_date_from_filename(name: str) -> Optional[date]:
    for pattern, kind in _FILENAME_PATTERNS:
        for m in pattern.finditer(name):
            g = m.groups()
            try:
                if kind == "dmy":
                    parsed = _from_components(int(g[0]), int(g[1]), int(g[2]))
                    if parsed is None:  # maybe m-d-y
                        parsed = _from_components(int(g[1]), int(g[0]), int(g[2]))
                elif kind == "ymd":
                    parsed = _from_components(int(g[2]), int(g[1]), int(g[0]))
                elif kind == "mdy":
                    parsed = _from_components(int(g[1]), int(g[0]), int(g[2]))
                else:
                    month = datetime.strptime(g[1][:3].title(), "%b").month
                    parsed = _from_components(int(g[0]), month, int(g[2]))
            except ValueError:
                parsed = None
            if parsed and 2000 <= parsed.year <= 2100:
                return parsed
    return None


def resolve_report_date(cell_value: Any, filename: str) -> ParsedDate:
    """Prefer the workbook's Date cell, fall back to the file name."""
    raw = clean_text(cell_value)
    cell_date = parse_date_value(cell_value)
    file_date = parse_date_from_filename(filename)
    if cell_date is not None:
        note = None
        # Flag suspicious day/month swaps when the filename disagrees strongly.
        if file_date and abs((cell_date - file_date).days) > 45:
            swapped = _from_components(cell_date.month, cell_date.day, cell_date.year)
            if swapped and abs((swapped - file_date).days) <= 7:
                return ParsedDate(swapped, raw, "cell (day/month corrected)", True,
                                  f"Date cell '{raw}' looked day/month swapped; corrected using file name")
            note = f"Date cell '{raw}' differs from file-name date {file_date.isoformat()}"
        return ParsedDate(cell_date, raw, "cell", True, note)
    if file_date is not None:
        note = f"Invalid or missing Date cell '{raw}'; used file-name date" if raw else "Missing Date cell; used file-name date"
        return ParsedDate(file_date, raw, "filename", True, note)
    return ParsedDate(None, raw, "none", False, f"Could not determine report date (cell='{raw}')")


def to_iso(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None
