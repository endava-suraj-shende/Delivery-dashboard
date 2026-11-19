"""Dynamic column detection and mapping.

Headers in the workbooks vary ("Jira Ticket ID", "Jira/OS Ticket ID", "Jira TicketID",
"Status", ...). Every header is normalized and matched against canonical field
synonyms. Users can supply explicit overrides which always win.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from app.utils.text import clean_text, compact_key, normalize_key

# canonical field -> synonyms (normalized form). Order matters: more specific first.
WORK_ITEM_FIELDS: Dict[str, List[str]] = {
    "ticket_id": ["jira ticket id", "jira os ticket id", "jira ticketid", "jira tickets id", "jira id", "ticket id",
                  "ticketid", "jira", "jira ticket", "ticket", "story id", "issue key", "key"],
    "ticket_link": ["jira ticket link", "ticket link", "jira link", "link", "url"],
    "work_details": ["work details", "description", "work description", "task", "summary", "title", "work item",
                     "details"],
    "work_type": ["work type", "activity type", "type", "category", "activity"],
    "work_status": ["work status", "jira status", "status", "ticket status", "current status", "state"],
    "prod_required": ["production deployment required", "prod deployment required", "production required",
                      "in production", "prod required", "production"],
    "dev_deployment": ["dev deployment status", "dev deployment", "development deployment status",
                       "development deployment", "deployment status", "deployment", "dev deploy"],
    "prod_deployment": ["production deployment status", "prod deployment status", "production status",
                        "release status"],
    "prod_release_tickets": ["production release tickets", "release tickets", "prod release tickets"],
    "comments": ["additional comments", "additional work notes", "comments", "notes", "remarks", "closing comments",
                 "closing comment", "comment"],
    "environment": ["environment", "env", "environments"],
    "date": ["date", "activity date", "work date", "reported date", "report date"],
    "employee": ["employee name", "employee", "name", "resource", "team member", "developer", "assignee"],
    "project": ["project team name", "project team", "project", "team name", "team"],
    "application": ["application name", "application", "app name", "app", "module"],
    "jira_board": ["jira board name", "jira board", "board name", "board"],
}

RELEASE_FIELDS: Dict[str, List[str]] = {
    "application": ["application name", "application", "app"],
    "release_tickets": ["production release tickets", "release tickets", "jira ticket id", "ticket id", "tickets",
                        "jira"],
    "release_details": ["production release details", "release details", "details", "description", "work details"],
    "release_date": ["production release date", "release date", "deployment date", "date"],
    "prod_deployment": ["production deployment status", "deployment status", "status", "release status"],
    "comments": ["comments", "additional comments", "notes", "remarks"],
}

KT_FIELDS: Dict[str, List[str]] = {
    "serial": ["s no", "sno", "sr no", "sl no", "no"],
    "topic": ["knowledge transfer topic", "topic", "kt topic", "subject"],
    "start_date": ["start date", "started", "from"],
    "end_date": ["end date", "completed", "to"],
    "status": ["status", "kt status"],
    "notes": ["notes", "comments", "remarks"],
}

# Metadata labels found in the template's form section.
META_LABELS: Dict[str, List[str]] = {
    "report_date": ["date", "report date", "reporting date", "week ending", "as of"],
    "jira_board": ["jira board", "jira board name", "board"],
    "team_lead": ["team lead", "lead", "manager", "reporting manager"],
    "team_members": ["team member s", "team members", "team member", "members"],
    "employee": ["employee name", "employee", "name", "resource name"],
    "project": ["project team name", "project team", "project", "team"],
    "application": ["application name", "application", "applications"],
    "notes": ["additional work notes", "additional work", "additional notes", "notes", "other work"],
}

REQUIRED_WORK_FIELDS = ["ticket_id", "work_status"]
RECOMMENDED_WORK_FIELDS = ["application", "work_type", "dev_deployment", "prod_required", "comments"]


@dataclass
class ColumnMapping:
    """Mapping of canonical field -> zero-based column index."""

    fields: Dict[str, int] = field(default_factory=dict)
    headers: List[Optional[str]] = field(default_factory=list)
    unmapped_headers: List[str] = field(default_factory=list)
    header_row: int = 0  # 1-based row number in sheet

    def index(self, name: str) -> Optional[int]:
        return self.fields.get(name)

    def has(self, *names: str) -> bool:
        return all(n in self.fields for n in names)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "header_row": self.header_row,
            "headers": self.headers,
            "fields": {k: {"column_index": v, "header": self.headers[v] if v < len(self.headers) else None}
                       for k, v in self.fields.items()},
            "unmapped_headers": self.unmapped_headers,
        }


def _match_header(header: Any, synonyms: Dict[str, List[str]], used: Iterable[str]) -> Optional[str]:
    key = normalize_key(header)
    if not key:
        return None
    ckey = key.replace(" ", "")
    # exact
    for fld, syns in synonyms.items():
        if fld in used:
            continue
        for s in syns:
            if key == s or ckey == s.replace(" ", ""):
                return fld
    # containment (longest synonym first to avoid "status" stealing "dev deployment status")
    candidates: List[Tuple[int, str]] = []
    for fld, syns in synonyms.items():
        if fld in used:
            continue
        for s in syns:
            s_c = s.replace(" ", "")
            if len(s_c) >= 4 and (s_c in ckey or ckey in s_c and len(ckey) >= 4):
                candidates.append((len(s_c), fld))
    if candidates:
        candidates.sort(reverse=True)
        return candidates[0][1]
    return None


def map_columns(
    headers: Sequence[Any],
    synonyms: Dict[str, List[str]],
    overrides: Optional[Dict[str, str]] = None,
    header_row: int = 0,
) -> ColumnMapping:
    """Map a header row to canonical fields.

    ``overrides`` maps canonical field -> exact header text (as shown in Excel).
    """
    clean_headers = [clean_text(h) for h in headers]
    mapping = ColumnMapping(headers=clean_headers, header_row=header_row)
    used: set = set()
    taken_cols: set = set()

    if overrides:
        for fld, header_text in overrides.items():
            if fld not in synonyms or not header_text:
                continue
            target = compact_key(header_text)
            for idx, h in enumerate(clean_headers):
                if h is not None and compact_key(h) == target:
                    mapping.fields[fld] = idx
                    used.add(fld)
                    taken_cols.add(idx)
                    break

    for idx, h in enumerate(clean_headers):
        if idx in taken_cols or h is None:
            continue
        fld = _match_header(h, synonyms, used)
        if fld:
            mapping.fields[fld] = idx
            used.add(fld)
            taken_cols.add(idx)
        else:
            mapping.unmapped_headers.append(h)
    return mapping


def score_header_row(row: Sequence[Any], synonyms: Dict[str, List[str]]) -> int:
    """Number of distinct canonical fields recognised in a candidate header row."""
    cells = [c for c in row if clean_text(c) is not None]
    if len(cells) < 3:
        return 0
    mapping = map_columns(row, synonyms)
    return len(mapping.fields)


def find_header_row(
    grid: Sequence[Sequence[Any]],
    synonyms: Dict[str, List[str]],
    required: Sequence[str],
    start: int = 0,
    end: Optional[int] = None,
    min_fields: int = 3,
) -> Optional[int]:
    """Return the zero-based index of the most plausible header row in ``grid``."""
    end = len(grid) if end is None else min(end, len(grid))
    best: Tuple[int, Optional[int]] = (0, None)
    for i in range(start, end):
        row = grid[i]
        mapping = map_columns(row, synonyms)
        if not all(r in mapping.fields for r in required):
            continue
        score = len(mapping.fields)
        if score >= min_fields and score > best[0]:
            best = (score, i)
    return best[1]


def missing_required(mapping: ColumnMapping, required: Sequence[str] = REQUIRED_WORK_FIELDS) -> List[str]:
    return [f for f in required if f not in mapping.fields]
