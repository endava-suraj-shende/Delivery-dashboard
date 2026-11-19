"""Delivery performance scoring.

Turns the per-employee delivery metrics produced by ``AnalyticsEngine.employee_table`` into a
0–100 **delivery score** and a **rating band** (Excellent / Good / Needs improvement / At risk).

The score is a weighted blend of four transparent ratios. When a ratio cannot be measured for an
employee (e.g. no ticket has a due date, so on-time delivery is unknown) its weight is redistributed
to the remaining measurable ratios instead of silently counting as zero.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

WEIGHTS: Dict[str, float] = {
    "completion": 0.35,   # completed / unique tickets
    "on_time": 0.25,      # delivered on/before due date / (on time + late + overdue)
    "dev_deployment": 0.15,  # dev deployed / deployment-relevant activity rows
    "flow_health": 0.25,  # 1 - (blocked + overdue tickets) / unique tickets
}

BANDS: List[Dict[str, Any]] = [
    {"key": "excellent", "label": "Excellent", "min": 80, "color": "green", "order": 1},
    {"key": "good", "label": "Good", "min": 60, "color": "blue", "order": 2},
    {"key": "needs_improvement", "label": "Needs improvement", "min": 40, "color": "orange", "order": 3},
    {"key": "at_risk", "label": "At risk", "min": 0, "color": "red", "order": 4},
]
BAND_BY_KEY = {b["key"]: b for b in BANDS}
NO_ACTIVITY = {"key": "no_activity", "label": "No activity", "min": None, "color": "grey", "order": 5}

AT_RISK_BLOCKED_SHARE = 0.40   # >= 40 % of tickets blocked -> At risk regardless of score
AT_RISK_OVERDUE = 3            # >= 3 overdue open tickets AND >= half of all tickets overdue -> At risk regardless of score
AT_RISK_OVERDUE_SHARE = 0.50
LOW_SAMPLE_TICKETS = 3         # ratings on fewer tickets are flagged as low confidence

PERFORMANCE_RULES = [
    "Delivery score (0–100) = 35 % task completion (completed ÷ unique tickets) + 25 % on-time delivery "
    "(delivered on/before due date ÷ tickets with a due date that are done or overdue) + 15 % dev deployment "
    "(dev deployed ÷ deployment-relevant rows) + 25 % flow health (1 − (blocked + overdue) ÷ unique tickets).",
    "A due date is the Jira due date; when none is set the end of the sprint the work belongs to is used. "
    "Excel workbooks carry no due dates, so on-time delivery is 'not measured' there and its weight moves to the other ratios.",
    "Ratios that cannot be measured for an employee (no tickets with due dates, no deployment-relevant rows) have their "
    "weight redistributed to the measurable ratios — they never count as zero.",
    "Rating bands: Excellent ≥ 80, Good ≥ 60, Needs improvement ≥ 40, At risk < 40. "
    f"An employee is At risk regardless of score when ≥ {int(AT_RISK_BLOCKED_SHARE * 100)} % of their tickets are blocked, "
    f"or when ≥ {AT_RISK_OVERDUE} open tickets (and at least half of all their tickets) are overdue.",
    f"Ratings based on fewer than {LOW_SAMPLE_TICKETS} tickets are marked 'low sample' — treat them as indicative only.",
    "Employees with no activity in the period are shown separately as 'No activity' and are not rated.",
    "The team delivery status is the ticket-weighted average of the individual scores, using the same bands.",
    "Scores describe reported delivery flow, not individual productivity; use them to start a conversation, not to end one.",
]


UNRATED_EMPLOYEES = {"unassigned", "unknown", ""}


def _ratio(num: float, den: float) -> Optional[float]:
    return (num / den) if den else None


def band_for(score: Optional[float], *, blocked_share: float = 0.0, overdue: int = 0, overdue_share: float = 0.0) -> Dict[str, Any]:
    if score is None:
        return NO_ACTIVITY
    if blocked_share >= AT_RISK_BLOCKED_SHARE or (overdue >= AT_RISK_OVERDUE and overdue_share >= AT_RISK_OVERDUE_SHARE):
        return BAND_BY_KEY["at_risk"]
    for b in BANDS:
        if score >= b["min"]:
            return b
    return BAND_BY_KEY["at_risk"]


def score_metrics(row: Dict[str, Any]) -> Dict[str, Any]:
    """Compute ratios, score and rating for one employee row (keys from ``employee_table``)."""
    if str(row.get("employee") or "").strip().lower() in UNRATED_EMPLOYEES:
        return {"score": None, "rating": "unrated", "rating_label": "Not rated", "rating_color": "grey", "low_confidence": False,
                "completion_pct": None, "on_time_pct": None, "dev_deployment_pct": None, "prod_deployment_pct": None,
                "flow_health_pct": None, "weights_used": {}, "risk_flags": []}
    tickets = int(row.get("unique_tickets") or 0)
    completed = int(row.get("completed") or 0)
    blocked = int(row.get("blocked") or 0)
    overdue = int(row.get("overdue") or 0)
    on_time, late = int(row.get("on_time") or 0), int(row.get("late") or 0)
    dev_deployed, dev_pending = int(row.get("dev_deployed") or 0), int(row.get("dev_pending") or 0)
    prod_rel, prod_done = int(row.get("production_releases") or 0), int(row.get("production_released") or 0)

    ratios: Dict[str, Optional[float]] = {
        "completion": _ratio(completed, tickets),
        "on_time": _ratio(on_time, on_time + late + overdue),
        "dev_deployment": _ratio(dev_deployed, dev_deployed + dev_pending),
        "flow_health": (max(0.0, 1.0 - (blocked + overdue) / tickets) if tickets else None),
    }
    measurable = {k: w for k, w in WEIGHTS.items() if ratios[k] is not None}
    score: Optional[float] = None
    if measurable and tickets:
        total_w = sum(measurable.values())
        score = round(100.0 * sum(ratios[k] * w for k, w in measurable.items()) / total_w, 1)
    blocked_share = (blocked / tickets) if tickets else 0.0
    overdue_share = (overdue / tickets) if tickets else 0.0
    band = band_for(score, blocked_share=blocked_share, overdue=overdue, overdue_share=overdue_share)
    pct = lambda v: (round(100.0 * v, 1) if v is not None else None)  # noqa: E731
    overdue_hit = overdue >= AT_RISK_OVERDUE and overdue_share >= AT_RISK_OVERDUE_SHARE
    return {
        "score": score,
        "rating": band["key"], "rating_label": band["label"], "rating_color": band["color"],
        "low_confidence": bool(tickets and tickets < LOW_SAMPLE_TICKETS),
        "completion_pct": pct(ratios["completion"]),
        "on_time_pct": pct(ratios["on_time"]),
        "dev_deployment_pct": pct(ratios["dev_deployment"]),
        "prod_deployment_pct": pct(_ratio(prod_done, prod_rel)),
        "flow_health_pct": pct(ratios["flow_health"]),
        "weights_used": {k: round(w / sum(measurable.values()), 3) for k, w in measurable.items()} if measurable else {},
        "risk_flags": [f for f, hit in (("blocked_share", blocked_share >= AT_RISK_BLOCKED_SHARE), ("overdue", overdue_hit)) if hit],
    }


def team_summary(rows: Sequence[Dict[str, Any]], inactive: Sequence[str] = ()) -> Dict[str, Any]:
    """Ticket-weighted team score, its band and the rating distribution."""
    rated = [r for r in rows if r.get("score") is not None]
    weight = sum(int(r.get("unique_tickets") or 0) for r in rated)
    if rated and weight:
        team_score = round(sum(r["score"] * int(r.get("unique_tickets") or 0) for r in rated) / weight, 1)
    elif rated:
        team_score = round(sum(r["score"] for r in rated) / len(rated), 1)
    else:
        team_score = None
    tickets = sum(int(r.get("unique_tickets") or 0) for r in rows)
    blocked = sum(int(r.get("blocked") or 0) for r in rows)
    overdue = sum(int(r.get("overdue") or 0) for r in rows)
    band = band_for(team_score, blocked_share=(blocked / tickets) if tickets else 0.0, overdue=overdue,
                    overdue_share=(overdue / tickets) if tickets else 0.0)
    counts = {b["key"]: 0 for b in BANDS}
    for r in rated:
        counts[r["rating"]] = counts.get(r["rating"], 0) + 1
    distribution = [{"key": b["key"], "label": b["label"], "color": b["color"], "value": counts[b["key"]]} for b in BANDS]
    if inactive:
        distribution.append({"key": NO_ACTIVITY["key"], "label": NO_ACTIVITY["label"], "color": NO_ACTIVITY["color"], "value": len(inactive)})
    on_time = sum(int(r.get("on_time") or 0) for r in rows)
    late = sum(int(r.get("late") or 0) for r in rows)
    dev_dep = sum(int(r.get("dev_deployed") or 0) for r in rows)
    dev_pen = sum(int(r.get("dev_pending") or 0) for r in rows)
    prod_rel = sum(int(r.get("production_releases") or 0) for r in rows)
    prod_done = sum(int(r.get("production_released") or 0) for r in rows)
    completed = sum(int(r.get("completed") or 0) for r in rows)
    pct = lambda n, d: (round(100.0 * n / d, 1) if d else None)  # noqa: E731
    return {
        "score": team_score, "rating": band["key"], "rating_label": band["label"], "rating_color": band["color"],
        "rated_employees": len(rated), "inactive_employees": len(inactive),
        "tickets": tickets, "completed": completed, "blocked": blocked, "overdue": overdue,
        "on_time": on_time, "late": late,
        "completion_pct": pct(completed, tickets), "on_time_pct": pct(on_time, on_time + late + overdue),
        "dev_deployment_pct": pct(dev_dep, dev_dep + dev_pen), "prod_deployment_pct": pct(prod_done, prod_rel),
        "distribution": distribution,
        "at_risk": [r["employee"] for r in rated if r["rating"] == "at_risk"],
        "needs_improvement": [r["employee"] for r in rated if r["rating"] == "needs_improvement"],
        "excellent": [r["employee"] for r in rated if r["rating"] == "excellent"],
    }


def metric_rows(cur: Dict[str, Any], prev: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Side-by-side metric table for one employee (current vs previous period)."""
    def pick(src: Optional[Dict[str, Any]], key: str) -> Any:
        return None if src is None else src.get(key)

    defs = [
        ("unique_tickets", "Assigned tickets", "count", "unique tickets the person worked on in the period"),
        ("completed", "Completed", "count", "latest status Completed / Deployed"),
        ("development_tickets", "In development", "count", "latest status In Progress / In Dev"),
        ("code_review", "Code review", "count", "latest status Code Review"),
        ("testing_tickets", "Testing / QA", "count", "latest status In QA / Testing / Ready for QA"),
        ("ready_for_deployment", "Ready for deployment", "count", "latest status Ready for Deployment / Stage"),
        ("in_progress", "In progress (total)", "count", "development + code review + testing + ready"),
        ("backlog", "Backlog / pending", "count", "latest status Backlog / To Do / Pending"),
        ("on_hold", "On hold", "count", "latest status On Hold"),
        ("blocked", "Blocked", "count", "latest status Blocked"),
        ("on_time", "Delivered on time", "count", "completed on/before the due date (Jira due date or sprint end)"),
        ("overdue", "Overdue (open)", "count", "open tickets past their due date"),
        ("dev_deployed", "Dev deployments", "count", "activity rows deployed to dev / QA / stage"),
        ("production_releases", "Production releases", "count", "production release records"),
        ("production_released", "Deployed to production", "count", "release records with status Released"),
        ("total_activities", "Activities", "count", "status transitions / work rows recorded"),
    ]
    out = []
    for key, label, kind, hint in defs:
        c, p = pick(cur, key), pick(prev, key)
        delta = (round(c - p, 1) if isinstance(c, (int, float)) and isinstance(p, (int, float)) else None)
        out.append({"key": key, "label": label, "kind": kind, "hint": hint, "current": c, "previous": p, "delta": delta})
    return out
