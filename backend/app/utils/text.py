"""Shared text / value helpers."""
from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Iterable, List, Optional

_WS_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")

NULL_TOKENS = {"", "na", "n/a", "none", "null", "nan", "-", "--", "nil"}


def clean_text(value: Any) -> Optional[str]:
    """Return a trimmed, whitespace-collapsed string or None for blanks."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    text = _WS_RE.sub(" ", str(value).replace("\xa0", " ")).strip()
    return text or None


def normalize_key(value: Any) -> str:
    """Lowercase alnum-only key used for fuzzy header/status matching."""
    text = clean_text(value) or ""
    return _NON_ALNUM_RE.sub(" ", text.lower()).strip()


def compact_key(value: Any) -> str:
    return normalize_key(value).replace(" ", "")


def is_null_token(value: Any) -> bool:
    text = clean_text(value)
    return text is None or text.lower() in NULL_TOKENS


def strip_label(value: Any) -> Optional[str]:
    """Remove a trailing ':' from form labels such as 'Employee Name :'."""
    text = clean_text(value)
    if text is None:
        return None
    return text.rstrip(":").strip() or None


def split_multi(value: Any, seps: Iterable[str] = (",", ";", "/", "\n", "|", "&", " and ")) -> List[str]:
    text = clean_text(value)
    if text is None:
        return []
    pattern = "|".join(re.escape(s) for s in seps)
    return [p.strip() for p in re.split(pattern, text) if p and p.strip()]


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def slugify(value: Any) -> str:
    return _NON_ALNUM_RE.sub("-", (clean_text(value) or "").lower()).strip("-") or "unknown"
