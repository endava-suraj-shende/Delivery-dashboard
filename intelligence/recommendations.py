"""Decision support: turns risk + load into concrete, reviewable suggestions.

Each recommendation names the action, the evidence behind it and the expected effect, so a delivery manager can
accept or discard it in a stand-up. Nothing is applied automatically.
"""
from __future__ import annotations

from statistics import mean
from typing import Any, Dict, List

from intelligence.risk import RiskService
from app.services.analytics_service import AnalyticsEngine
from app.services.filter_service import Filters



def _n(count: int, noun: str) -> str:
    """'1 ticket' / '3 tickets'."""
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"

class RecommendationService:
    def __init__(self, engine: AnalyticsEngine, risk: RiskService) -> None:
        self.engine = engine
        self.risk = risk

    def recommend(self, f: Filters) -> Dict[str, Any]:
        f = self.engine.resolve_filters(f)
        return self.engine._cached(f"recommend:{f.cache_key()}:{self.risk._trained_version}", lambda: self._recommend(f))

    def _recommend(self, f: Filters) -> Dict[str, Any]:
        risk = self.risk.score(f, limit=500)
        items = risk["items"]
        ov = self.engine.overview(f)
        employees = ov["employees"]
        recs: List[Dict[str, Any]] = []

        # 1. Focus list: highest-risk open tickets (what to talk about first in stand-up)
        top = [t for t in items if t["band"] == "high"][:5]
        if top:
            recs.append({"kind": "focus", "priority": 1, "title": f"Review the {len(top)} highest-risk tickets first",
                         "detail": "; ".join(f"{t['ticket_id']} ({t['employee'] or 'unassigned'}, {int(t['risk'] * 100)}%)" for t in top),
                         "evidence": [f"{t['ticket_id']}: " + ", ".join(fx['factor'] + f" {fx['value']}" for fx in t['factors'][:2]) for t in top],
                         "effect": f"these tickets carry {sum(t['risk'] for t in top):.1f} expected slips between them",
                         "tickets": [t["ticket_id"] for t in top]})

        # 2. Unblock: tickets blocked longest
        blocked = sorted([t for t in items if t["days_blocked"] > 0], key=lambda t: -t["days_blocked"])[:5]
        if blocked:
            recs.append({"kind": "unblock", "priority": 1, "title": f"Escalate {_n(len(blocked), 'long-blocked ticket')}",
                         "detail": "; ".join(f"{t['ticket_id']} blocked {t['days_blocked']} days" for t in blocked),
                         "evidence": [f"{t['ticket_id']} - {t['employee'] or 'unassigned'}" for t in blocked],
                         "effect": "blocked age is the strongest slip predictor in this data" if self.risk.model.trained else "blocked time dominates the heuristic score",
                         "tickets": [t["ticket_id"] for t in blocked]})

        # 3. Rebalance: move low-progress open tickets from overloaded to lighter team-mates on the same board
        # (unassigned work is handled by the hygiene recommendation, not as a "person" to rebalance from)
        loads = {e["employee"]: e["in_progress"] + e["pending"] + e["blocked"] for e in employees
                 if e.get("employee") and str(e["employee"]).strip().lower() not in ("unassigned", "unknown", "")}
        if len(loads) >= 3:
            avg = mean(loads.values())
            heavy = [e for e, l in loads.items() if l >= max(4, 1.6 * avg)]
            light = sorted([e for e, l in loads.items() if l <= max(1, 0.6 * avg)], key=lambda e: loads[e])
            for h in heavy[:3]:
                cand = [t for t in items if t["employee"] == h and t["band"] != "low"]
                movable = [t for t in cand if t["work_status"] in ("pending", "on_hold", "analysis") or t["age_days"] <= 3][:3]
                if movable and light:
                    recs.append({"kind": "rebalance", "priority": 2, "title": f"Rebalance work from {h} ({loads[h]} open) to {light[0]} ({loads[light[0]]} open)",
                                 "detail": "Candidates not yet in active development: " + ", ".join(t["ticket_id"] for t in movable),
                                 "evidence": [f"team average open load {avg:.1f}", f"{h} at {loads[h]}", f"{light[0]} at {loads[light[0]]}"],
                                 "effect": f"brings {h} to ~{loads[h] - len(movable)} open items", "tickets": [t["ticket_id"] for t in movable]})

        # 4. Due dates at risk this week
        soon = [t for t in items if t["due_date"] and not t["overdue"] and t["band"] in ("high", "medium")]
        soon = sorted(soon, key=lambda t: t["due_date"])[:5]
        if soon:
            recs.append({"kind": "due", "priority": 2, "title": f"{_n(len(soon), 'ticket')} due within days {'is' if len(soon) == 1 else 'are'} at risk",
                         "detail": "; ".join(f"{t['ticket_id']} due {t['due_date']} ({int(t['risk'] * 100)}%)" for t in soon),
                         "evidence": [], "effect": "re-plan or communicate before the date passes", "tickets": [t["ticket_id"] for t in soon]})

        # 5. Hygiene: unassigned open work
        unassigned = [t for t in items if not t["employee"] or t["employee"] == "Unassigned"]
        if unassigned:
            recs.append({"kind": "hygiene", "priority": 3, "title": f"Assign {_n(len(unassigned), 'unassigned open ticket')}",
                         "detail": ", ".join(t["ticket_id"] for t in unassigned[:8]) + (" ..." if len(unassigned) > 8 else ""),
                         "evidence": [], "effect": "unassigned work never shows in anyone's plan", "tickets": [t["ticket_id"] for t in unassigned[:20]]})

        recs.sort(key=lambda r: r["priority"])
        return {"items": recs, "risk_summary": risk["summary"], "model": risk["model"]}
