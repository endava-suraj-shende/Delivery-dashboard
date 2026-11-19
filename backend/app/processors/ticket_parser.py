"""Jira ticket ID extraction.

A cell may contain zero, one or many ticket references, optionally embedded in
URLs or free text. Each extracted ID is preserved alongside the original raw text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, List, Optional

from app.utils.text import clean_text, is_null_token

# PROJECT-123 style keys; project keys are 1-10 letters/digits starting with a letter.
_TICKET_RE = re.compile(r"\b([A-Za-z][A-Za-z0-9_]{0,9})\s*-\s*(\d{1,7})\b")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)

NO_TICKET_TOKENS = {"no jira", "nojira", "no ticket", "not created", "na", "n/a", "none", "-", "tbd", "pending"}


@dataclass
class TicketExtraction:
    raw: Optional[str]
    ticket_ids: List[str] = field(default_factory=list)
    has_ticket: bool = False
    note: Optional[str] = None  # e.g. "no jira reference", "project key only"

    @property
    def primary(self) -> Optional[str]:
        return self.ticket_ids[0] if self.ticket_ids else None


def normalize_ticket_id(key: str, number: str) -> str:
    return f"{key.upper()}-{int(number)}"


def extract_ticket_ids(value: Any) -> TicketExtraction:
    raw = clean_text(value)
    if raw is None:
        return TicketExtraction(raw=None, note="blank")
    lowered = raw.lower().strip()
    if lowered in NO_TICKET_TOKENS or is_null_token(raw):
        return TicketExtraction(raw=raw, note="no jira reference")
    ids: List[str] = []
    for m in _TICKET_RE.finditer(raw):
        tid = normalize_ticket_id(m.group(1), m.group(2))
        if tid not in ids:
            ids.append(tid)
    if ids:
        return TicketExtraction(raw=raw, ticket_ids=ids, has_ticket=True)
    if re.fullmatch(r"[A-Za-z]{2,10}", raw):
        return TicketExtraction(raw=raw, note="project key only (no ticket number)")
    if raw.isdigit():
        return TicketExtraction(raw=raw, note="numeric value without project key")
    return TicketExtraction(raw=raw, note="free text without recognisable ticket id")


def ticket_from_url(url: Any) -> Optional[str]:
    text = clean_text(url)
    if not text:
        return None
    m = _TICKET_RE.search(text.rsplit("/", 1)[-1])
    return normalize_ticket_id(m.group(1), m.group(2)) if m else None
