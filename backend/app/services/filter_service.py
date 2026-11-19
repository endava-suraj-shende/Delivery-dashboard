"""Common filter model and application to the activity / release frames."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence

import pandas as pd

from app.utils.text import clean_text

PRESETS = {
    "last_7_days": "Last 7 days",
    "last_15_days": "Last 15 days",
    "last_30_days": "Last 30 days",
    "last_60_days": "Last 60 days",
    "current_week": "Current week",
    "previous_week": "Previous week",
    "current_month": "Current month",
    "previous_month": "Previous month",
    "all": "All data",
    "custom": "Custom range",
}


def preset_range(preset: str, today: Optional[date] = None) -> tuple[Optional[date], Optional[date]]:
    today = today or date.today()
    if preset == "last_7_days":
        return today - timedelta(days=6), today
    if preset == "last_15_days":
        return today - timedelta(days=14), today
    if preset == "last_30_days":
        return today - timedelta(days=29), today
    if preset == "last_60_days":
        return today - timedelta(days=59), today
    if preset == "current_week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if preset == "previous_week":
        start = today - timedelta(days=today.weekday() + 7)
        return start, start + timedelta(days=6)
    if preset == "current_month":
        start = today.replace(day=1)
        nxt = (start + timedelta(days=32)).replace(day=1)
        return start, nxt - timedelta(days=1)
    if preset == "previous_month":
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    return None, None


@dataclass
class Filters:
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    employee: List[str] = field(default_factory=list)
    project: List[str] = field(default_factory=list)
    application: List[str] = field(default_factory=list)
    jira_board: List[str] = field(default_factory=list)
    status: List[str] = field(default_factory=list)           # normalized work_status categories
    work_type: List[str] = field(default_factory=list)        # normalized work_type categories
    dev_deployment: List[str] = field(default_factory=list)   # normalized dev deployment categories
    prod_deployment: List[str] = field(default_factory=list)  # normalized prod deployment categories
    prod_required: List[str] = field(default_factory=list)
    sprint: List[str] = field(default_factory=list)
    ticket: List[str] = field(default_factory=list)
    search: Optional[str] = None

    @classmethod
    def from_query(cls, **kwargs: Any) -> "Filters":
        def lst(v: Any) -> List[str]:
            if v is None:
                return []
            if isinstance(v, str):
                v = [v]
            out: List[str] = []
            for item in v:
                for part in str(item).split("|"):
                    text = clean_text(part)
                    if text:
                        out.append(text)
            return out

        return cls(
            start_date=kwargs.get("start_date"), end_date=kwargs.get("end_date"),
            employee=lst(kwargs.get("employee")), project=lst(kwargs.get("project")),
            application=lst(kwargs.get("application")), jira_board=lst(kwargs.get("jira_board")),
            status=lst(kwargs.get("status")), work_type=lst(kwargs.get("work_type")),
            dev_deployment=lst(kwargs.get("dev_deployment")), prod_deployment=lst(kwargs.get("prod_deployment")),
            prod_required=lst(kwargs.get("prod_required")), sprint=lst(kwargs.get("sprint")), ticket=lst(kwargs.get("ticket")),
            search=clean_text(kwargs.get("search")),
        )

    def with_defaults(self, default_days: int, data_max: Optional[date] = None) -> "Filters":
        """Apply the default period (last N days ending today) when no range is given."""
        if self.start_date or self.end_date:
            if self.start_date and not self.end_date:
                return Filters(**{**self.__dict__, "end_date": date.today()})
            if self.end_date and not self.start_date:
                return Filters(**{**self.__dict__, "start_date": self.end_date - timedelta(days=default_days - 1)})
            return self
        end = date.today()
        start = end - timedelta(days=default_days - 1)
        return Filters(**{**self.__dict__, "start_date": start, "end_date": end})

    def previous_period(self) -> "Filters":
        if not (self.start_date and self.end_date):
            return self
        days = (self.end_date - self.start_date).days + 1
        return Filters(**{**self.__dict__, "start_date": self.start_date - timedelta(days=days),
                          "end_date": self.start_date - timedelta(days=1)})

    @property
    def is_all(self) -> bool:
        return bool(self.start_date and self.end_date and self.start_date.year <= 2000 and self.end_date.year >= 2100)

    @property
    def days(self) -> int:
        if self.start_date and self.end_date and not self.is_all:
            return (self.end_date - self.start_date).days + 1
        return 0

    def label(self) -> str:
        if self.is_all:
            return "All data"
        if self.start_date and self.end_date:
            return f"{self.start_date:%d %b %Y} – {self.end_date:%d %b %Y}"
        return "All data"

    def to_dict(self) -> Dict[str, Any]:
        d = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in self.__dict__.items()}
        d["label"] = self.label()
        d["days"] = self.days
        return d

    def cache_key(self) -> str:
        return hashlib.md5(json.dumps(self.to_dict(), sort_keys=True, default=str).encode()).hexdigest()

    def active_chips(self) -> List[Dict[str, str]]:
        chips: List[Dict[str, str]] = []
        for key in ("employee", "project", "application", "jira_board", "status", "work_type", "dev_deployment",
                    "prod_deployment", "prod_required", "sprint", "ticket"):
            for v in getattr(self, key):
                chips.append({"key": key, "value": v})
        if self.search:
            chips.append({"key": "search", "value": self.search})
        return chips


def _isin(df: pd.DataFrame, col: str, values: Sequence[str], case_insensitive: bool = True) -> pd.Series:
    if not values:
        return pd.Series(True, index=df.index)
    if case_insensitive:
        wanted = {v.lower() for v in values}
        return df[col].astype("string").str.lower().isin(wanted).fillna(False).astype(bool)
    return df[col].isin(values)


def _date_mask(df: pd.DataFrame, col: str, f: Filters) -> pd.Series:
    mask = pd.Series(True, index=df.index)
    if f.sprint:
        # a sprint *is* the period: every piece of work attributed to it counts regardless of the date range
        return mask
    if f.start_date:
        mask &= df[col] >= pd.Timestamp(f.start_date)
    if f.end_date:
        mask &= df[col] <= pd.Timestamp(f.end_date)
    return mask


def _search_mask(df: pd.DataFrame, text: str, columns: Sequence[str]) -> pd.Series:
    needle = text.lower()
    mask = pd.Series(False, index=df.index)
    for col in columns:
        if col in df.columns:
            mask |= df[col].astype("string").str.lower().str.contains(needle, regex=False).fillna(False).astype(bool)
    return mask


SEARCH_COLUMNS_ACTIVITY = ["employee", "ticket_id", "ticket_raw", "project", "application", "jira_board",
                           "work_details", "comments", "work_status_raw", "work_type_raw"]
SEARCH_COLUMNS_RELEASE = ["employee", "ticket_id", "ticket_raw", "project", "application", "jira_board",
                          "release_details", "comments", "prod_deployment_raw"]


def apply_activity_filters(a: pd.DataFrame, f: Filters, *, ignore_date: bool = False) -> pd.DataFrame:
    if a.empty:
        return a
    mask = pd.Series(True, index=a.index)
    if not ignore_date:
        mask &= _date_mask(a, "report_date", f)
    mask &= _isin(a, "employee", f.employee)
    mask &= _isin(a, "project", f.project)
    mask &= _isin(a, "application", f.application)
    mask &= _isin(a, "jira_board", f.jira_board)
    mask &= _isin(a, "work_status", f.status, case_insensitive=False)
    mask &= _isin(a, "work_type", f.work_type, case_insensitive=False)
    mask &= _isin(a, "dev_deployment", f.dev_deployment, case_insensitive=False)
    mask &= _isin(a, "prod_required", f.prod_required, case_insensitive=False)
    if f.sprint and "sprint" in a.columns:
        mask &= _isin(a, "sprint", f.sprint)
    if f.prod_deployment:
        mask &= _isin(a, "prod_deployment", f.prod_deployment, case_insensitive=False)
    if f.ticket:
        wanted = {t.upper() for t in f.ticket}
        mask &= a["ticket_ids"].map(lambda ids: bool(set(ids or []) & wanted)) | a["ticket_id"].astype("string").str.upper().isin(wanted).fillna(False).astype(bool)
    if f.search:
        mask &= _search_mask(a, f.search, SEARCH_COLUMNS_ACTIVITY)
    return a[mask]


def apply_release_filters(r: pd.DataFrame, f: Filters, *, ignore_date: bool = False) -> pd.DataFrame:
    """Releases are filtered by their release date (falls back to report date)."""
    if r.empty:
        return r
    mask = pd.Series(True, index=r.index)
    if not ignore_date:
        mask &= _date_mask(r, "release_date", f)
    mask &= _isin(r, "employee", f.employee)
    mask &= _isin(r, "project", f.project)
    mask &= _isin(r, "application", f.application)
    mask &= _isin(r, "jira_board", f.jira_board)
    mask &= _isin(r, "prod_deployment", f.prod_deployment, case_insensitive=False)
    if f.sprint and "sprint" in r.columns:
        mask &= _isin(r, "sprint", f.sprint)
    if f.ticket:
        wanted = {t.upper() for t in f.ticket}
        mask &= r["ticket_ids"].map(lambda ids: bool(set(ids or []) & wanted))
    if f.search:
        mask &= _search_mask(r, f.search, SEARCH_COLUMNS_RELEASE)
    return r[mask]


def apply_report_filters(reps: pd.DataFrame, f: Filters, activities: Optional[pd.DataFrame] = None, *, ignore_date: bool = False) -> pd.DataFrame:
    if reps.empty:
        return reps
    mask = pd.Series(True, index=reps.index) if ignore_date else _date_mask(reps, "report_date", f)
    mask &= _isin(reps, "employee", f.employee)
    mask &= _isin(reps, "project", f.project)
    mask &= _isin(reps, "jira_board", f.jira_board)
    if f.sprint and activities is not None and "file_id" in reps.columns:
        # reports have no sprint of their own: keep those that contributed work to the sprint
        mask &= reps["file_id"].isin(set(activities["file_id"])) if len(activities) else pd.Series(False, index=reps.index)
    return reps[mask]
