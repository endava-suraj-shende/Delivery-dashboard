"""Feature engineering for ticket-level models.

Every feature is derived from the activity rows and ticket attributes the dashboards already use, so a prediction
can always be traced back to visible facts.

Leakage control: a training example is a *snapshot* of a ticket at a cutoff date (e.g. 7 days after it was first
seen). Only activity rows reported on or before the cutoff are used, `days_to_due` is measured from the cutoff and
the label is the ticket's eventual outcome. Scoring an open ticket uses cutoff = today, which is the same shape.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

WORK_TYPES = ("development", "bug_fix", "testing", "analysis", "deployment")
SNAPSHOT_AGES = (3, 7, 14, 21)  # training snapshots per ticket (days after first seen, must precede completion)

FEATURE_NAMES: List[str] = [
    "age_days",            # cutoff - first seen
    "activity_count",      # work rows / status transitions up to the cutoff
    "report_count",        # distinct report days up to the cutoff
    "status_changes",      # distinct normalised statuses up to the cutoff
    "days_blocked",        # cutoff - first blocked (0 if never blocked by the cutoff)
    "was_blocked",
    "was_on_hold",
    "reopened",
    "sprint_count",        # sprints seen up to the cutoff (carry-over)
    "has_due",
    "days_to_due",         # due - cutoff (negative = already past due); 0 when no due date
    "assignee_open_load",  # other open tickets of the same assignee at the cutoff
    "multi_assignee",
    "story_points",
    *[f"type_{t}" for t in WORK_TYPES],
]

HUMAN_LABELS: Dict[str, str] = {
    "age_days": "age (days)", "activity_count": "status updates", "report_count": "days reported", "status_changes": "distinct statuses",
    "days_blocked": "days blocked", "was_blocked": "was blocked", "was_on_hold": "was on hold", "reopened": "re-opened",
    "sprint_count": "sprints carried", "has_due": "has due date", "days_to_due": "days to due date", "assignee_open_load": "assignee open load",
    "multi_assignee": "several assignees", "story_points": "story points", "type_development": "development work", "type_bug_fix": "bug fix",
    "type_testing": "testing work", "type_analysis": "analysis work", "type_deployment": "deployment work",
}

META_COLS = ("ticket_id", "work_status", "work_type", "employee", "latest_employee", "project", "jira_board", "sprint",
             "due_date", "completed_on", "is_remaining", "late", "overdue", "cycle_days", "ticket_link", "work_details")


@dataclass
class TicketFeatures:
    ticket_ids: List[str]
    X: np.ndarray                 # shape (n, len(FEATURE_NAMES))
    meta: pd.DataFrame            # one row per example (META_COLS that exist in the ticket table)


def _exploded(activities: pd.DataFrame) -> pd.DataFrame:
    ex = activities[activities["has_ticket"]].explode("ticket_ids").rename(columns={"ticket_ids": "tid"})
    ex = ex[ex["tid"].notna()].copy()
    ex["tid"] = ex["tid"].astype(str).str.upper()
    ex["report_date"] = pd.to_datetime(ex["report_date"], errors="coerce")
    if "sprint" not in ex.columns:
        ex["sprint"] = None
    return ex[["tid", "report_date", "work_status", "employee", "sprint"]]


def _snapshot_features(ex: pd.DataFrame, base: pd.DataFrame) -> np.ndarray:
    """`base`: one row per example with tid, cutoff, first_seen, completed_on, due_date, story_points, work_type,
    employee, example_id. Activity rows are restricted per example to report_date <= cutoff, then aggregated."""
    base = base.reset_index(drop=True)
    m = ex.merge(base[["example_id", "tid", "cutoff"]], on="tid", how="inner")
    m = m[m["report_date"] <= m["cutoff"]]
    g = m.groupby("example_id", sort=False)
    ws = m["work_status"].astype(str)
    agg = pd.DataFrame({
        "activity_count": g.size(),
        "report_count": g["report_date"].nunique(),
        "status_changes": g["work_status"].nunique(),
        "was_blocked": m.assign(_f=(ws == "blocked")).groupby("example_id")["_f"].any(),
        "was_on_hold": m.assign(_f=ws.isin(["pending", "on_hold"])).groupby("example_id")["_f"].any(),
        "reopened": m.assign(_f=(ws == "reopened")).groupby("example_id")["_f"].any(),
        "sprint_count": g["sprint"].nunique(),
        "assignees": g["employee"].nunique(),
        "first_blocked": m[ws == "blocked"].groupby("example_id")["report_date"].min(),
    }).reindex(base["example_id"]).reset_index(drop=True)

    cutoff = pd.to_datetime(base["cutoff"])
    first = pd.to_datetime(base["first_seen"], errors="coerce")
    due = pd.to_datetime(base["due_date"], errors="coerce")
    first_blocked = pd.to_datetime(agg["first_blocked"], errors="coerce")

    # open load of the same assignee at the cutoff: tickets first seen by then and not completed by then
    tk = base.drop_duplicates("tid")
    tk_first = pd.to_datetime(tk["first_seen"], errors="coerce").to_numpy()
    tk_done = pd.to_datetime(tk["completed_on"], errors="coerce").to_numpy()
    tk_emp = tk["employee"].to_numpy()
    load = np.zeros(len(base))
    cache: Dict[tuple, float] = {}
    for i, (c, e) in enumerate(zip(cutoff.to_numpy(), base["employee"].to_numpy())):
        if not isinstance(e, str) or np.isnat(c):
            continue
        k = (c, e)
        if k not in cache:
            open_at = (tk_first <= c) & (np.isnat(tk_done) | (tk_done > c))
            cache[k] = float(max(0, int(((tk_emp == e) & open_at).sum()) - 1))
        load[i] = cache[k]

    types = base["work_type"].fillna("other").astype(str)
    cols = {
        "age_days": (cutoff - first).dt.days.clip(lower=0).fillna(0).astype(float),
        "activity_count": agg["activity_count"].fillna(0).astype(float),
        "report_count": agg["report_count"].fillna(0).astype(float),
        "status_changes": agg["status_changes"].fillna(1).astype(float),
        "days_blocked": (cutoff - first_blocked).dt.days.clip(lower=0).fillna(0).astype(float),
        "was_blocked": agg["was_blocked"].fillna(False).astype(float),
        "was_on_hold": agg["was_on_hold"].fillna(False).astype(float),
        "reopened": agg["reopened"].fillna(False).astype(float),
        "sprint_count": agg["sprint_count"].fillna(0).astype(float),
        "has_due": due.notna().astype(float),
        "days_to_due": (due - cutoff).dt.days.fillna(0).astype(float),
        "assignee_open_load": pd.Series(load),
        "multi_assignee": (agg["assignees"].fillna(1) > 1).astype(float),
        "story_points": pd.to_numeric(base["story_points"], errors="coerce").fillna(0).astype(float),
    }
    for wt in WORK_TYPES:
        cols[f"type_{wt}"] = (types == wt).astype(float)
    X = np.column_stack([cols[n].to_numpy(dtype=float) for n in FEATURE_NAMES])
    return np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)


def _base_frame(tickets: pd.DataFrame) -> pd.DataFrame:
    t = tickets.reset_index(drop=True)
    first_col = "first_seen_all" if "first_seen_all" in t.columns else "first_seen"
    base = pd.DataFrame({
        "tid": t["ticket_id"].astype(str).str.upper(),
        "first_seen": pd.to_datetime(t[first_col], errors="coerce"),
        "completed_on": pd.to_datetime(t["completed_on"], errors="coerce"),
        "due_date": pd.to_datetime(t["due_date"], errors="coerce") if "due_date" in t.columns else pd.Series(pd.NaT, index=t.index),
        "story_points": t["story_points"] if "story_points" in t.columns else 0.0,
        "work_type": t["work_type"],
        "employee": t["latest_employee"] if "latest_employee" in t.columns else t["employee"],
    })
    meta = t[[c for c in META_COLS if c in t.columns]].copy()
    return pd.concat([base, meta.add_prefix("m_")], axis=1)


def _meta(base: pd.DataFrame) -> pd.DataFrame:
    cols = [c for c in base.columns if c.startswith("m_")]
    return base[cols].rename(columns={c: c[2:] for c in cols}).reset_index(drop=True)


def build_features(tickets: pd.DataFrame, activities: pd.DataFrame, reference: Optional[pd.Timestamp] = None) -> TicketFeatures:
    """Scoring: one example per ticket, cutoff = `reference` (default today)."""
    if tickets is None or not len(tickets):
        return TicketFeatures([], np.zeros((0, len(FEATURE_NAMES))), pd.DataFrame())
    ref = pd.Timestamp(reference or pd.Timestamp.today().date())
    base = _base_frame(tickets)
    base["cutoff"] = ref
    base["example_id"] = np.arange(len(base))
    X = _snapshot_features(_exploded(activities), base)
    return TicketFeatures(list(base["m_ticket_id"].astype(str)), X, _meta(base))


def slip_labels(tickets: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
    """Outcome per ticket: 1 = slipped (delivered late, or cycle time above max(2 x median, 7 days)).
    Returns (labels, mask of completed tickets)."""
    done = pd.to_datetime(tickets["completed_on"], errors="coerce").notna()
    cycle = pd.to_numeric(tickets["cycle_days"], errors="coerce")
    median = float(cycle[done].median()) if done.any() and cycle[done].notna().any() else 0.0
    late = tickets["late"].fillna(False).astype(bool) if "late" in tickets.columns else pd.Series(False, index=tickets.index)
    slow = (cycle > max(2 * median, 7)) if median > 0 else pd.Series(False, index=tickets.index)
    y = (late | slow.fillna(False)).astype(int).to_numpy()
    return y, done.to_numpy()


def build_training_set(tickets: pd.DataFrame, activities: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray, int]:
    """Training examples from completed tickets: one snapshot per age in SNAPSHOT_AGES that precedes completion,
    labelled with the ticket's eventual outcome. Returns (X, y, number_of_distinct_tickets)."""
    empty = (np.zeros((0, len(FEATURE_NAMES))), np.zeros(0, dtype=int), 0)
    if tickets is None or not len(tickets):
        return empty
    t = tickets.reset_index(drop=True)
    y_all, done_mask = slip_labels(t)
    base_all = _base_frame(t)
    base_all["label"] = y_all
    done = base_all[done_mask & base_all["first_seen"].notna().to_numpy()]
    if not len(done):
        return empty
    rows = []
    for age in SNAPSHOT_AGES:
        snap = done.copy()
        snap["cutoff"] = snap["first_seen"] + pd.Timedelta(days=age)
        rows.append(snap[snap["cutoff"] < snap["completed_on"]])  # the outcome must still be in the future
    train = pd.concat(rows, ignore_index=True)
    if not len(train):
        return np.zeros((0, len(FEATURE_NAMES))), np.zeros(0, dtype=int), int(done["tid"].nunique())
    train["example_id"] = np.arange(len(train))
    X = _snapshot_features(_exploded(activities), train)
    return X, train["label"].to_numpy(dtype=int), int(train["tid"].nunique())
