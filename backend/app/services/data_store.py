"""In-memory data store built from parsed workbooks.

The store is the single source of truth consumed by the analytics engine. It is
deliberately shaped like a repository so a database-backed implementation can be
swapped in later (see ``DataRepository``).
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Protocol

import pandas as pd

from app.processors.status_normalizer import StatusNormalizer
from app.processors.template_parser import ParsedReport
from app.utils.dates import parse_date_value
from app.utils.text import clean_text

ACTIVITY_COLUMNS = [
    "activity_id", "file_id", "file_name", "source_sheet", "source_row", "report_date", "activity_date",
    "employee", "project", "jira_board", "team_lead", "application", "application_source",
    "ticket_id", "ticket_ids", "ticket_raw", "ticket_link", "has_ticket", "ticket_note", "work_details",
    "work_type_raw", "work_type", "work_status_raw", "work_status", "prod_required_raw", "prod_required",
    "dev_deployment_raw", "dev_deployment", "prod_deployment_raw", "prod_deployment", "environment", "comments",
    "sprint", "story_points", "due_date", "due_source", "resolved_date", "is_duplicate",
]
RELEASE_COLUMNS = [
    "release_id", "file_id", "file_name", "source_sheet", "source_row", "report_date", "employee", "project",
    "jira_board", "application", "ticket_id", "ticket_ids", "ticket_raw", "has_ticket", "release_details",
    "release_date", "release_date_source", "prod_deployment_raw", "prod_deployment", "comments", "sprint", "is_duplicate",
]
REPORT_COLUMNS = [
    "file_id", "file_name", "folder", "origin", "file_path", "sheet_name", "layout", "employee", "employee_source",
    "project", "application", "jira_board", "team_lead", "team_members", "report_date", "report_date_raw",
    "report_date_source", "work_items", "releases", "kt_items", "issues", "notes", "checksum", "size_bytes",
    "modified_at", "ok",
]
ISSUE_COLUMNS = ["issue_id", "file_id", "file_name", "employee", "severity", "category", "message", "sheet", "row",
                 "field", "value"]
KT_COLUMNS = ["kt_id", "file_id", "employee", "project", "report_date", "topic", "start_date", "end_date", "status",
              "notes", "source_row"]


class DataRepository(Protocol):
    def activities(self) -> pd.DataFrame: ...
    def releases(self) -> pd.DataFrame: ...
    def reports(self) -> pd.DataFrame: ...
    def issues(self) -> pd.DataFrame: ...
    def kt(self) -> pd.DataFrame: ...


@dataclass
class LoadInfo:
    loaded_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    signature: Optional[str] = None
    file_count: int = 0
    source_dir: str = ""
    history: List[Dict[str, Any]] = field(default_factory=list)
    source: str = "excel"            # excel | jira | both
    details: Dict[str, Any] = field(default_factory=dict)


class InMemoryDataStore:
    def __init__(self, normalizer: StatusNormalizer) -> None:
        self._lock = threading.RLock()
        self.normalizer = normalizer
        self._activities = pd.DataFrame(columns=ACTIVITY_COLUMNS)
        self._releases = pd.DataFrame(columns=RELEASE_COLUMNS)
        self._reports = pd.DataFrame(columns=REPORT_COLUMNS)
        self._issues = pd.DataFrame(columns=ISSUE_COLUMNS)
        self._kt = pd.DataFrame(columns=KT_COLUMNS)
        self._parsed: Dict[str, ParsedReport] = {}
        self.load_info = LoadInfo()
        self.version = 0

    # ---- repository API --------------------------------------------------
    def activities(self) -> pd.DataFrame:
        return self._activities

    def releases(self) -> pd.DataFrame:
        return self._releases

    def reports(self) -> pd.DataFrame:
        return self._reports

    def issues(self) -> pd.DataFrame:
        return self._issues

    def kt(self) -> pd.DataFrame:
        return self._kt

    def parsed(self, file_id: str) -> Optional[ParsedReport]:
        return self._parsed.get(file_id)

    @property
    def is_loaded(self) -> bool:
        return len(self._reports) > 0

    # ---- building --------------------------------------------------------
    def replace(self, reports: List[ParsedReport], origins: Dict[str, str], info: LoadInfo) -> None:
        with self._lock:
            self.normalizer.reset_unmapped()
            rep_rows: List[Dict[str, Any]] = []
            act_rows: List[Dict[str, Any]] = []
            rel_rows: List[Dict[str, Any]] = []
            iss_rows: List[Dict[str, Any]] = []
            kt_rows: List[Dict[str, Any]] = []
            parsed: Dict[str, ParsedReport] = {}
            for rep in reports:
                file_id = _file_id(rep)
                parsed[file_id] = rep
                meta = rep.metadata
                folder = _folder_of(rep)
                rep_rows.append({
                    "file_id": file_id, "file_name": rep.file_name, "folder": folder,
                    "origin": origins.get(rep.file_path, "folder"), "file_path": rep.file_path,
                    "sheet_name": rep.sheet_name, "layout": rep.layout, "employee": meta.employee,
                    "employee_source": meta.employee_source, "project": meta.project or None,
                    "application": meta.application, "jira_board": meta.jira_board, "team_lead": meta.team_lead,
                    "team_members": meta.team_members, "report_date": meta.report_date,
                    "report_date_raw": meta.report_date_raw, "report_date_source": meta.report_date_source,
                    "work_items": len(rep.work_items), "releases": len(rep.releases), "kt_items": len(rep.kt_items),
                    "issues": len(rep.issues), "notes": list(meta.notes), "checksum": rep.checksum,
                    "size_bytes": rep.size_bytes, "modified_at": rep.modified_at, "ok": rep.ok,
                })
                for w in rep.work_items:
                    act_rows.append(self._activity_row(rep, file_id, w))
                for r in rep.releases:
                    rel_rows.append(self._release_row(rep, file_id, r))
                for k in rep.kt_items:
                    kt_rows.append({
                        "kt_id": f"{file_id}:kt:{k.get('source_row')}", "file_id": file_id, "employee": meta.employee,
                        "project": meta.project, "report_date": meta.report_date, "topic": clean_text(k.get("topic")),
                        "start_date": k.get("start_date_parsed"), "end_date": k.get("end_date_parsed"),
                        "status": clean_text(k.get("status")), "notes": clean_text(k.get("notes")),
                        "source_row": k.get("source_row"),
                    })
                for issue in rep.issues:
                    iss_rows.append({"issue_id": str(uuid.uuid4())[:8], "file_id": file_id, "employee": meta.employee,
                                     **issue.to_dict()})

            activities = pd.DataFrame(act_rows, columns=ACTIVITY_COLUMNS)
            releases = pd.DataFrame(rel_rows, columns=RELEASE_COLUMNS)
            _mark_duplicates(activities, ["employee", "report_date", "ticket_id", "work_details", "work_status_raw"])
            _mark_duplicates(releases, ["employee", "report_date", "ticket_id", "release_details", "prod_deployment_raw"])
            for df in (activities, releases):
                for col in ("report_date",):
                    df[col] = pd.to_datetime(df[col], errors="coerce")
            activities["activity_date"] = pd.to_datetime(activities["activity_date"], errors="coerce")
            activities["due_date"] = pd.to_datetime(activities["due_date"], errors="coerce")
            activities["resolved_date"] = pd.to_datetime(activities["resolved_date"], errors="coerce")
            releases["release_date"] = pd.to_datetime(releases["release_date"], errors="coerce")
            reports = pd.DataFrame(rep_rows, columns=REPORT_COLUMNS)
            reports["report_date"] = pd.to_datetime(reports["report_date"], errors="coerce")

            # duplicate issues
            for _, row in activities[activities["is_duplicate"]].iterrows():
                iss_rows.append({"issue_id": str(uuid.uuid4())[:8], "file_id": row["file_id"], "employee": row["employee"],
                                 "severity": "info", "category": "duplicate",
                                 "message": f"Duplicate work item for ticket {row['ticket_id'] or '(no id)'} within the same report",
                                 "file_name": row["file_name"], "sheet": row["source_sheet"], "row": row["source_row"],
                                 "field": "ticket_id", "value": row["ticket_id"]})
            issues = pd.DataFrame(iss_rows, columns=ISSUE_COLUMNS)

            self._activities, self._releases, self._reports = activities, releases, reports
            self._issues, self._kt, self._parsed = issues, pd.DataFrame(kt_rows, columns=KT_COLUMNS), parsed
            self.load_info = info
            self.version += 1

    def renormalize(self) -> None:
        """Re-apply status mapping after configuration changes (raw values kept)."""
        with self._lock:
            self.normalizer.reset_unmapped()
            n = self.normalizer
            a = self._activities
            if len(a):
                a["work_status"] = a["work_status_raw"].map(lambda v: n.normalize("work_status", v).category)
                a["work_type"] = a["work_type_raw"].map(lambda v: n.normalize("work_type", v).category)
                a["dev_deployment"] = a["dev_deployment_raw"].map(lambda v: n.normalize("dev_deployment", v).category)
                a["prod_required"] = a["prod_required_raw"].map(lambda v: n.normalize("prod_required", v).category)
                a["prod_deployment"] = a["prod_deployment_raw"].map(lambda v: n.normalize("prod_deployment", v).category)
            r = self._releases
            if len(r):
                r["prod_deployment"] = r["prod_deployment_raw"].map(lambda v: n.normalize("prod_deployment", v).category)
            self.version += 1

    # ---- row builders ----------------------------------------------------
    def _activity_row(self, rep: ParsedReport, file_id: str, w: Dict[str, Any]) -> Dict[str, Any]:
        meta = rep.metadata
        n = self.normalizer
        app_raw = clean_text(w.get("application"))
        application, app_source = (app_raw, "row") if app_raw else ((meta.application, "report") if meta.application else (None, "none"))
        row_date = parse_date_value(w.get("date")) if "date" in w else None
        ticket_ids = list(w.get("ticket_ids") or [])
        ws = n.normalize("work_status", w.get("work_status"))
        wt = n.normalize("work_type", w.get("work_type"))
        dd = n.normalize("dev_deployment", w.get("dev_deployment"))
        pr = n.normalize("prod_required", w.get("prod_required"))
        pdp = n.normalize("prod_deployment", w.get("prod_deployment"))
        return {
            "activity_id": f"{file_id}:{w.get('source_row')}", "file_id": file_id, "file_name": rep.file_name,
            "source_sheet": w.get("source_sheet"), "source_row": w.get("source_row"),
            "report_date": meta.report_date, "activity_date": row_date or meta.report_date,
            "employee": meta.employee or clean_text(w.get("employee")),
            "project": meta.project or clean_text(w.get("project")),
            "jira_board": meta.jira_board or clean_text(w.get("jira_board")), "team_lead": meta.team_lead,
            "application": application, "application_source": app_source,
            "ticket_id": ticket_ids[0] if ticket_ids else None, "ticket_ids": ticket_ids,
            "ticket_raw": clean_text(w.get("ticket_id")), "ticket_link": clean_text(w.get("ticket_link")),
            "has_ticket": bool(ticket_ids), "ticket_note": w.get("ticket_note"),
            "work_details": clean_text(w.get("work_details")),
            "work_type_raw": wt.original, "work_type": wt.category,
            "work_status_raw": ws.original, "work_status": ws.category,
            "prod_required_raw": pr.original, "prod_required": pr.category,
            "dev_deployment_raw": dd.original, "dev_deployment": dd.category,
            "prod_deployment_raw": pdp.original, "prod_deployment": pdp.category,
            "environment": clean_text(w.get("environment")), "comments": clean_text(w.get("comments")),
            "sprint": clean_text(w.get("sprint")),
            "story_points": float(w["story_points"]) if isinstance(w.get("story_points"), (int, float)) else None,
            "due_date": parse_date_value(w.get("due_date")) if w.get("due_date") is not None else None,
            "due_source": w.get("due_source"),
            "resolved_date": parse_date_value(w.get("resolved_date")) if w.get("resolved_date") is not None else None,
            "is_duplicate": False,
        }

    def _release_row(self, rep: ParsedReport, file_id: str, r: Dict[str, Any]) -> Dict[str, Any]:
        meta = rep.metadata
        ticket_ids = list(r.get("ticket_ids") or [])
        pdp = self.normalizer.normalize("prod_deployment", r.get("prod_deployment"))
        rd = r.get("release_date_parsed")
        return {
            "release_id": f"{file_id}:rel:{r.get('source_row')}", "file_id": file_id, "file_name": rep.file_name,
            "source_sheet": r.get("source_sheet"), "source_row": r.get("source_row"), "report_date": meta.report_date,
            "employee": meta.employee, "project": meta.project, "jira_board": meta.jira_board,
            "application": clean_text(r.get("application")) or meta.application,
            "ticket_id": ticket_ids[0] if ticket_ids else None, "ticket_ids": ticket_ids,
            "ticket_raw": clean_text(r.get("release_tickets")), "has_ticket": bool(ticket_ids),
            "release_details": clean_text(r.get("release_details")),
            "release_date": rd or meta.report_date, "release_date_source": "cell" if rd else "report_date",
            "prod_deployment_raw": pdp.original, "prod_deployment": pdp.category,
            "comments": clean_text(r.get("comments")), "sprint": clean_text(r.get("sprint")), "is_duplicate": False,
        }


def _file_id(rep: ParsedReport) -> str:
    import hashlib
    return hashlib.sha1(f"{rep.file_path}|{rep.checksum}".encode("utf-8", "ignore")).hexdigest()[:12]


def _folder_of(rep: ParsedReport) -> str:
    from pathlib import Path
    return Path(rep.file_path).parent.name


def _mark_duplicates(df: pd.DataFrame, keys: List[str]) -> None:
    if df.empty:
        return
    subset = df[keys].astype(str)
    df["is_duplicate"] = subset.duplicated(keep="first")
