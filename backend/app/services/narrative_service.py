"""Rule-based narrative summaries and anomaly flags built on the AnalyticsEngine facts.

No ML, no external calls: every sentence is derived from numbers the dashboards already show, so the text can be
pasted into a client update without fact-checking. An LLM "polish" step can be layered on later using the same
`facts` payload returned next to the paragraphs.
"""
from __future__ import annotations

from datetime import date, datetime
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional

import pandas as pd

from app.services.analytics_service import AnalyticsEngine
from app.services.filter_service import Filters

BLOCKED_AGE_DAYS = 5
STALE_DAYS = 14
CARRY_OVER_WARN = 0.40
OVERLOAD_FACTOR = 1.6


def _pct(num: float, den: float) -> Optional[int]:
    return int(round(100.0 * num / den)) if den else None


def _fmt_delta(cur: int, prev: Optional[int]) -> str:
    if prev is None:
        return ""
    d = cur - prev
    if d == 0:
        return " (unchanged)"
    return f" ({'+' if d > 0 else ''}{d} vs previous period)"


def _join(names: List[str], limit: int = 3) -> str:
    names = [n for n in names if n]
    if len(names) <= limit:
        return ", ".join(names)
    return ", ".join(names[:limit]) + f" and {len(names) - limit} more"


class NarrativeService:
    def __init__(self, engine: AnalyticsEngine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------ public
    def summary(self, f: Filters, *, employee: Optional[str] = None) -> Dict[str, Any]:
        f = self.engine.resolve_filters(f)
        key = f"narrative:{employee or '*'}:{f.cache_key()}"
        return self.engine._cached(key, lambda: self._build(f, employee))

    # ------------------------------------------------------------------ build
    def _build(self, f: Filters, employee: Optional[str]) -> Dict[str, Any]:
        ov = self.engine.overview(f)
        k, prev = ov["kpis"], ov.get("previous_kpis")
        a, r, _ = self.engine.scope(f)
        tickets = self.engine.ticket_table(a, r) if len(a) else pd.DataFrame()
        employees = ov["employees"]
        scope_label = employee or (", ".join(f.jira_board) if f.jira_board else ", ".join(f.project) if f.project else "the team")
        if employee:
            employees = [e for e in employees if e["employee"] == employee]
            if len(tickets):
                tickets = tickets[tickets["employee"] == employee] if "employee" in tickets.columns else tickets
        flags = self._anomalies(tickets, employees, ov["employees"], k, prev, f)
        paragraphs = self._paragraphs(scope_label, k, prev, employees, tickets, flags, f, employee)
        return {
            "period": ov["period"],
            "scope": scope_label,
            "headline": paragraphs[0]["text"] if paragraphs else "",
            "paragraphs": paragraphs,
            "flags": flags,
            "facts": {
                "completed": k["completed_tickets"], "completed_prev": prev["completed_tickets"] if prev else None,
                "in_progress": k.get("in_progress_tickets"), "blocked": k["blocked_tickets"],
                "blocked_prev": prev["blocked_tickets"] if prev else None, "pending": k["pending_tickets"],
                "total": k["total_tickets"], "releases": k["production_releases"], "released": k["production_released"],
                "people": k.get("active_employees"), "carry_over_pct": self._carry_pct(employees),
            },
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }

    @staticmethod
    def _carry_pct(employees: List[Dict[str, Any]]) -> Optional[int]:
        total = sum(e.get("unique_tickets", 0) for e in employees)
        carried = sum(e.get("carried_in", 0) for e in employees)
        return _pct(carried, total)

    def _paragraphs(self, scope: str, k: Dict[str, Any], prev: Optional[Dict[str, Any]], employees: List[Dict[str, Any]],
                    tickets: pd.DataFrame, flags: List[Dict[str, Any]], f: Filters, employee: Optional[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        total, done = k["total_tickets"], k["completed_tickets"]
        if not total:
            out.append({"kind": "headline", "text": f"No ticket activity was recorded for {scope} between {f.label()}."})
            return out
        pct = _pct(done, total)
        tone = "is on track" if (pct or 0) >= 60 and k["blocked_tickets"] <= max(1, total * 0.05) else \
               "needs attention" if k["blocked_tickets"] > total * 0.1 or (pct or 0) < 35 else "is progressing"
        out.append({"kind": "headline", "text":
                    f"{scope[0].upper() + scope[1:]} {tone}: {done} of {total} tickets completed ({pct}%){_fmt_delta(done, prev['completed_tickets'] if prev else None)} "
                    f"between {f.label()}."})
        # delivery
        parts = [f"{k.get('in_progress_tickets', 0)} tickets are in progress and {k['pending_tickets']} are pending or on hold"]
        if k["blocked_tickets"]:
            parts.append(f"{k['blocked_tickets']} are blocked{_fmt_delta(k['blocked_tickets'], prev['blocked_tickets'] if prev else None)}")
        carry = self._carry_pct(employees)
        if carry is not None and not employee:
            parts.append(f"{carry}% of the work was carried over from before the period")
        out.append({"kind": "delivery", "text": "; ".join(parts) + "."})
        # releases
        if k["production_releases"]:
            out.append({"kind": "releases", "text":
                        f"{k['production_released']} of {k['production_releases']} production releases are deployed"
                        f"{'; ' + str(k['production_pending']) + ' pending' if k['production_pending'] else ''}"
                        f"{'; ' + str(k.get('production_blocked', 0)) + ' blocked or failed' if k.get('production_blocked') else ''}."})
        # people
        if not employee and employees:
            top = sorted(employees, key=lambda e: -e["completed"])[:3]
            top_txt = _join([f"{e['employee']} ({e['completed']})" for e in top if e["completed"]])
            if top_txt:
                out.append({"kind": "people", "text": f"Most completed: {top_txt}."})
            team_pct = [e["completed_pct"] for e in employees if e.get("completed_pct") is not None and e.get("unique_tickets", 0) >= 3]
            if len(team_pct) >= 3:
                avg = mean(team_pct)
                low = [e for e in employees if e.get("completed_pct") is not None and e.get("unique_tickets", 0) >= 3 and e["completed_pct"] < avg - 25]
                if low:
                    low_txt = _join(["{} ({}%)".format(e["employee"], int(e["completed_pct"])) for e in low])
                    out.append({"kind": "people", "text": f"Below the team completion average of {int(avg)}%: {low_txt}."})
        elif employee and employees:
            e = employees[0]
            bits = [f"{e['completed']} of {e['unique_tickets']} tickets completed"]
            if e.get("team_avg_cycle_days") and e.get("avg_cycle_days"):
                faster = e["avg_cycle_days"] <= e["team_avg_cycle_days"]
                bits.append(f"average {e['avg_cycle_days']} days to complete ({'faster' if faster else 'slower'} than the team average of {e['team_avg_cycle_days']})")
            if e.get("carried_in"):
                bits.append(f"{e['carried_in']} carried over, {e['new_in_period']} new")
            if e.get("overdue"):
                bits.append(f"{e['overdue']} overdue")
            out.append({"kind": "people", "text": "; ".join(bits) + "."})
        # risks from flags
        risk = [fl for fl in flags if fl["severity"] in ("danger", "warning")]
        if risk:
            out.append({"kind": "risks", "text": "Watch: " + " ".join(fl["text"] for fl in risk[:4])})
        # next steps
        steps: List[str] = []
        if k["blocked_tickets"]:
            steps.append("unblock the longest-blocked tickets")
        if k.get("production_pending"):
            steps.append("confirm dates for pending production releases")
        if k.get("other_status_tickets"):
            steps.append("map the unmapped Jira statuses so they are counted")
        if any(fl["code"] == "overloaded" for fl in flags):
            steps.append("rebalance work from overloaded team members")
        if steps:
            out.append({"kind": "next", "text": "Suggested focus: " + "; ".join(steps) + "."})
        return out

    # ------------------------------------------------------------------ anomalies
    def _anomalies(self, tickets: pd.DataFrame, employees: List[Dict[str, Any]], team: List[Dict[str, Any]],
                   k: Dict[str, Any], prev: Optional[Dict[str, Any]], f: Filters) -> List[Dict[str, Any]]:
        flags: List[Dict[str, Any]] = []
        today = pd.Timestamp(f.end_date or date.today())

        def add(code: str, severity: str, text: str, value: Any = None, link: Optional[Dict[str, str]] = None, data: Optional[Dict[str, Any]] = None) -> None:
            flags.append({"code": code, "severity": severity, "text": text, "value": value, "link": link, "data": data or {}})

        if len(tickets):
            t = tickets
            blocked = t[t["work_status"] == "blocked"] if "work_status" in t.columns else t.iloc[0:0]
            if len(blocked) and "blocked_since" in blocked.columns:
                since = pd.to_datetime(blocked["blocked_since"], errors="coerce")
                age = (today - since).dt.days
                old = blocked[age >= BLOCKED_AGE_DAYS]
                if len(old):
                    worst = old.assign(age=age[age >= BLOCKED_AGE_DAYS]).sort_values("age", ascending=False).iloc[0]
                    add("blocked_age", "danger",
                        f"{len(old)} ticket(s) blocked for {BLOCKED_AGE_DAYS}+ days, longest {worst['ticket_id']} ({int(worst['age'])} days, {worst.get('employee') or 'unassigned'}).",
                        int(len(old)), {"type": "ticket", "value": str(worst["ticket_id"])},
                        {"count": int(len(old)), "ticket": str(worst["ticket_id"]), "days": int(worst["age"]), "employee": worst.get("employee") or None, "threshold": BLOCKED_AGE_DAYS})
            remaining = t[t.get("is_remaining", pd.Series(False, index=t.index)) == True] if "is_remaining" in t.columns else t.iloc[0:0]  # noqa: E712
            if len(remaining) and "last_seen" in remaining.columns:
                last = pd.to_datetime(remaining["last_seen"], errors="coerce")
                stale = remaining[(today - last).dt.days >= STALE_DAYS]
                if len(stale):
                    add("stale", "warning", f"{len(stale)} open ticket(s) have not changed in {STALE_DAYS}+ days ({_join(list(stale['ticket_id'].astype(str)), 3)}).",
                        int(len(stale)), None, {"count": int(len(stale)), "tickets": list(stale["ticket_id"].astype(str))[:8], "threshold": STALE_DAYS})
            if "overdue" in t.columns:
                overdue = t[t["overdue"] == True]  # noqa: E712
                if len(overdue):
                    add("overdue", "warning", f"{len(overdue)} ticket(s) are past their due date.", int(len(overdue)), None,
                        {"count": int(len(overdue)), "tickets": list(overdue.sort_values("due_date")["ticket_id"].astype(str))[:8] if "due_date" in overdue.columns else []})
        # carry-over
        carry = self._carry_pct(employees)
        if carry is not None and carry >= int(CARRY_OVER_WARN * 100) and sum(e.get("unique_tickets", 0) for e in employees) >= 10:
            add("carry_over", "warning", f"{carry}% of tickets were carried over from before the period - scope is rolling rather than closing.", carry, None, {"pct": carry})
        # workload distribution (team-level only)
        if len(team) >= 4:
            loads = [e["in_progress"] + e["pending"] + e["blocked"] for e in team]
            avg = mean(loads)
            sd = pstdev(loads)
            for e in team:
                load = e["in_progress"] + e["pending"] + e["blocked"]
                if avg >= 3 and load >= OVERLOAD_FACTOR * avg and (sd == 0 or (load - avg) / sd >= 1.5):
                    add("overloaded", "warning", f"{e['employee']} carries {load} open tickets vs a team average of {avg:.0f}.",
                        load, {"type": "employee", "value": e["employee"]}, {"employee": e["employee"], "load": int(load), "average": round(avg, 1)})
            # throughput drop vs own completion share
            shares = [e["completed_pct"] for e in team if e.get("completed_pct") is not None and e.get("unique_tickets", 0) >= 5]
            if len(shares) >= 4:
                avg_s, sd_s = mean(shares), pstdev(shares)
                for e in team:
                    if e.get("completed_pct") is not None and e.get("unique_tickets", 0) >= 5 and sd_s > 0 and (avg_s - e["completed_pct"]) / sd_s >= 1.5:
                        add("low_completion", "info", f"{e['employee']} completed {int(e['completed_pct'])}% of their tickets vs a team average of {avg_s:.0f}%.",
                            e["completed_pct"], {"type": "employee", "value": e["employee"]}, {"employee": e["employee"], "pct": int(e["completed_pct"]), "average": round(avg_s, 1)})
        # period deltas
        if prev:
            if prev["completed_tickets"] >= 5 and k["completed_tickets"] <= prev["completed_tickets"] * 0.6:
                add("throughput_drop", "warning",
                    f"Completed tickets fell from {prev['completed_tickets']} to {k['completed_tickets']} compared with the previous period.",
                    k["completed_tickets"] - prev["completed_tickets"], None, {"previous": prev["completed_tickets"], "current": k["completed_tickets"]})
            if k["blocked_tickets"] >= prev["blocked_tickets"] + 3:
                add("blocked_rising", "danger", f"Blocked tickets rose from {prev['blocked_tickets']} to {k['blocked_tickets']}.",
                    k["blocked_tickets"] - prev["blocked_tickets"], None, {"previous": prev["blocked_tickets"], "current": k["blocked_tickets"]})
        if k.get("other_status_tickets"):
            add("unmapped", "info", f"{k['other_status_tickets']} ticket(s) have a Jira status that is not mapped yet.", k["other_status_tickets"],
                {"type": "config", "value": "status"}, {"count": k["other_status_tickets"]})
        order = {"danger": 0, "warning": 1, "info": 2}
        flags.sort(key=lambda x: order.get(x["severity"], 9))
        return flags
