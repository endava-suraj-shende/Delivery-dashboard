"""Parse a single workbook into structured records.

Supports two layouts:

1. **Bi-weekly template** – a form header (Date, Jira Board, Team Lead, Employee,
   Project, Application) followed by a *Work Items & Delivery Tracking* table, an
   optional *Production Deployment Summary* table, optional *Knowledge Transfer
   Tracking* table and free-text *Additional work notes*.
2. **Flat table** – a plain sheet whose first recognisable header row contains a
   ticket-id and status column. Employee / project metadata is then derived from
   the file or folder name.

Nothing is dropped silently: every anomaly is captured as a ``DataIssue``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.processors.column_mapper import (
    KT_FIELDS,
    META_LABELS,
    RELEASE_FIELDS,
    WORK_ITEM_FIELDS,
    ColumnMapping,
    find_header_row,
    map_columns,
    missing_required,
)
from app.processors.excel_reader import SheetData, WorkbookData
from app.processors.ticket_parser import extract_ticket_ids, ticket_from_url
from app.utils.dates import ParsedDate, parse_date_from_filename, parse_date_value, resolve_report_date
from app.utils.text import clean_text, normalize_key, strip_label

SECTION_KEYWORDS = {
    "work": ("work items", "delivery tracking", "work item"),
    "release": ("production deployment summary", "production release summary", "production releases",
                "production deployment"),
    "notes": ("additional work", "additional notes", "other work"),
    "kt": ("knowledge transfer",),
    "employee_info": ("employee information", "employee details"),
    "title": ("bi weekly", "weekly delivery status", "work update"),
}


@dataclass
class DataIssue:
    severity: str  # error | warning | info
    category: str  # missing_employee | missing_date | missing_ticket | unmapped_status | duplicate | ...
    message: str
    file_name: str
    sheet: Optional[str] = None
    row: Optional[int] = None
    field: Optional[str] = None
    value: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class ReportMetadata:
    employee: Optional[str] = None
    employee_source: str = "none"  # cell | filename | folder
    project: Optional[str] = None
    application: Optional[str] = None
    jira_board: Optional[str] = None
    team_lead: Optional[str] = None
    team_members: Optional[str] = None
    report_date: Optional[date] = None
    report_date_raw: Optional[str] = None
    report_date_source: str = "none"
    notes: List[str] = field(default_factory=list)


@dataclass
class ParsedReport:
    file_name: str
    file_path: str
    sheet_name: Optional[str]
    layout: str  # template | flat | unknown
    metadata: ReportMetadata
    work_items: List[Dict[str, Any]] = field(default_factory=list)
    releases: List[Dict[str, Any]] = field(default_factory=list)
    kt_items: List[Dict[str, Any]] = field(default_factory=list)
    issues: List[DataIssue] = field(default_factory=list)
    work_mapping: Optional[ColumnMapping] = None
    release_mapping: Optional[ColumnMapping] = None
    checksum: str = ""
    size_bytes: int = 0
    modified_at: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.layout != "unknown"


# --------------------------------------------------------------------------- helpers
def _row_cells(row: Sequence[Any]) -> List[Any]:
    return [c for c in row if clean_text(c) is not None]


def _section_of(row: Sequence[Any]) -> Optional[str]:
    cells = _row_cells(row)
    if len(cells) != 1 or not isinstance(cells[0], str):
        return None
    key = normalize_key(cells[0])
    if len(key) > 60:
        return None
    for section, keywords in SECTION_KEYWORDS.items():
        if any(k in key for k in keywords):
            return section
    return None


def _label_of(cell: Any) -> Optional[str]:
    text = strip_label(cell)
    if text is None or not isinstance(cell, str) or len(text) > 40:
        return None
    key = normalize_key(text)
    for fld, syns in META_LABELS.items():
        if key in syns:
            return fld
    return None


def _value_right_of(row: Sequence[Any], idx: int, max_span: int = 3) -> Any:
    for j in range(idx + 1, min(idx + 1 + max_span, len(row))):
        if clean_text(row[j]) is not None:
            return row[j]
    return None


def employee_from_path(path: Path) -> Tuple[Optional[str], str]:
    """Derive an employee name from folder (preferred) or file name."""
    folder = path.parent.name
    if folder and folder.lower() not in ("data", "uploads", "sample", "samples"):
        return _humanize(folder), "folder"
    stem = path.stem
    stem = re.split(r"[-_ ]\s*\d", stem, maxsplit=1)[0]  # cut at first digit group
    stem = re.sub(r"(?i)\b(work\s*update|status|weekly|bi\s*weekly|report)\b", " ", stem)
    name = _humanize(stem)
    return (name or None), "filename"


def _humanize(text: str) -> str:
    text = re.sub(r"[_\-]+", " ", text)
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)  # split camel-case
    text = re.sub(r"\s+", " ", text).strip()
    return " ".join(w if w.isupper() else w.capitalize() for w in text.split(" "))


def _record_from_row(row: Sequence[Any], mapping: ColumnMapping) -> Dict[str, Any]:
    rec: Dict[str, Any] = {}
    for fld, idx in mapping.fields.items():
        rec[fld] = row[idx] if idx < len(row) else None
    return rec


def _is_meaningful(rec: Dict[str, Any], ignore: Sequence[str] = ("application",)) -> bool:
    return any(clean_text(v) is not None for k, v in rec.items() if k not in ignore)


# --------------------------------------------------------------------------- parser
class TemplateParser:
    def __init__(self, column_overrides: Optional[Dict[str, Dict[str, str]]] = None) -> None:
        self.overrides = column_overrides or {}

    # ---- public ---------------------------------------------------------
    def parse(self, wb: WorkbookData, sheet_name: Optional[str] = None) -> ParsedReport:
        sheet = self._select_sheet(wb, sheet_name)
        meta = ReportMetadata()
        report = ParsedReport(
            file_name=wb.file_name, file_path=str(wb.path), sheet_name=sheet.name if sheet else None,
            layout="unknown", metadata=meta, checksum=wb.checksum, size_bytes=wb.size_bytes,
            modified_at=wb.modified_at.isoformat(),
        )
        if sheet is None or sheet.is_empty:
            report.issues.append(DataIssue("error", "empty_workbook", "Workbook has no readable data", wb.file_name))
            self._finalize_metadata(report, wb.path, raw_date=None)
            return report

        grid = sheet.grid
        work_hdr = find_header_row(grid, WORK_ITEM_FIELDS, required=["ticket_id", "work_status"], min_fields=3)
        if work_hdr is None:
            # Very loose fallback: ticket id + anything
            work_hdr = find_header_row(grid, WORK_ITEM_FIELDS, required=["ticket_id"], min_fields=3)

        raw_date = self._parse_metadata(grid, meta, limit=work_hdr if work_hdr is not None else len(grid))
        has_form = any([meta.employee, meta.project, meta.jira_board, raw_date is not None])
        report.layout = "template" if has_form else ("flat" if work_hdr is not None else "unknown")

        if work_hdr is None:
            kt_present = find_header_row(grid, KT_FIELDS, required=["topic"], min_fields=3) is not None
            report.issues.append(DataIssue(
                "warning" if (report.layout == "template" or kt_present) else "error", "missing_columns",
                "No work-items table found (need a Jira Ticket ID and Work Status column)"
                + ("; report contains only Knowledge Transfer / notes" if kt_present else ""),
                wb.file_name, sheet.name))
        else:
            self._parse_work_table(grid, work_hdr, report, sheet.name)

        rel_hdr = self._find_release_header(grid, work_hdr)
        if rel_hdr is not None:
            self._parse_release_table(grid, rel_hdr, report, sheet.name)

        kt_hdr = find_header_row(grid, KT_FIELDS, required=["topic"], min_fields=3)
        if kt_hdr is not None:
            self._parse_kt_table(grid, kt_hdr, report, sheet.name)

        self._parse_notes(grid, meta, exclude_rows=self._table_rows(report))
        self._finalize_metadata(report, wb.path, raw_date)
        return report

    # ---- sheet selection -------------------------------------------------
    @staticmethod
    def _select_sheet(wb: WorkbookData, preferred: Optional[str]) -> Optional[SheetData]:
        if preferred:
            s = wb.sheet(preferred)
            if s is not None:
                return s
        candidates = [s for s in wb.sheets if not s.is_empty]
        if not candidates:
            return None
        # Prefer a sheet that has a work-items header, then the largest sheet.
        def score(s: SheetData) -> Tuple[int, int]:
            hdr = find_header_row(s.grid, WORK_ITEM_FIELDS, required=["ticket_id"], min_fields=3)
            return (1 if hdr is not None else 0, s.max_row)
        return max(candidates, key=score)

    # ---- metadata --------------------------------------------------------
    def _parse_metadata(self, grid: Sequence[Sequence[Any]], meta: ReportMetadata, limit: int) -> Any:
        raw_date: Any = None
        for row in grid[:limit]:
            for idx, cell in enumerate(row):
                label = _label_of(cell)
                if label is None:
                    continue
                value = _value_right_of(row, idx)
                if value is None:
                    continue
                if label == "report_date" and raw_date is None:
                    raw_date = value
                elif label == "employee" and meta.employee is None:
                    meta.employee, meta.employee_source = clean_text(value), "cell"
                elif label == "project" and meta.project is None:
                    meta.project = clean_text(value)
                elif label == "application" and meta.application is None:
                    meta.application = clean_text(value)
                elif label == "jira_board" and meta.jira_board is None:
                    meta.jira_board = clean_text(value)
                elif label == "team_lead" and meta.team_lead is None:
                    meta.team_lead = clean_text(value)
                elif label == "team_members" and meta.team_members is None:
                    meta.team_members = clean_text(value)
        return raw_date

    def _finalize_metadata(self, report: ParsedReport, path: Path, raw_date: Any) -> None:
        meta = report.metadata
        parsed: ParsedDate = resolve_report_date(raw_date, path.name)
        meta.report_date, meta.report_date_raw, meta.report_date_source = parsed.value, parsed.raw, parsed.source
        if parsed.note:
            report.issues.append(DataIssue("warning" if parsed.valid else "error", "report_date", parsed.note,
                                           report.file_name, report.sheet_name, field="report_date", value=parsed.raw))
        if not meta.employee:
            name, source = employee_from_path(path)
            meta.employee, meta.employee_source = name, source
            report.issues.append(DataIssue(
                "warning", "missing_employee",
                f"Employee name not found in workbook; derived '{name}' from {source}",
                report.file_name, report.sheet_name, field="employee", value=name))
        if not meta.project:
            report.issues.append(DataIssue("warning", "missing_project", "Project / Team name missing in workbook",
                                           report.file_name, report.sheet_name, field="project"))
        if not meta.jira_board:
            report.issues.append(DataIssue("info", "missing_board", "Jira Board name missing in workbook",
                                           report.file_name, report.sheet_name, field="jira_board"))

    # ---- work items ------------------------------------------------------
    def _parse_work_table(self, grid: Sequence[Sequence[Any]], hdr: int, report: ParsedReport, sheet: str) -> None:
        mapping = map_columns(grid[hdr], WORK_ITEM_FIELDS, self.overrides.get("work_items"), header_row=hdr + 1)
        report.work_mapping = mapping
        for fld in missing_required(mapping):
            report.issues.append(DataIssue("error", "missing_columns", f"Required column '{fld}' not found",
                                           report.file_name, sheet, row=hdr + 1, field=fld))
        for i in range(hdr + 1, len(grid)):
            row = grid[i]
            section = _section_of(row)
            if section in ("release", "notes", "kt", "employee_info"):
                break
            if self._looks_like_other_header(row):
                break
            rec = _record_from_row(row, mapping)
            if not _is_meaningful(rec):
                continue
            rec["source_row"] = i + 1
            rec["source_sheet"] = sheet
            extraction = extract_ticket_ids(rec.get("ticket_id"))
            if not extraction.has_ticket and rec.get("ticket_link"):
                from_url = ticket_from_url(rec.get("ticket_link"))
                if from_url:
                    extraction.ticket_ids = [from_url]
                    extraction.has_ticket = True
                    extraction.note = "ticket id taken from link"
            rec["ticket_ids"] = extraction.ticket_ids
            rec["ticket_note"] = extraction.note
            if not extraction.has_ticket:
                report.issues.append(DataIssue(
                    "warning", "missing_ticket",
                    f"No Jira ticket id ({extraction.note or 'blank'})", report.file_name, sheet, i + 1,
                    "ticket_id", extraction.raw))
            if clean_text(rec.get("work_status")) is None:
                report.issues.append(DataIssue("warning", "missing_status", "Work Status is blank",
                                               report.file_name, sheet, i + 1, "work_status"))
            if "date" in rec and rec.get("date") is not None and parse_date_value(rec.get("date")) is None:
                report.issues.append(DataIssue("warning", "invalid_date", f"Invalid activity date '{rec.get('date')}'",
                                               report.file_name, sheet, i + 1, "date", clean_text(rec.get("date"))))
            report.work_items.append(rec)

    @staticmethod
    def _looks_like_other_header(row: Sequence[Any]) -> bool:
        cells = _row_cells(row)
        if len(cells) < 3 or not all(isinstance(c, str) for c in cells):
            return False
        rel = map_columns(row, RELEASE_FIELDS)
        if rel.has("release_tickets", "prod_deployment") and "release_date" in rel.fields:
            return True
        kt = map_columns(row, KT_FIELDS)
        return kt.has("topic", "status")

    # ---- production releases --------------------------------------------
    def _find_release_header(self, grid: Sequence[Sequence[Any]], work_hdr: Optional[int]) -> Optional[int]:
        start = (work_hdr + 1) if work_hdr is not None else 0
        for i in range(start, len(grid)):
            row = grid[i]
            cells = _row_cells(row)
            if len(cells) < 3 or not all(isinstance(c, str) for c in cells):
                continue
            m = map_columns(row, RELEASE_FIELDS)
            if m.has("release_tickets", "prod_deployment") and ("release_date" in m.fields or "release_details" in m.fields):
                return i
        return None

    def _parse_release_table(self, grid: Sequence[Sequence[Any]], hdr: int, report: ParsedReport, sheet: str) -> None:
        mapping = map_columns(grid[hdr], RELEASE_FIELDS, self.overrides.get("releases"), header_row=hdr + 1)
        report.release_mapping = mapping
        for i in range(hdr + 1, len(grid)):
            row = grid[i]
            section = _section_of(row)
            if section in ("notes", "kt", "work", "employee_info"):
                break
            if self._looks_like_other_header(row) and i != hdr:
                kt = map_columns(row, KT_FIELDS)
                if kt.has("topic", "status"):
                    break
            rec = _record_from_row(row, mapping)
            if not _is_meaningful(rec):
                continue
            rec["source_row"] = i + 1
            rec["source_sheet"] = sheet
            extraction = extract_ticket_ids(rec.get("release_tickets"))
            rec["ticket_ids"] = extraction.ticket_ids
            rec["ticket_note"] = extraction.note
            raw_rd = rec.get("release_date")
            rec["release_date_parsed"] = parse_date_value(raw_rd)
            if raw_rd is not None and rec["release_date_parsed"] is None:
                report.issues.append(DataIssue("warning", "invalid_date", f"Invalid release date '{clean_text(raw_rd)}'",
                                               report.file_name, sheet, i + 1, "release_date", clean_text(raw_rd)))
            if clean_text(rec.get("prod_deployment")) is None:
                report.issues.append(DataIssue("warning", "incomplete_deployment",
                                               "Production Deployment Status is blank", report.file_name, sheet, i + 1,
                                               "prod_deployment"))
            if not extraction.has_ticket:
                report.issues.append(DataIssue("info", "missing_ticket",
                                               f"Production release without Jira id ({extraction.note or 'blank'})",
                                               report.file_name, sheet, i + 1, "release_tickets", extraction.raw))
            report.releases.append(rec)

    # ---- knowledge transfer ---------------------------------------------
    def _parse_kt_table(self, grid: Sequence[Sequence[Any]], hdr: int, report: ParsedReport, sheet: str) -> None:
        mapping = map_columns(grid[hdr], KT_FIELDS, header_row=hdr + 1)
        for i in range(hdr + 1, len(grid)):
            row = grid[i]
            if _section_of(row) is not None:
                break
            rec = _record_from_row(row, mapping)
            if not _is_meaningful(rec, ignore=("serial",)):
                continue
            rec["source_row"] = i + 1
            rec["start_date_parsed"] = parse_date_value(rec.get("start_date"))
            rec["end_date_parsed"] = parse_date_value(rec.get("end_date"))
            report.kt_items.append(rec)

    # ---- notes -----------------------------------------------------------
    def _table_rows(self, report: ParsedReport) -> set:
        rows: set = set()
        for coll in (report.work_items, report.releases, report.kt_items):
            rows.update(r.get("source_row") for r in coll)
        for m in (report.work_mapping, report.release_mapping):
            if m:
                rows.add(m.header_row)
        return rows

    def _parse_notes(self, grid: Sequence[Sequence[Any]], meta: ReportMetadata, exclude_rows: set) -> None:
        in_notes = False
        for i, row in enumerate(grid):
            rowno = i + 1
            section = _section_of(row)
            if section == "notes":
                in_notes = True
                continue
            if section in ("work", "release", "kt", "employee_info", "title"):
                in_notes = False
                continue
            if rowno in exclude_rows:
                continue
            for idx, cell in enumerate(row):
                if _label_of(cell) == "notes":
                    value = _value_right_of(row, idx, max_span=6)
                    text = clean_text(value)
                    if text and text not in meta.notes:
                        meta.notes.append(text)
                    in_notes = True
                    break
            else:
                if in_notes:
                    cells = [clean_text(c) for c in row if clean_text(c) is not None]
                    if len(cells) == 1 and len(cells[0]) > 25 and cells[0] not in meta.notes:
                        meta.notes.append(cells[0])
