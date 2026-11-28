"""Ticket risk scoring: trains on the installation's completed tickets, scores open ones, explains each score."""
from __future__ import annotations

import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from app.core.logging import get_logger
from intelligence.features import FEATURE_NAMES, HUMAN_LABELS, SNAPSHOT_AGES, build_features, build_training_set
from intelligence.models import LogisticRiskModel, heuristic_risk
from app.services.analytics_service import AnalyticsEngine
from app.services.filter_service import Filters

log = get_logger("intelligence.risk")

BANDS = [(0.75, "high"), (0.45, "medium"), (0.0, "low")]


def band(p: float) -> str:
    for cut, name in BANDS:
        if p >= cut:
            return name
    return "low"


class RiskService:
    def __init__(self, engine: AnalyticsEngine) -> None:
        self.engine = engine
        self.model = LogisticRiskModel(FEATURE_NAMES)
        self._trained_version: Optional[int] = None
        self._trained_at: Optional[str] = None
        self._trained_tickets: int = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ training
    def ensure_trained(self) -> Dict[str, Any]:
        """(Re)train when the data version changed. Uses ALL completed tickets, not the current filter.
        Each completed ticket contributes point-in-time snapshots (features as of N days after first seen) so the
        model learns from the same information it will have when scoring an open ticket."""
        v = self.engine.store.version
        if self._trained_version == v:
            return self.status()
        with self._lock:
            if self._trained_version == v:
                return self.status()
            a = self.engine.store.activities()
            tickets = self.engine.ticket_table(a) if len(a) else pd.DataFrame()
            X, y, n_tickets = build_training_set(tickets, a)
            rep = self.model.fit(X, y)
            self._trained_tickets = n_tickets
            self._trained_version = v
            self._trained_at = datetime.now().isoformat(timespec="seconds")
            log.info("Risk model %s: %s", "trained" if rep.trained else "not trained", rep.reason or f"AUC={rep.auc:.2f} n={rep.samples}")
        return self.status()

    def status(self) -> Dict[str, Any]:
        r = self.model.report
        return {"trained": r.trained, "reason": r.reason, "samples": r.samples, "positives": r.positives, "tickets": self._trained_tickets,
                "snapshot_ages": list(SNAPSHOT_AGES),
                "auc": round(r.auc, 3) if r.auc is not None else None, "accuracy": round(r.accuracy, 3) if r.accuracy is not None else None,
                "brier": round(r.brier, 3) if r.brier is not None else None, "trained_at": self._trained_at, "data_version": self._trained_version,
                "top_features": [{"feature": HUMAN_LABELS.get(d["feature"], d["feature"]), "weight": round(d["weight"], 3)} for d in r.top_features],
                "method": "logistic regression (numpy, L2, class-weighted)" if r.trained else "heuristic score (insufficient history)",
                "features": [HUMAN_LABELS.get(f, f) for f in FEATURE_NAMES]}

    # ------------------------------------------------------------------ scoring
    def score(self, f: Filters, limit: int = 50) -> Dict[str, Any]:
        f = self.engine.resolve_filters(f)
        self.ensure_trained()
        key = f"risk:{limit}:{f.cache_key()}:{self._trained_version}"
        return self.engine._cached(key, lambda: self._score(f, limit))

    def _score(self, f: Filters, limit: int) -> Dict[str, Any]:
        a, r, _ = self.engine.scope(f)
        tickets = self.engine.ticket_table(a, r) if len(a) else pd.DataFrame()
        if not len(tickets):
            return {"items": [], "summary": {"open": 0, "high": 0, "medium": 0, "low": 0}, "model": self.status()}
        open_t = tickets[tickets["is_remaining"]].reset_index(drop=True)
        feats = build_features(open_t, self.engine.store.activities())
        if self.model.trained:
            p = self.model.predict_proba(feats.X)
            expl = self.model.explain(feats.X)
        else:
            p = heuristic_risk(feats.X, FEATURE_NAMES)
            expl = self._heuristic_explain(feats.X)
        items: List[Dict[str, Any]] = []
        for i, row in feats.meta.iterrows():
            prob = float(p[i])
            factors = [{"factor": HUMAN_LABELS.get(n, n), "value": self._feature_value(feats.X[i], n), "impact": round(c, 2)} for n, c in expl[i]]
            items.append({
                "ticket_id": row["ticket_id"], "employee": row.get("latest_employee") or row.get("employee"), "project": row.get("project"),
                "jira_board": row.get("jira_board"), "sprint": row.get("sprint"), "work_status": row.get("work_status"), "work_type": row.get("work_type"),
                "due_date": row["due_date"].date().isoformat() if isinstance(row.get("due_date"), pd.Timestamp) and not pd.isna(row["due_date"]) else None,
                "overdue": bool(row.get("overdue", False)), "ticket_link": row.get("ticket_link"), "summary": row.get("work_details"),
                "risk": round(prob, 3), "band": band(prob), "factors": factors,
                "age_days": int(feats.X[i][FEATURE_NAMES.index("age_days")]), "days_blocked": int(feats.X[i][FEATURE_NAMES.index("days_blocked")]),
            })
        items.sort(key=lambda d: -d["risk"])
        summary = {"open": len(items), "high": sum(1 for d in items if d["band"] == "high"),
                   "medium": sum(1 for d in items if d["band"] == "medium"), "low": sum(1 for d in items if d["band"] == "low"),
                   "expected_slips": round(float(p.sum()), 1)}
        by_person: Dict[str, Dict[str, Any]] = {}
        for d in items:
            e = by_person.setdefault(d["employee"] or "Unassigned", {"employee": d["employee"] or "Unassigned", "open": 0, "high": 0, "risk_sum": 0.0})
            e["open"] += 1
            e["high"] += d["band"] == "high"
            e["risk_sum"] += d["risk"]
        people = sorted(({**v, "avg_risk": round(v["risk_sum"] / v["open"], 2)} for v in by_person.values()), key=lambda x: (-x["high"], -x["avg_risk"]))
        return {"items": items[:limit], "summary": summary, "by_employee": people[:25], "model": self.status()}

    @staticmethod
    def _feature_value(x: np.ndarray, name: str) -> Any:
        v = float(x[FEATURE_NAMES.index(name)])
        return int(v) if v.is_integer() else round(v, 1)

    @staticmethod
    def _heuristic_explain(X: np.ndarray) -> List[List[tuple]]:
        ix = {n: i for i, n in enumerate(FEATURE_NAMES)}
        out = []
        for row in X:
            parts = [("age_days", row[ix["age_days"]] / 45.0), ("days_blocked", row[ix["days_blocked"]] / 10.0),
                     ("sprint_count", row[ix["sprint_count"]] / 3.0), ("days_to_due", max(0.0, -row[ix["days_to_due"]]) / 14.0 if row[ix["has_due"]] else 0.0),
                     ("assignee_open_load", row[ix["assignee_open_load"]] / 12.0)]
            parts = [(n, float(min(v, 1.0))) for n, v in parts if v > 0.15]
            out.append(sorted(parts, key=lambda t: -t[1])[:3])
        return out
