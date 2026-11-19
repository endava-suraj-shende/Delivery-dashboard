"""Centralized reporting & aggregation engine.

Every dashboard, table and report in the application derives its numbers from
this module so that counts always reconcile. Two distinct measures are used:

* **activities** – one Excel work-item row = one activity record.
* **unique tickets** – a Jira id counted once regardless of how many rows,
  reports or employees reference it. A ticket's representative status is chosen
  by the configurable *latest status rule* (see ``StatusNormalizer``).
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import date
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from app.processors.status_normalizer import CATEGORY_META, REMAINING_CATEGORIES, STATUS_RANK, StatusNormalizer
from app.services.data_store import InMemoryDataStore
from app.services.performance_service import score_metrics
from app.services.filter_service import (
    Filters,
    apply_activity_filters,
    apply_release_filters,
    apply_report_filters,
)

WORK_STATUS_CATS = list(CATEGORY_META["work_status"].keys())
WORK_TYPE_CATS = list(CATEGORY_META["work_type"].keys())
DEV_CATS = list(CATEGORY_META["dev_deployment"].keys())
PROD_CATS = list(CATEGORY_META["prod_deployment"].keys())
PROD_REQ_CATS = list(CATEGORY_META["prod_required"].keys())

CALCULATION_RULES = [
    "An *activity* is one row of a Work Items table in a bi-weekly report. Activity counts therefore reflect reported work volume, not productivity.",
    "A *unique Jira ticket* is counted once across all rows, reports and employees. Cells containing several ticket ids contribute each id once.",
    "Rows without a recognisable Jira id (blank, 'No Jira', 'NA', project key only) count as activities but never as tickets; they are listed under data quality.",
    "When a ticket appears in several reports its representative status follows the configured rule (default: the status in the most recent report by report date).",
    "Within an employee / project / application breakdown a ticket is attributed to every employee / project / application that reported it.",
    "Dates come from each report's 'Date' cell (falling back to the file name). Work items inherit their report date; production releases use their own release date when present.",
    "Work Status, Work Type, Dev Deployment, 'Production Deployment Required?' and Production Deployment Status are independent dimensions and are never inferred from each other.",
    "Unmapped status values are shown as 'Other / Unmapped' and never assumed to be completed, pending or successful.",
    "A production release is a row of the Production Deployment Summary table; it does not imply the related Jira ticket is complete.",
]


CALCULATION_RULES_JIRA = [
    "An *activity* is one status transition of a Jira issue (from its changelog), plus a snapshot on the day of its last update. Activity counts reflect workflow movement, not productivity.",
    "A *unique Jira ticket* is one issue key, counted once regardless of how many transitions it had.",
    "Each activity is attributed to the issue's current assignee; unassigned issues appear under 'Unassigned'.",
    "The representative status of a ticket follows the configured rule (default: the latest transition by date). Jira status names are mapped to reporting categories in Status Configuration; unmapped names show as 'Other / Unmapped'.",
    "Dates are the real changelog timestamps. The selected period shows issues that *moved* (or were updated) inside it; issues untouched in the period are not counted, exactly like a bi-weekly report that does not mention them.",
    "Work Type comes from the Jira issue type (Story/Improvement -> Development, Bug/Defect -> Bug Fix, Test/QA -> Testing, Spike -> Analysis, DevOps -> Deployment).",
    "Project / Team comes from the Jira 'Team' field (falling back to the board's project); Application comes from Components, then Epic, then labels.",
    "Dev deployment is derived from the environment reached in the workflow (In Dev / In QA / In Stage / Done = deployed). Production uses fixVersions (release flag and release date) and 'In Prod' statuses; issues without a fixVersion show production as Unknown rather than assumed.",
    f"Only issues updated within the configured look-back window are loaded from each board.",
]


def _s(v: Any) -> Any:
    """JSON-safe scalar."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if np.isnan(v) else float(v)
    if isinstance(v, (pd.Timestamp,)):
        return None if pd.isna(v) else v.date().isoformat()
    if isinstance(v, float) and np.isnan(v):
        return None
    if isinstance(v, (list, tuple)):
        return [_s(x) for x in v]
    if isinstance(v, dict):
        return {k: _s(x) for k, x in v.items()}
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def records(df: pd.DataFrame, columns: Optional[Sequence[str]] = None) -> List[Dict[str, Any]]:
    if df.empty:
        return []
    cols = [c for c in (columns or df.columns) if c in df.columns]
    out: List[Dict[str, Any]] = []
    for row in df[cols].itertuples(index=False, name=None):
        out.append({c: _s(v) for c, v in zip(cols, row)})
    return out


def _label(dim: str, cat: str) -> str:
    return CATEGORY_META[dim].get(cat, CATEGORY_META[dim]["other"])["label"]


def _color(dim: str, cat: str) -> str:
    return CATEGORY_META[dim].get(cat, CATEGORY_META[dim]["other"])["color"]


def category_series(dim: str, counts: Dict[str, int]) -> List[Dict[str, Any]]:
    meta = CATEGORY_META[dim]
    return [
        {"key": cat, "label": meta[cat]["label"], "color": meta[cat]["color"], "value": int(counts.get(cat, 0))}
        for cat in sorted(meta, key=lambda c: meta[c]["order"])
    ]


class AnalyticsEngine:
    def __init__(self, store: InMemoryDataStore, normalizer: StatusNormalizer, default_days: int = 15) -> None:
        self.store = store
        self.normalizer = normalizer
        self.default_days = default_days
        self._cache: "OrderedDict[str, Any]" = OrderedDict()
        self._cache_limit = 256
        self.source_mode: Callable[[], str] = lambda: "excel"
        # Optional provider of board members (board labels -> people); None = not available (Excel mode).
        self.board_members: Callable[[List[str]], Optional[List[str]]] = lambda _boards: None

    def rules(self) -> List[str]:
        mode = self.source_mode()
        if mode == "jira":
            return CALCULATION_RULES_JIRA
        if mode == "both":
            return ["Data combines Excel bi-weekly reports and Jira boards; an issue reported in both counts once as a ticket but each source contributes its own activity rows."] + CALCULATION_RULES + CALCULATION_RULES_JIRA
        return CALCULATION_RULES

    # ------------------------------------------------------------------ cache
    def _cached(self, key: str, builder):
        full = f"{self.store.version}:{self.normalizer.config.latest_status_rule}:{self.source_mode()}:{key}"
        if full in self._cache:
            self._cache.move_to_end(full)
            return self._cache[full]
        value = builder()
        self._cache[full] = value
        if len(self._cache) > self._cache_limit:
            self._cache.popitem(last=False)
        return value

    def invalidate(self) -> None:
        self._cache.clear()

    # ------------------------------------------------------------------ scoping
    def resolve_filters(self, f: Filters) -> Filters:
        return f.with_defaults(self.default_days)

    def scope(self, f: Filters) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Return (activities, releases, reports) matching the filters."""
        a = apply_activity_filters(self.store.activities(), f)
        r = apply_release_filters(self.store.releases(), f)
        reps = apply_report_filters(self.store.reports(), f, a)
        return a, r, reps

    def roster(self, f: Filters) -> List[str]:
        """Everyone who belongs to the selected board(s) / project(s), regardless of the date range.

        In Jira mode the board configuration is the source of truth: the people mapped on each selected
        board (or every assignee seen when no mapping is set). Otherwise the people who filed reports."""
        if not f.project and not f.employee:
            members = self.board_members(list(f.jira_board))
            if members is not None:
                return members
        reps = apply_report_filters(self.store.reports(), f, None, ignore_date=True)
        return sorted({str(x) for x in reps["employee"].dropna() if str(x).strip()}) if len(reps) else []

    def period_info(self, f: Filters, reps: pd.DataFrame) -> Dict[str, Any]:
        dates = sorted({d.date().isoformat() for d in reps["report_date"].dropna()}) if len(reps) else []
        return {"start_date": _s(f.start_date), "end_date": _s(f.end_date), "label": f.label(), "days": f.days,
                "report_dates": dates, "report_count": int(len(reps))}

    # ------------------------------------------------------------------ tickets
    def ticket_table(self, a: pd.DataFrame, r: Optional[pd.DataFrame] = None) -> pd.DataFrame:
        """One row per unique Jira ticket with its representative (latest) status."""
        if a.empty:
            return pd.DataFrame(columns=["ticket_id"])
        ex = a[a["has_ticket"]].explode("ticket_ids").rename(columns={"ticket_ids": "tid"})
        ex = ex[ex["tid"].notna()]
        if ex.empty:
            return pd.DataFrame(columns=["ticket_id"])
        rule = self.normalizer.config.latest_status_rule
        ex = ex.assign(_rank=ex["work_status"].map(STATUS_RANK).fillna(0))
        if rule == "most_advanced":
            ex = ex.sort_values(["tid", "_rank", "report_date", "source_row"])
        else:
            ex = ex.sort_values(["tid", "report_date", "_rank", "source_row"])
        last = ex.groupby("tid").tail(1).set_index("tid")
        grp = ex.groupby("tid")
        first_seen = grp["report_date"].min()
        last_seen = grp["report_date"].max()
        completed_mask = ex["work_status"].isin(["completed", "deployed"])
        completed_date = ex[completed_mask].groupby("tid")["report_date"].min()
        blocked_date = ex[ex["work_status"] == "blocked"].groupby("tid")["report_date"].min()

        def uniq(series: pd.Series) -> List[str]:
            return sorted({str(x) for x in series.dropna() if str(x).strip()})

        history: Dict[str, List[Dict[str, Any]]] = {}
        for tid, d, s_, sr, e in zip(ex["tid"], ex["report_date"], ex["work_status"], ex["work_status_raw"], ex["employee"]):
            history.setdefault(tid, []).append({"date": _s(d), "status": s_, "status_raw": sr, "employee": e})

        tickets = pd.DataFrame({
            "ticket_id": last.index,
            "work_status": last["work_status"].values,
            "work_status_raw": last["work_status_raw"].values,
            "work_type": last["work_type"].values,
            "work_type_raw": last["work_type_raw"].values,
            "dev_deployment": last["dev_deployment"].values,
            "dev_deployment_raw": last["dev_deployment_raw"].values,
            "prod_required": last["prod_required"].values,
            "prod_required_raw": last["prod_required_raw"].values,
            "work_details": last["work_details"].values,
            "ticket_link": last["ticket_link"].values,
            "comments": last["comments"].values,
            "latest_employee": last["employee"].values,
            "latest_report_date": last["report_date"].values,
            "sprint": (last["sprint"].values if "sprint" in last.columns else [None] * len(last)),
            "story_points": (last["story_points"].values if "story_points" in last.columns else [None] * len(last)),
            "due_date": (last["due_date"].values if "due_date" in last.columns else [pd.NaT] * len(last)),
            "due_source": (last["due_source"].values if "due_source" in last.columns else [None] * len(last)),
            "resolved_date": (last["resolved_date"].values if "resolved_date" in last.columns else [pd.NaT] * len(last)),
            "employees": grp["employee"].agg(uniq).reindex(last.index).values,
            "projects": grp["project"].agg(uniq).reindex(last.index).values,
            "applications": grp["application"].agg(uniq).reindex(last.index).values,
            "jira_boards": grp["jira_board"].agg(uniq).reindex(last.index).values,
            "activity_count": grp.size().reindex(last.index).values,
            "report_count": grp["file_id"].nunique().reindex(last.index).values,
            "first_seen": first_seen.reindex(last.index).values,
            "last_seen": last_seen.reindex(last.index).values,
            "completed_on": completed_date.reindex(last.index).values,
            "blocked_since": blocked_date.reindex(last.index).values,
            "status_history": [history.get(t, []) for t in last.index],
        }).reset_index(drop=True)
        tickets["employee"] = tickets["employees"].map(lambda xs: ", ".join(xs))
        tickets["project"] = tickets["projects"].map(lambda xs: ", ".join(xs))
        tickets["application"] = tickets["applications"].map(lambda xs: ", ".join(xs))
        tickets["jira_board"] = tickets["jira_boards"].map(lambda xs: ", ".join(xs))
        tickets["is_remaining"] = tickets["work_status"].isin(REMAINING_CATEGORIES)
        tickets["status_changed"] = tickets["status_history"].map(lambda h: len({x["status"] for x in h}) > 1)
        # on-time delivery: completed on/before the due date (Jira due date, else sprint end)
        due = pd.to_datetime(tickets["due_date"], errors="coerce")
        done = pd.to_datetime(tickets["resolved_date"], errors="coerce").fillna(pd.to_datetime(tickets["completed_on"], errors="coerce"))
        is_done = tickets["work_status"].isin(["completed", "deployed"])
        today = pd.Timestamp(date.today())
        tickets["due_tracked"] = due.notna()
        tickets["on_time"] = (is_done & due.notna() & done.notna() & (done.dt.normalize() <= due.dt.normalize())).fillna(False).astype(bool)
        tickets["late"] = (is_done & due.notna() & done.notna() & (done.dt.normalize() > due.dt.normalize())).fillna(False).astype(bool)
        tickets["overdue"] = (~is_done & tickets["is_remaining"] & due.notna() & (due < today)).fillna(False).astype(bool)
        tickets["due_date"] = due
        tickets["resolved_date"] = done

        # production deployment from the release table (never inferred)
        rel = r if r is not None else self.store.releases()
        if rel is not None and not rel.empty:
            rex = rel[rel["has_ticket"]].explode("ticket_ids").rename(columns={"ticket_ids": "tid"})
            rex = rex.sort_values(["tid", "release_date"]).groupby("tid").tail(1).set_index("tid")
            tickets["prod_deployment"] = tickets["ticket_id"].map(rex["prod_deployment"]).fillna("other")
            tickets["prod_deployment_raw"] = tickets["ticket_id"].map(rex["prod_deployment_raw"])
            tickets["release_date"] = tickets["ticket_id"].map(rex["release_date"])
            tickets["has_release"] = tickets["ticket_id"].isin(rex.index)
        else:
            tickets["prod_deployment"] = "other"
            tickets["prod_deployment_raw"] = None
            tickets["release_date"] = pd.NaT
            tickets["has_release"] = False
        return tickets

    # ------------------------------------------------------------------ counting
    @staticmethod
    def counts(series: pd.Series, cats: Sequence[str]) -> Dict[str, int]:
        vc = series.value_counts() if len(series) else pd.Series(dtype=int)
        return {c: int(vc.get(c, 0)) for c in cats}

    def kpis(self, a: pd.DataFrame, r: pd.DataFrame, tickets: pd.DataFrame, reps: pd.DataFrame,
             roster: Optional[Sequence[str]] = None) -> Dict[str, Any]:
        all_reps = self.store.reports()
        roster_n = len(roster) if roster is not None else (int(all_reps["employee"].nunique()) if len(all_reps) else 0)
        ts = self.counts(tickets["work_status"], WORK_STATUS_CATS) if len(tickets) else {c: 0 for c in WORK_STATUS_CATS}
        tt = self.counts(tickets["work_type"], WORK_TYPE_CATS) if len(tickets) else {c: 0 for c in WORK_TYPE_CATS}
        act_status = self.counts(a["work_status"], WORK_STATUS_CATS)
        act_type = self.counts(a["work_type"], WORK_TYPE_CATS)
        dev = self.counts(a["dev_deployment"], DEV_CATS)
        prod_req = self.counts(a["prod_required"], PROD_REQ_CATS)
        prod = self.counts(r["prod_deployment"], PROD_CATS)
        remaining = int(tickets["is_remaining"].sum()) if len(tickets) else 0
        completed = ts["completed"] + ts["deployed"]
        total_t = int(len(tickets))
        return {
            "total_employees": roster_n,
            "active_employees": int(a["employee"].nunique()),
            "inactive_employees": max(roster_n - int(a["employee"].nunique()), 0),
            "total_reports": int(len(reps)),
            "total_activities": int(len(a)),
            "activities_with_ticket": int(a["has_ticket"].sum()),
            "activities_without_ticket": int((~a["has_ticket"]).sum()),
            "duplicate_activities": int(a["is_duplicate"].sum()),
            "total_tickets": total_t,
            "completed_tickets": completed,
            "in_progress_tickets": ts["in_progress"] + ts["development"] + ts["code_review"] + ts["testing"]
                                   + ts["ready_for_qa"] + ts["ready_for_deployment"],
            "pending_tickets": ts["pending"] + ts["on_hold"] + ts["reopened"],
            "blocked_tickets": ts["blocked"],
            "on_hold_tickets": ts["on_hold"],
            "analysis_tickets": ts["analysis"],
            "other_status_tickets": ts["other"],
            "remaining_tickets": remaining,
            "completion_rate": round(100.0 * completed / total_t, 1) if total_t else None,
            "tickets_changed_status": int(tickets["status_changed"].sum()) if len(tickets) else 0,
            "due_tracked_tickets": int(tickets["due_tracked"].sum()) if len(tickets) else 0,
            "on_time_tickets": int(tickets["on_time"].sum()) if len(tickets) else 0,
            "late_tickets": int(tickets["late"].sum()) if len(tickets) else 0,
            "overdue_tickets": int(tickets["overdue"].sum()) if len(tickets) else 0,
            "ticket_status": ts,
            "ticket_type": tt,
            "activity_status": act_status,
            "activity_type": act_type,
            "development_activities": act_type["development"],
            "analysis_activities": act_type["analysis"],
            "testing_activities": act_type["testing"],
            "deployment_activities": act_type["deployment"],
            "bugfix_activities": act_type["bug_fix"],
            "dev_deployment": dev,
            "dev_deployment_activities": int(len(a) - dev["not_required"] - dev["other"]),
            "dev_deployed": dev["deployed"],
            "dev_pending": dev["pending"] + dev["in_progress"],
            "prod_required": prod_req,
            "prod_required_yes": prod_req["yes"],
            "prod_deployment": prod,
            "production_releases": int(len(r)),
            "production_release_tickets": int(r["ticket_ids"].explode().dropna().nunique()) if len(r) else 0,
            "production_released": prod["released"],
            "production_pending": prod["pending"] + prod["in_progress"] + prod["not_released"],
            "production_blocked": prod["blocked"] + prod["failed"],
            "production_success_rate": round(100.0 * prod["released"] / len(r), 1) if len(r) else None,
            "projects": int(a["project"].nunique()),
            "applications": int(a["application"].nunique()),
            "jira_boards": int(a["jira_board"].nunique()),
        }

    # ------------------------------------------------------------------ distributions
    def status_by(self, tickets: pd.DataFrame, a: pd.DataFrame, by: str, dim: str = "work_status",
                  top: Optional[int] = None) -> List[Dict[str, Any]]:
        """Ticket status distribution grouped by employee/project/application/board.

        A ticket is attributed to every group that reported it.
        """
        if tickets.empty:
            return []
        col = {"employee": "employees", "project": "projects", "application": "applications",
               "jira_board": "jira_boards"}[by]
        ex = tickets[["ticket_id", dim, col]].explode(col).dropna(subset=[col])
        piv = ex.groupby([col, dim]).size().unstack(fill_value=0)
        cats = list(CATEGORY_META[dim].keys())
        for c in cats:
            if c not in piv.columns:
                piv[c] = 0
        piv["total"] = piv[cats].sum(axis=1)
        piv = piv.sort_values("total", ascending=False)
        if top:
            piv = piv.head(top)
        out = []
        for name, row in piv.iterrows():
            item = {"name": name, "total": int(row["total"])}
            item.update({c: int(row[c]) for c in cats})
            if dim == "work_status":
                item["completed_total"] = int(row["completed"] + row["deployed"])
                item["in_progress_total"] = int(row["in_progress"] + row["development"] + row["code_review"]
                                                + row["testing"] + row["ready_for_qa"] + row["ready_for_deployment"])
                item["pending_total"] = int(row["pending"] + row["on_hold"] + row["reopened"])
            out.append(item)
        return out

    def activity_by(self, a: pd.DataFrame, by: str, dim: str, top: Optional[int] = None) -> List[Dict[str, Any]]:
        if a.empty:
            return []
        piv = a.groupby([by, dim]).size().unstack(fill_value=0)
        cats = list(CATEGORY_META[dim].keys())
        for c in cats:
            if c not in piv.columns:
                piv[c] = 0
        piv["total"] = piv[cats].sum(axis=1)
        piv = piv.sort_values("total", ascending=False)
        if top:
            piv = piv.head(top)
        return [{"name": name, "total": int(row["total"]), **{c: int(row[c]) for c in cats}} for name, row in piv.iterrows()]

    def simple_counts(self, df: pd.DataFrame, by: str, top: Optional[int] = None) -> List[Dict[str, Any]]:
        if df.empty or by not in df.columns:
            return []
        vc = df[by].fillna("Unspecified").value_counts()
        if top:
            vc = vc.head(top)
        return [{"name": str(k), "value": int(v)} for k, v in vc.items()]

    # ------------------------------------------------------------------ trends
    def trend(self, a: pd.DataFrame, tickets: pd.DataFrame, r: pd.DataFrame) -> List[Dict[str, Any]]:
        """Per report date: activities, unique tickets, first-time completions, remaining backlog."""
        if a.empty:
            return []
        dates = sorted(a["report_date"].dropna().unique())
        out: List[Dict[str, Any]] = []
        if len(tickets):
            completed_on = tickets["completed_on"].dropna()
            first_seen = tickets["first_seen"]
        else:
            completed_on = pd.Series(dtype="datetime64[ns]")
            first_seen = pd.Series(dtype="datetime64[ns]")
        ex = a[a["has_ticket"]].explode("ticket_ids")
        for d in dates:
            day = a[a["report_date"] == d]
            day_ex = ex[ex["report_date"] == d]
            status = self.counts(day["work_status"], WORK_STATUS_CATS)
            types = self.counts(day["work_type"], WORK_TYPE_CATS)
            dev = self.counts(day["dev_deployment"], DEV_CATS)
            seen_so_far = int((first_seen <= d).sum()) if len(first_seen) else 0
            completed_so_far = int((completed_on <= d).sum()) if len(completed_on) else 0
            out.append({
                "date": _s(pd.Timestamp(d)),
                "activities": int(len(day)),
                "reports": int(day["file_id"].nunique()),
                "employees": int(day["employee"].nunique()),
                "unique_tickets": int(day_ex["ticket_ids"].nunique()),
                "completed_tickets": int((completed_on == d).sum()) if len(completed_on) else 0,
                "completed_activities": status["completed"] + status["deployed"],
                "in_progress_activities": status["in_progress"] + status["development"] + status["code_review"] + status["testing"],
                "blocked_activities": status["blocked"],
                "pending_activities": status["pending"] + status["on_hold"],
                "development": types["development"], "analysis": types["analysis"], "testing": types["testing"],
                "deployment": types["deployment"], "bug_fix": types["bug_fix"],
                "dev_deployed": dev["deployed"], "dev_pending": dev["pending"],
                "backlog": max(seen_so_far - completed_so_far, 0),
                "releases": int((r["release_date"] == d).sum()) if len(r) else 0,
                "released": int(((r["release_date"] == d) & (r["prod_deployment"] == "released")).sum()) if len(r) else 0,
            })
        return out

    def release_trend(self, r: pd.DataFrame) -> List[Dict[str, Any]]:
        if r.empty:
            return []
        piv = r.groupby([r["release_date"].dt.date, "prod_deployment"]).size().unstack(fill_value=0)
        for c in PROD_CATS:
            if c not in piv.columns:
                piv[c] = 0
        return [{"date": _s(pd.Timestamp(d)), "total": int(row[PROD_CATS].sum()), **{c: int(row[c]) for c in PROD_CATS}}
                for d, row in piv.sort_index().iterrows()]

    # ------------------------------------------------------------------ tables
    def employee_table(self, a: pd.DataFrame, r: pd.DataFrame, tickets: pd.DataFrame) -> List[Dict[str, Any]]:
        if a.empty:
            return []
        rows: List[Dict[str, Any]] = []
        rel_by_emp = r.groupby("employee") if len(r) else None
        for emp, grp in a.groupby("employee", dropna=False):
            emp_tickets = self.ticket_table(grp, r)
            ts = self.counts(emp_tickets["work_status"], WORK_STATUS_CATS) if len(emp_tickets) else {c: 0 for c in WORK_STATUS_CATS}
            at = self.counts(grp["work_type"], WORK_TYPE_CATS)
            dev = self.counts(grp["dev_deployment"], DEV_CATS)
            rel = rel_by_emp.get_group(emp) if rel_by_emp is not None and emp in rel_by_emp.groups else pd.DataFrame(columns=r.columns)
            prod = self.counts(rel["prod_deployment"], PROD_CATS)
            rows.append({
                "employee": emp, "project": ", ".join(sorted({str(x) for x in grp["project"].dropna()})) or None,
                "application": ", ".join(sorted({str(x) for x in grp["application"].dropna()})) or None,
                "jira_board": ", ".join(sorted({str(x) for x in grp["jira_board"].dropna()})) or None,
                "team_lead": next((x for x in grp["team_lead"].dropna()), None),
                "reports": int(grp["file_id"].nunique()),
                "last_report_date": _s(grp["report_date"].max()),
                "total_activities": int(len(grp)),
                "unique_tickets": int(len(emp_tickets)),
                "completed": ts["completed"] + ts["deployed"],
                "in_progress": ts["in_progress"] + ts["development"] + ts["code_review"] + ts["testing"] + ts["ready_for_qa"] + ts["ready_for_deployment"],
                "pending": ts["pending"] + ts["on_hold"] + ts["reopened"],
                "blocked": ts["blocked"], "on_hold": ts["on_hold"], "other_status": ts["other"],
                "code_review": ts["code_review"], "testing_tickets": ts["testing"] + ts["ready_for_qa"],
                "development_tickets": ts["in_progress"] + ts["development"], "ready_for_deployment": ts["ready_for_deployment"],
                "analysis_tickets": ts["analysis"], "backlog": ts["pending"], "reopened": ts["reopened"], "cancelled": ts["cancelled"],
                "analysis": at["analysis"], "development": at["development"], "testing": at["testing"],
                "deployment": at["deployment"], "bug_fix": at["bug_fix"],
                "dev_deployed": dev["deployed"], "dev_pending": dev["pending"],
                "production_releases": int(len(rel)), "production_released": prod["released"],
                "production_pending": prod["pending"] + prod["in_progress"] + prod["not_released"],
                "production_blocked": prod["blocked"] + prod["failed"],
                "production_status": self._dominant(rel["prod_deployment"], "prod_deployment") if len(rel) else None,
                "completion_rate": round(100.0 * (ts["completed"] + ts["deployed"]) / len(emp_tickets), 1) if len(emp_tickets) else None,
                "due_tracked": int(emp_tickets["due_tracked"].sum()) if len(emp_tickets) else 0,
                "on_time": int(emp_tickets["on_time"].sum()) if len(emp_tickets) else 0,
                "late": int(emp_tickets["late"].sum()) if len(emp_tickets) else 0,
                "overdue": int(emp_tickets["overdue"].sum()) if len(emp_tickets) else 0,
            })
        for row in rows:
            row.update(score_metrics(row))
        rows.sort(key=lambda x: (-x["completed"], -x["total_activities"], x["employee"] or ""))
        return rows

    def project_table(self, a: pd.DataFrame, r: pd.DataFrame) -> List[Dict[str, Any]]:
        if a.empty:
            return []
        rows: List[Dict[str, Any]] = []
        for proj, grp in a.groupby(a["project"].fillna("Unspecified")):
            t = self.ticket_table(grp, r)
            ts = self.counts(t["work_status"], WORK_STATUS_CATS) if len(t) else {c: 0 for c in WORK_STATUS_CATS}
            at = self.counts(grp["work_type"], WORK_TYPE_CATS)
            dev = self.counts(grp["dev_deployment"], DEV_CATS)
            rel = r[r["project"].fillna("Unspecified") == proj] if len(r) else r
            prod = self.counts(rel["prod_deployment"], PROD_CATS)
            rows.append({
                "project": proj, "employees": int(grp["employee"].nunique()),
                "employee_names": sorted({str(x) for x in grp["employee"].dropna()}),
                "applications": sorted({str(x) for x in grp["application"].dropna()}),
                "jira_boards": sorted({str(x) for x in grp["jira_board"].dropna()}),
                "total_activities": int(len(grp)), "unique_tickets": int(len(t)),
                "completed": ts["completed"] + ts["deployed"],
                "in_progress": ts["in_progress"] + ts["development"] + ts["code_review"] + ts["testing"] + ts["ready_for_qa"] + ts["ready_for_deployment"],
                "pending": ts["pending"] + ts["on_hold"] + ts["reopened"], "blocked": ts["blocked"],
                "other_status": ts["other"],
                "analysis": at["analysis"], "development": at["development"], "testing": at["testing"],
                "deployment": at["deployment"], "bug_fix": at["bug_fix"],
                "dev_deployed": dev["deployed"], "dev_pending": dev["pending"],
                "production_releases": int(len(rel)), "production_released": prod["released"],
                "production_pending": prod["pending"] + prod["in_progress"] + prod["not_released"],
                "production_blocked": prod["blocked"] + prod["failed"],
                "backlog": int(t["is_remaining"].sum()) if len(t) else 0,
                "completion_rate": round(100.0 * (ts["completed"] + ts["deployed"]) / len(t), 1) if len(t) else None,
            })
        rows.sort(key=lambda x: (-x["total_activities"], x["project"]))
        return rows

    @staticmethod
    def _dominant(series: pd.Series, dim: str) -> Optional[str]:
        if series.empty:
            return None
        return _label(dim, series.value_counts().idxmax())

    # ------------------------------------------------------------------ insights
    def insights(self, a: pd.DataFrame, r: pd.DataFrame, tickets: pd.DataFrame, k: Dict[str, Any],
                 prev: Optional[Dict[str, Any]], f: Filters) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []

        def add(kind: str, title: str, detail: str, value: Any = None, link: Optional[Dict[str, str]] = None) -> None:
            out.append({"type": kind, "title": title, "detail": detail, "value": _s(value), "link": link})

        if a.empty:
            add("info", "No activity in the selected period", "No bi-weekly reports fall inside the selected date range.")
            return out
        emp = self.employee_table(a, r, tickets)
        proj = self.project_table(a, r)
        if emp:
            top_c = max(emp, key=lambda e: e["completed"])
            if top_c["completed"]:
                add("success", "Most completed tickets", f"{top_c['employee']} completed {top_c['completed']} unique tickets.",
                    top_c["completed"], {"type": "employee", "value": top_c["employee"]})
            top_b = max(emp, key=lambda e: e["blocked"])
            if top_b["blocked"]:
                add("danger", "Most blocked tickets", f"{top_b['employee']} has {top_b['blocked']} blocked ticket(s).",
                    top_b["blocked"], {"type": "employee", "value": top_b["employee"]})
            top_ip = max(emp, key=lambda e: e["in_progress"])
            if top_ip["in_progress"] >= 3:
                add("info", "High in-progress load", f"{top_ip['employee']} has {top_ip['in_progress']} tickets in progress.",
                    top_ip["in_progress"], {"type": "employee", "value": top_ip["employee"]})
            top_pending = max(emp, key=lambda e: e["pending"])
            if top_pending["pending"]:
                add("warning", "Most pending work", f"{top_pending['employee']} has {top_pending['pending']} pending / on-hold ticket(s).",
                    top_pending["pending"], {"type": "employee", "value": top_pending["employee"]})
        if proj:
            top_w = proj[0]
            add("info", "Highest workload project", f"{top_w['project']} reported {top_w['total_activities']} activities across {top_w['employees']} employee(s).",
                top_w["total_activities"], {"type": "project", "value": top_w["project"]})
            top_pc = max(proj, key=lambda p: p["completed"])
            if top_pc["completed"]:
                add("success", "Highest completed count by project", f"{top_pc['project']} completed {top_pc['completed']} unique tickets.",
                    top_pc["completed"], {"type": "project", "value": top_pc["project"]})
            blocked_projects = [p for p in proj if p["blocked"]]
            if blocked_projects:
                bp = max(blocked_projects, key=lambda p: p["blocked"])
                share = bp["blocked"] / max(k["blocked_tickets"], 1)
                if share >= 0.5 and k["blocked_tickets"] > 1:
                    add("danger", "Blockers concentrated", f"{int(share * 100)}% of blocked tickets belong to {bp['project']}.",
                        bp["blocked"], {"type": "project", "value": bp["project"]})
            bottleneck = [p for p in proj if p["production_pending"] + p["production_blocked"] >= 2]
            for p in bottleneck[:3]:
                add("warning", "Deployment bottleneck", f"{p['project']} has {p['production_pending'] + p['production_blocked']} production release(s) not yet deployed.",
                    p["production_pending"] + p["production_blocked"], {"type": "project", "value": p["project"]})
        add("success" if k["completed_tickets"] else "info", "Completed in period",
            f"{k['completed_tickets']} unique tickets completed between {f.label()}.", k["completed_tickets"])
        if k["pending_tickets"]:
            add("warning", "Pending across team", f"{k['pending_tickets']} tickets are pending / on hold across the team.", k["pending_tickets"])
        if k["production_releases"]:
            add("info", "Production releases", f"{k['production_released']} of {k['production_releases']} production release activities are deployed; {k['production_pending']} pending.",
                k["production_released"])
        app_dev = a[a["work_type"] == "development"]["application"].value_counts()
        if len(app_dev):
            add("info", "Most development activity", f"{app_dev.index[0]} had {int(app_dev.iloc[0])} development activities.",
                int(app_dev.iloc[0]), {"type": "application", "value": str(app_dev.index[0])})
        inactive = sorted(set(self.store.reports()["employee"].dropna()) - set(a["employee"].dropna()))
        if inactive:
            add("warning", "No reports in period", f"{len(inactive)} employee(s) have no report in the selected period: {', '.join(inactive[:6])}{'…' if len(inactive) > 6 else ''}.",
                len(inactive))
        if prev:
            delta = k["completed_tickets"] - prev["completed_tickets"]
            if prev["completed_tickets"] or k["completed_tickets"]:
                add("success" if delta >= 0 else "warning", "Completed vs previous period",
                    f"Completed tickets {'increased' if delta > 0 else 'decreased' if delta < 0 else 'are unchanged'} by {abs(delta)} compared with the previous {f.days} days ({prev['completed_tickets']} → {k['completed_tickets']}).",
                    delta)
            bdelta = k["blocked_tickets"] - prev["blocked_tickets"]
            if bdelta > 0:
                add("danger", "Blocked tickets rising", f"Blocked tickets increased by {bdelta} versus the previous period.", bdelta)
        if k["other_status_tickets"]:
            add("warning", "Unmapped statuses", f"{k['other_status_tickets']} ticket(s) carry a status that is not mapped to a reporting category. Review Status Configuration.",
                k["other_status_tickets"], {"type": "config", "value": "status"})
        return out

    # ------------------------------------------------------------------ data quality
    def data_quality(self, f: Optional[Filters] = None) -> Dict[str, Any]:
        issues = self.store.issues()
        reps = self.store.reports()
        a = self.store.activities()
        if f is not None and len(reps):
            scoped = apply_report_filters(reps, f)
            issues = issues[issues["file_id"].isin(scoped["file_id"])]
            a = a[a["file_id"].isin(scoped["file_id"])]
        by_cat = issues.groupby(["category", "severity"]).size().reset_index(name="count") if len(issues) else pd.DataFrame(columns=["category", "severity", "count"])
        unmapped = self.normalizer.unmapped_values()
        summary = {
            "total_issues": int(len(issues)),
            "errors": int((issues["severity"] == "error").sum()) if len(issues) else 0,
            "warnings": int((issues["severity"] == "warning").sum()) if len(issues) else 0,
            "missing_employee": int((issues["category"] == "missing_employee").sum()) if len(issues) else 0,
            "missing_project": int((issues["category"] == "missing_project").sum()) if len(issues) else 0,
            "missing_ticket": int((issues["category"] == "missing_ticket").sum()) if len(issues) else 0,
            "missing_status": int((issues["category"] == "missing_status").sum()) if len(issues) else 0,
            "invalid_dates": int(issues["category"].isin(["invalid_date", "report_date"]).sum()) if len(issues) else 0,
            "duplicates": int((issues["category"] == "duplicate").sum()) if len(issues) else 0,
            "incomplete_deployment": int((issues["category"] == "incomplete_deployment").sum()) if len(issues) else 0,
            "unmapped_statuses": sum(len(v) for v in unmapped.values()),
            "activities_without_ticket": int((~a["has_ticket"]).sum()) if len(a) else 0,
            "files_with_errors": int(issues[issues["severity"] == "error"]["file_id"].nunique()) if len(issues) else 0,
        }
        return {
            "summary": summary,
            "by_category": records(by_cat),
            "unmapped": unmapped,
            "issues": records(issues.sort_values(["severity", "file_name", "row"], na_position="last")),
        }

    # ------------------------------------------------------------------ composite views
    def overview(self, f: Filters, *, include_prev: bool = True) -> Dict[str, Any]:
        f = self.resolve_filters(f)

        def build() -> Dict[str, Any]:
            a, r, reps = self.scope(f)
            tickets = self.ticket_table(a, r)
            roster = self.roster(f)
            k = self.kpis(a, r, tickets, reps, roster)
            prev_k = None
            if include_prev and f.start_date and not f.is_all and not f.sprint:
                pf = f.previous_period()
                pa, pr, preps = self.scope(pf)
                prev_k = self.kpis(pa, pr, self.ticket_table(pa, pr), preps, roster)
            return {
                "period": self.period_info(f, reps),
                "filters": f.to_dict(),
                "kpis": k,
                "previous_kpis": prev_k,
                "charts": {
                    "ticket_status": category_series("work_status", k["ticket_status"]),
                    "activity_status": category_series("work_status", k["activity_status"]),
                    "work_type": category_series("work_type", k["activity_type"]),
                    "dev_deployment": category_series("dev_deployment", k["dev_deployment"]),
                    "prod_deployment": category_series("prod_deployment", k["prod_deployment"]),
                    "prod_required": category_series("prod_required", k["prod_required"]),
                    "status_by_employee": self.status_by(tickets, a, "employee"),
                    "status_by_project": self.status_by(tickets, a, "project"),
                    "status_by_application": self.status_by(tickets, a, "application", top=15),
                    "status_by_board": self.status_by(tickets, a, "jira_board"),
                    "type_by_employee": self.activity_by(a, "employee", "work_type"),
                    "type_by_project": self.activity_by(a, "project", "work_type"),
                    "dev_by_employee": self.activity_by(a, "employee", "dev_deployment"),
                    "dev_by_project": self.activity_by(a, "project", "dev_deployment"),
                    "dev_by_application": self.activity_by(a, "application", "dev_deployment", top=15),
                    "prod_by_employee": self.activity_by(r, "employee", "prod_deployment"),
                    "prod_by_project": self.activity_by(r, "project", "prod_deployment"),
                    "prod_by_application": self.activity_by(r, "application", "prod_deployment", top=15),
                    "activities_by_employee": self.simple_counts(a, "employee"),
                    "activities_by_project": self.simple_counts(a, "project"),
                    "activities_by_application": self.simple_counts(a, "application", top=15),
                    "trend": self.trend(a, tickets, r),
                    "release_trend": self.release_trend(r),
                },
                "insights": self.insights(a, r, tickets, k, prev_k, f),
                "employees": self.employee_table(a, r, tickets),
                "projects": self.project_table(a, r),
                "calculation_rules": self.rules(),
                "latest_status_rule": self.normalizer.config.latest_status_rule,
                "source": self.source_mode(),
            }

        return self._cached(f"overview:{include_prev}:{f.cache_key()}", build)

    def activities_view(self, f: Filters, page: int = 1, page_size: int = 50, sort: Optional[str] = None,
                        desc: bool = True) -> Dict[str, Any]:
        f = self.resolve_filters(f)
        a, _, _ = self.scope(f)
        total = int(len(a))
        if sort and sort in a.columns:
            a = a.sort_values(sort, ascending=not desc, na_position="last")
        else:
            a = a.sort_values(["report_date", "employee", "source_row"], ascending=[False, True, True])
        page_size = max(1, min(page_size, 1000))
        start = (max(page, 1) - 1) * page_size
        cols = ["activity_id", "report_date", "employee", "project", "application", "jira_board", "ticket_id",
                "ticket_ids", "ticket_raw", "ticket_link", "work_details", "work_type", "work_type_raw", "work_status",
                "work_status_raw", "prod_required", "prod_required_raw", "dev_deployment", "dev_deployment_raw",
                "environment", "comments", "sprint", "has_ticket", "is_duplicate", "file_name", "source_row"]
        return {"total": total, "page": page, "page_size": page_size, "filters": f.to_dict(),
                "items": records(a.iloc[start:start + page_size], cols)}

    def releases_view(self, f: Filters) -> Dict[str, Any]:
        f = self.resolve_filters(f)
        _, r, _ = self.scope(f)
        r = r.sort_values(["release_date", "employee"], ascending=[False, True])
        cols = ["release_id", "release_date", "release_date_source", "report_date", "employee", "project", "application",
                "jira_board", "ticket_id", "ticket_ids", "ticket_raw", "release_details", "prod_deployment",
                "prod_deployment_raw", "comments", "file_name", "source_row"]
        return {"total": int(len(r)), "filters": f.to_dict(), "items": records(r, cols)}

    def tickets_view(self, f: Filters) -> Dict[str, Any]:
        f = self.resolve_filters(f)
        a, r, _ = self.scope(f)
        t = self.ticket_table(a, r)
        if len(t):
            t = t.sort_values(["last_seen", "ticket_id"], ascending=[False, True])
        cols = ["ticket_id", "work_status", "work_status_raw", "work_type", "work_type_raw", "dev_deployment",
                "dev_deployment_raw", "prod_required", "prod_required_raw", "prod_deployment", "prod_deployment_raw",
                "has_release", "release_date", "work_details", "ticket_link", "employee", "employees", "project",
                "application", "jira_board", "sprint", "due_date", "due_source", "due_tracked", "on_time", "late", "overdue",
                "activity_count", "report_count", "first_seen", "last_seen",
                "completed_on", "blocked_since", "latest_report_date", "status_changed", "is_remaining"]
        return {"total": int(len(t)), "filters": f.to_dict(), "items": records(t, cols)}

    def ticket_detail(self, ticket_id: str) -> Optional[Dict[str, Any]]:
        a = self.store.activities()
        tid = ticket_id.upper()
        mask = a["ticket_ids"].map(lambda ids: tid in (ids or []))
        rows = a[mask]
        if rows.empty:
            return None
        t = self.ticket_table(rows, self.store.releases())
        rel = self.store.releases()
        rel_rows = rel[rel["ticket_ids"].map(lambda ids: tid in (ids or []))] if len(rel) else rel
        return {
            "ticket": records(t)[0] if len(t) else None,
            "activities": records(rows.sort_values("report_date")),
            "releases": records(rel_rows.sort_values("release_date")) if len(rel_rows) else [],
        }

    def dimension_values(self) -> Dict[str, Any]:
        a = self.store.activities()
        reps = self.store.reports()

        def uniq(df: pd.DataFrame, col: str) -> List[str]:
            return sorted({str(x) for x in df[col].dropna() if str(x).strip()}) if len(df) and col in df else []

        return {
            "employees": sorted(set(uniq(a, "employee")) | set(uniq(reps, "employee"))),
            "projects": sorted(set(uniq(a, "project")) | set(uniq(reps, "project"))),
            "applications": uniq(a, "application"),
            "jira_boards": sorted(set(uniq(a, "jira_board")) | set(uniq(reps, "jira_board"))),
            "team_leads": uniq(reps, "team_lead"),
            "work_status": category_series("work_status", {}),
            "work_type": category_series("work_type", {}),
            "dev_deployment": category_series("dev_deployment", {}),
            "prod_deployment": category_series("prod_deployment", {}),
            "prod_required": category_series("prod_required", {}),
            "report_dates": sorted({d.date().isoformat() for d in reps["report_date"].dropna()}) if len(reps) else [],
            "sprints": uniq(a, "sprint"),
            "date_min": _s(reps["report_date"].min()) if len(reps) else None,
            "date_max": _s(reps["report_date"].max()) if len(reps) else None,
        }

    # ------------------------------------------------------------------ sprints
    def sprint_table(self, f: Filters, catalogue: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """One row per sprint with its KPIs. The global date range is ignored (a sprint *is* a period);
        the other filters (employee / project / board / status …) still apply."""
        a_all = self.store.activities()
        if a_all.empty or "sprint" not in a_all.columns:
            return []
        base = Filters(**{**f.__dict__, "sprint": [], "start_date": None, "end_date": None})
        a = apply_activity_filters(a_all, base, ignore_date=True)
        r = apply_release_filters(self.store.releases(), base, ignore_date=True)
        wanted_boards = {b.lower() for b in f.jira_board}
        by_name: Dict[str, Dict[str, Any]] = {str(s["name"]): dict(s) for s in catalogue if s.get("name")
                                              and (not wanted_boards or str(s.get("board") or "").lower() in wanted_boards)}
        for name in a["sprint"].dropna().unique():
            by_name.setdefault(str(name), {"name": str(name), "state": None})
        out: List[Dict[str, Any]] = []
        for name, meta in by_name.items():
            sa = a[a["sprint"].astype("string") == name]
            sr = r[r["sprint"].astype("string") == name] if len(r) and "sprint" in r.columns else r.iloc[0:0]
            tickets = self.ticket_table(sa, sr)
            ts = self.counts(tickets["work_status"], WORK_STATUS_CATS) if len(tickets) else {c: 0 for c in WORK_STATUS_CATS}
            completed = ts["completed"] + ts["deployed"]
            total = int(len(tickets))
            pts = pd.to_numeric(tickets["story_points"], errors="coerce") if len(tickets) else pd.Series(dtype=float)
            done_mask = tickets["work_status"].isin(["completed", "deployed"]) if len(tickets) else pd.Series(dtype=bool)
            committed_pts = float(pts.fillna(0).sum()) if len(pts) else 0.0
            completed_pts = float(pts[done_mask].fillna(0).sum()) if len(pts) else 0.0
            out.append({
                **meta, "name": name,
                "tickets": total, "completed": completed,
                "committed_points": round(committed_pts, 1), "completed_points": round(completed_pts, 1),
                "estimated_tickets": int(pts.notna().sum()) if len(pts) else 0,
                "in_progress": ts["in_progress"] + ts["development"] + ts["code_review"] + ts["testing"] + ts["ready_for_qa"] + ts["ready_for_deployment"],
                "pending": ts["pending"] + ts["on_hold"] + ts["reopened"], "blocked": ts["blocked"],
                "analysis": ts["analysis"], "cancelled": ts["cancelled"], "other": ts["other"],
                "activities": int(len(sa)), "employees": int(sa["employee"].nunique()),
                "production_releases": int(len(sr)), "production_released": int((sr["prod_deployment"] == "released").sum()) if len(sr) else 0,
                "completed_share": round(100.0 * completed / total, 1) if total else None,
                "ticket_status": ts,
            })

        def sort_key(row: Dict[str, Any]) -> Tuple[int, str, str]:
            state_rank = {"active": 0, "future": 1, "closed": 2}.get(row.get("state") or "", 3)
            return (state_rank, row.get("start_date") or "", row["name"])

        # Active sprints are always shown (even if nothing has moved yet); everything else only when it carries work.
        # Jira "future" sprints are often stale placeholders, so they are hidden until they have tickets.
        active = [x for x in out if x.get("state") == "active"]
        rest = sorted([x for x in out if x.get("state") != "active" and x["tickets"]],
                      key=lambda x: (x.get("state") == "future", x.get("start_date") or "", x["name"]), reverse=True)
        return sorted(active, key=sort_key) + rest

    def sprint_filters(self, f: Filters, sprint: Dict[str, Any]) -> Filters:
        """Scope filters to one sprint: its name plus its own date window (all-time when unknown)."""
        start = date.fromisoformat(sprint["start_date"]) if sprint.get("start_date") else date(2000, 1, 1)
        end_raw = sprint.get("complete_date") or sprint.get("end_date")
        end = date.fromisoformat(end_raw) if end_raw else date.today()
        if sprint.get("state") == "active" and end < date.today():
            end = date.today()
        return Filters(**{**f.__dict__, "sprint": [sprint["name"]], "start_date": start, "end_date": max(end, start)})

    def search(self, query: str, limit: int = 10) -> Dict[str, Any]:
        q = (query or "").strip().lower()
        if len(q) < 1:
            return {"employees": [], "projects": [], "applications": [], "jira_boards": [], "tickets": [], "notes": []}
        dims = self.dimension_values()
        a = self.store.activities()

        def pick(values: Iterable[str]) -> List[str]:
            return [v for v in values if q in v.lower()][:limit]

        tickets: List[Dict[str, Any]] = []
        if len(a):
            ex = a[a["has_ticket"]].explode("ticket_ids")
            hits = ex[ex["ticket_ids"].astype(str).str.lower().str.contains(q, regex=False)]
            for tid, grp in hits.groupby("ticket_ids"):
                tickets.append({"ticket_id": tid, "employee": ", ".join(sorted({str(x) for x in grp["employee"].dropna()})),
                                "work_details": grp.sort_values("report_date")["work_details"].iloc[-1]})
                if len(tickets) >= limit:
                    break
            notes_hits = a[a["work_details"].astype("string").str.lower().str.contains(q, regex=False).fillna(False)
                           | a["comments"].astype("string").str.lower().str.contains(q, regex=False).fillna(False)]
            notes = records(notes_hits.head(limit), ["activity_id", "employee", "ticket_id", "work_details", "comments", "report_date"])
        else:
            notes = []
        return {"employees": pick(dims["employees"]), "projects": pick(dims["projects"]),
                "applications": pick(dims["applications"]), "jira_boards": pick(dims["jira_boards"]),
                "tickets": tickets, "notes": notes}

    def compare(self, f1: Filters, f2: Filters) -> Dict[str, Any]:
        o1 = self.overview(f1, include_prev=False)
        o2 = self.overview(f2, include_prev=False)
        keys = ["total_activities", "total_tickets", "completed_tickets", "in_progress_tickets", "pending_tickets",
                "blocked_tickets", "analysis_tickets", "development_activities", "analysis_activities",
                "testing_activities", "dev_deployed", "dev_pending", "production_releases", "production_released",
                "production_pending", "active_employees"]
        deltas = {}
        for key in keys:
            v1, v2 = o1["kpis"].get(key), o2["kpis"].get(key)
            deltas[key] = {"a": v1, "b": v2, "delta": (v2 - v1) if isinstance(v1, (int, float)) and isinstance(v2, (int, float)) else None}
        return {"a": {"period": o1["period"], "kpis": o1["kpis"], "trend": o1["charts"]["trend"], "employees": o1["employees"]},
                "b": {"period": o2["period"], "kpis": o2["kpis"], "trend": o2["charts"]["trend"], "employees": o2["employees"]},
                "deltas": deltas}
