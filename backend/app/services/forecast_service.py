"""Monte-Carlo delivery forecast from historical throughput.

Plain statistics, no model to train: the last N weeks of *tickets completed per day* for the selected scope are
bootstrapped 10,000 times to answer two questions delivery managers get asked -
"when will the remaining work be done?" and "how much will be done by <date>?" - with explicit confidence levels.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from app.services.analytics_service import AnalyticsEngine
from app.services.filter_service import Filters

HISTORY_WEEKS = 8
RUNS = 10_000
PERCENTILES = (50, 70, 85, 95)
MAX_HORIZON_DAYS = 365


class ForecastService:
    def __init__(self, engine: AnalyticsEngine) -> None:
        self.engine = engine

    def forecast(self, f: Filters, target_date: Optional[date] = None, remaining_override: Optional[int] = None) -> Dict[str, Any]:
        f = self.engine.resolve_filters(f)
        key = f"forecast:{target_date}:{remaining_override}:{f.cache_key()}"
        return self.engine._cached(key, lambda: self._build(f, target_date, remaining_override))

    # ------------------------------------------------------------------ build
    def _build(self, f: Filters, target_date: Optional[date], remaining_override: Optional[int]) -> Dict[str, Any]:
        today = pd.Timestamp(date.today()).normalize()
        # history is taken from the *scope* (boards/projects/people) but not the date filter: a 15-day window is
        # too little signal, so we always look back HISTORY_WEEKS from today for throughput.
        hist_filters = Filters(**{**f.__dict__, "start_date": (today - pd.Timedelta(weeks=HISTORY_WEEKS)).date(),
                                  "end_date": today.date(), "sprint": []})
        a, r, _ = self.engine.scope(hist_filters)
        tickets = self.engine.ticket_table(a, r) if len(a) else pd.DataFrame()
        done_on = pd.to_datetime(tickets["completed_on"], errors="coerce").dropna() if len(tickets) else pd.Series(dtype="datetime64[ns]")
        start = today - pd.Timedelta(weeks=HISTORY_WEEKS)
        done_on = done_on[(done_on >= start) & (done_on <= today)]
        days = pd.date_range(start, today, freq="D")
        daily = done_on.dt.normalize().value_counts().reindex(days, fill_value=0).astype(int)
        weekly = daily.resample("W-MON", label="left", closed="left").sum()
        # remaining work in the user's actual scope (date filter applies to what counts as "in scope")
        a_cur, r_cur, _ = self.engine.scope(f)
        cur = self.engine.ticket_table(a_cur, r_cur) if len(a_cur) else pd.DataFrame()
        remaining = int(remaining_override) if remaining_override is not None else (int(cur["is_remaining"].sum()) if len(cur) else 0)

        history_days = int(len(daily))
        total_done = int(daily.sum())
        enough = total_done >= 10 and history_days >= 28
        confidence = "good" if total_done >= 40 and history_days >= 56 else "fair" if enough else "low"
        out: Dict[str, Any] = {
            "scope": ", ".join(f.jira_board) or ", ".join(f.project) or ", ".join(f.employee) or "All boards",
            "history": {"weeks": HISTORY_WEEKS, "days": history_days, "completed": total_done,
                        "per_week": [{"week": d.date().isoformat(), "completed": int(v)} for d, v in weekly.items()],
                        "avg_per_week": round(float(weekly.mean()), 1) if len(weekly) else 0.0,
                        "avg_per_day": round(float(daily.mean()), 2) if len(daily) else 0.0},
            "remaining": remaining,
            "confidence": confidence,
            "runs": RUNS,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "completion": None,
            "by_date": None,
            "note": None,
        }
        if not enough or remaining == 0:
            out["note"] = ("Nothing left to forecast: no open tickets in this scope." if remaining == 0 else
                           f"Not enough history yet ({total_done} completions over {history_days} days). Forecasts need roughly 4 weeks and 10+ completions.")
            if not enough:
                return out
        rng = np.random.default_rng(int(hashlib.sha256(f.cache_key().encode()).hexdigest()[:8], 16))
        samples = daily.values  # empirical daily throughput, weekends included (they are real zero days)
        if remaining > 0:
            # question 1: days until `remaining` completions
            cum = np.zeros(RUNS, dtype=np.int64)
            finished = np.full(RUNS, -1, dtype=np.int64)
            for day in range(1, MAX_HORIZON_DAYS + 1):
                cum += rng.choice(samples, size=RUNS, replace=True)
                hit = (finished < 0) & (cum >= remaining)
                finished[hit] = day
                if (finished >= 0).all():
                    break
            finished = np.where(finished < 0, MAX_HORIZON_DAYS + 1, finished)
            pct = {p: int(np.percentile(finished, p)) for p in PERCENTILES}
            out["completion"] = {
                "percentiles": [{"p": p, "days": d, "date": (today + pd.Timedelta(days=int(d))).date().isoformat() if d <= MAX_HORIZON_DAYS else None}
                                for p, d in pct.items()],
                "beyond_horizon_share": round(float((finished > MAX_HORIZON_DAYS).mean()), 3),
            }
        # question 2: completions by target date (default: 14 days or sprint end)
        tgt = pd.Timestamp(target_date) if target_date else today + pd.Timedelta(days=14)
        horizon = int((tgt.normalize() - today).days)
        if horizon > 0:
            sims = rng.choice(samples, size=(RUNS, min(horizon, MAX_HORIZON_DAYS)), replace=True).sum(axis=1)
            out["by_date"] = {
                "date": tgt.date().isoformat(), "days": horizon,
                "percentiles": [{"p": p, "completed": int(np.percentile(sims, 100 - p))} for p in PERCENTILES],  # p85 = "at least this many with 85 % confidence"
                "probability_all_done": round(float((sims >= remaining).mean()), 3) if remaining else None,
                "expected": round(float(sims.mean()), 1),
            }
        return out
