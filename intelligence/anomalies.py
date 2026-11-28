"""Statistical anomaly detection on delivery time series (no training data needed).

For each series (team / board / person x metric) a robust baseline is computed from the preceding weeks
(median and MAD); the latest week is flagged when its robust z-score exceeds a threshold. This catches
"throughput halved", "blocked count tripled", "carry-over jumped" without hand-written rules per case.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from app.services.analytics_service import AnalyticsEngine
from app.services.filter_service import Filters

WEEKS = 10          # history window
MIN_WEEKS = 5       # minimum history before flagging
Z_THRESHOLD = 2.5   # robust z (MAD-based, ~ equivalent to 1.7 sigma)
METRICS = {
    "completed": ("tickets completed", "low"),        # anomaly direction that matters: low
    "blocked": ("tickets blocked", "high"),
    "started": ("tickets started", "both"),
    "activity": ("status updates", "low"),
}
# plain-English meaning shown to users, keyed by (metric, direction)
MEANING = {
    ("completed", "down"): "Fewer tickets finished than usual - throughput dropped",
    ("completed", "up"): "More tickets finished than usual",
    ("blocked", "up"): "More tickets became blocked than usual",
    ("blocked", "down"): "Fewer tickets became blocked than usual",
    ("started", "up"): "Unusually many new tickets picked up - possible over-commitment",
    ("started", "down"): "Unusually few new tickets picked up",
    ("activity", "down"): "Far fewer status updates logged than usual - work may not be reported",
    ("activity", "up"): "Far more status updates logged than usual",
}


def robust_z(history: np.ndarray, value: float) -> Optional[float]:
    if len(history) < MIN_WEEKS:
        return None
    med = float(np.median(history))
    mad = float(np.median(np.abs(history - med)))
    scale = 1.4826 * mad if mad > 0 else (np.std(history) if np.std(history) > 0 else 1.0)
    return (value - med) / scale


class AnomalyService:
    def __init__(self, engine: AnalyticsEngine) -> None:
        self.engine = engine

    def detect(self, f: Filters, group_by: str = "employee") -> Dict[str, Any]:
        f = self.engine.resolve_filters(f)
        return self.engine._cached(f"anomalies:{group_by}:{f.cache_key()}", lambda: self._detect(f, group_by))

    def _detect(self, f: Filters, group_by: str) -> Dict[str, Any]:
        today = pd.Timestamp(pd.Timestamp.today().date())
        start = today - pd.Timedelta(weeks=WEEKS)
        hist_f = Filters(**{**f.__dict__, "start_date": start.date(), "end_date": today.date(), "sprint": []})
        a, r, _ = self.engine.scope(hist_f)
        out: Dict[str, Any] = {"weeks": WEEKS, "threshold": Z_THRESHOLD, "items": [], "series": {}}
        if not len(a):
            return out
        tickets = self.engine.ticket_table(a, r)
        weeks = pd.date_range((start - pd.Timedelta(days=start.weekday())).normalize(), today.normalize(), freq="7D")
        wk = lambda s: (pd.to_datetime(s) - pd.to_timedelta(pd.to_datetime(s).dt.weekday, unit="D")).dt.normalize()  # noqa: E731

        def series_for(mask_group: Optional[str]) -> Dict[str, np.ndarray]:
            tt = tickets if mask_group is None else tickets[tickets["latest_employee"] == mask_group] if group_by == "employee" else tickets[tickets["jira_board"].str.contains(mask_group, regex=False, na=False)]
            aa = a if mask_group is None else a[a[group_by if group_by in a.columns else "employee"] == mask_group]
            done = pd.to_datetime(tt["completed_on"], errors="coerce").dropna()
            started = pd.to_datetime(tt["first_seen_all"], errors="coerce").dropna()
            blocked = pd.to_datetime(tt["blocked_since"], errors="coerce").dropna()
            def count(s: pd.Series) -> np.ndarray:
                return wk(s).value_counts().reindex(weeks, fill_value=0).to_numpy(dtype=float) if len(s) else np.zeros(len(weeks))
            return {"completed": count(done), "started": count(started), "blocked": count(blocked),
                    "activity": count(aa["report_date"]) if len(aa) else np.zeros(len(weeks))}

        groups: List[Optional[str]] = [None]
        if group_by == "employee":
            groups += sorted({str(e) for e in tickets["latest_employee"].dropna() if str(e).strip() and str(e) != "Unassigned"})
        elif group_by == "jira_board":
            groups += sorted({b for bs in tickets["jira_boards"] for b in (bs or [])})
        items: List[Dict[str, Any]] = []

        # Human description of each scope so a row never just says "Team"
        all_boards = sorted({b for bs in tickets["jira_boards"] for b in (bs or [])}) if "jira_boards" in tickets.columns else []
        all_projects = sorted({p for ps in tickets.get("projects", pd.Series(dtype=object)) for p in (ps or [])}) if "projects" in tickets.columns else []
        people_n = int(tickets["latest_employee"].dropna().loc[lambda x: x != "Unassigned"].nunique()) if "latest_employee" in tickets.columns else 0

        def team_detail() -> str:
            if f.jira_board:
                return "Board" + ("s" if len(f.jira_board) > 1 else "") + ": " + ", ".join(f.jira_board)
            if f.project:
                return "Project" + ("s" if len(f.project) > 1 else "") + ": " + ", ".join(f.project)
            if len(all_boards) == 1:
                return f"Board: {all_boards[0]}"
            return f"Whole team - {people_n} people across {len(all_boards)} boards" if all_boards else f"Whole team - {people_n} people"

        def person_detail(name: str) -> str:
            tt = tickets[tickets["latest_employee"] == name]
            boards = sorted({b for bs in tt["jira_boards"] for b in (bs or [])}) if "jira_boards" in tt.columns else []
            projects = sorted({p for ps in tt["projects"] for p in (ps or [])}) if "projects" in tt.columns else []
            parts = [", ".join(projects[:2]) if projects else None, ", ".join(boards[:2]) if boards else None]
            return " - ".join(x for x in parts if x) or "No board recorded"

        def board_detail(name: str) -> str:
            tt = tickets[tickets["jira_board"].str.contains(name, regex=False, na=False)]
            projects = sorted({p for ps in tt["projects"] for p in (ps or [])}) if "projects" in tt.columns else []
            n = int(tt["latest_employee"].dropna().nunique()) if "latest_employee" in tt.columns else 0
            return (", ".join(projects[:2]) + " - " if projects else "") + f"{n} people"

        team_label = team_detail()
        for g in groups[:60]:
            s = series_for(g)
            label = g or "Team"
            if g is None:
                out["series"] = {m: [{"week": w.date().isoformat(), "value": float(v)} for w, v in zip(weeks, s[m])] for m in METRICS}
            for metric, (human, direction) in METRICS.items():
                arr = s[metric]
                if arr[:-1].sum() < MIN_WEEKS:  # practically no activity -> nothing to compare against
                    continue
                z = robust_z(arr[:-1], arr[-1])
                if z is None:
                    continue
                flagged = (direction == "low" and z <= -Z_THRESHOLD) or (direction == "high" and z >= Z_THRESHOLD) or (direction == "both" and abs(z) >= Z_THRESHOLD)
                if not flagged:
                    continue
                med = float(np.median(arr[:-1]))
                direction_word = "down" if z < 0 else "up"
                detail = team_label if g is None else (person_detail(g) if group_by == "employee" else board_detail(g))
                items.append({"scope": label, "group_by": group_by if g else "team", "metric": metric, "metric_label": human, "detail": detail,
                              "week": weeks[-1].date().isoformat(), "value": float(arr[-1]), "baseline_median": med, "z": round(float(z), 2),
                              "baseline_min": float(arr[:-1].min()), "baseline_max": float(arr[:-1].max()), "baseline_weeks": int(len(arr) - 1),
                              "history": [{"week": w.date().isoformat(), "value": float(v)} for w, v in zip(weeks, arr)],
                              "meaning": MEANING.get((metric, direction_word), human),
                              "direction": direction_word, "severity": "danger" if abs(z) >= 2 * Z_THRESHOLD else "warning",
                              "text": f"{label}: {human} this week = {int(arr[-1])} vs a typical {int(med)} ({direction_word}, robust z {z:+.1f})."})
        items.sort(key=lambda d: -abs(d["z"]))
        out["items"] = items[:30]
        return out
