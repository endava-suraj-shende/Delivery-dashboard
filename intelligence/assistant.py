"""Natural-language assistant: a question becomes a *filter + intent*, the AnalyticsEngine computes the answer.

Two parsers, same output contract:
* rule-based (always available, offline) - vocabulary of metrics, periods, people, boards, projects and statuses
  matched against the question text;
* LLM (optional) - asked to produce the same JSON spec; the result is validated against the known dimension values
  before use, so the model cannot invent a person or a board.
Numbers, tables and the narrative are then produced by the engine - the model never generates figures.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from intelligence.llm import LLMProvider
from app.services.analytics_service import AnalyticsEngine
from app.services.filter_service import Filters, preset_range

INTENTS = {
    "overview": ["how are we doing", "status", "overview", "summary", "position", "update", "progress", "health"],
    "blocked": ["blocked", "blocker", "stuck", "impediment"],
    "overdue": ["overdue", "late", "past due", "missed", "behind"],
    "completed": ["completed", "done", "finished", "delivered", "closed", "shipped"],
    "in_progress": ["in progress", "working on", "ongoing", "open", "remaining", "wip"],
    "releases": ["release", "production", "deployed", "deployment", "prod"],
    "velocity": ["velocity", "throughput", "sprint", "per sprint", "story points"],
    "forecast": ["when", "forecast", "finish", "eta", "predict", "will we", "by when", "how long"],
    "risk": ["risk", "at risk", "slip", "likely to miss", "danger", "worry", "concern"],
    "people": ["who", "team", "people", "employee", "workload", "overloaded", "busiest", "top performer", "most"],
    "anomalies": ["anomal", "unusual", "spike", "drop", "changed", "different", "odd", "trend"],
    "recommend": ["recommend", "suggest", "what should", "advice", "next step", "focus", "priorit"],
}
PERIODS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"\b(this|current) week\b"), "current_week"), (re.compile(r"\b(last|previous|past) week\b"), "previous_week"),
    (re.compile(r"\b(this|current) month\b"), "current_month"), (re.compile(r"\b(last|previous) month\b"), "previous_month"),
    (re.compile(r"\b(last|past) (7|seven) days\b"), "last_7_days"), (re.compile(r"\b(last|past) (15|fifteen|two weeks|2 weeks|fortnight)\b"), "last_15_days"),
    (re.compile(r"\b(last|past) (30|thirty) days\b"), "last_30_days"), (re.compile(r"\b(last|past) (60|sixty) days\b"), "last_60_days"),
    (re.compile(r"\b(all time|overall|ever|since the start)\b"), "all"),
]
STATUS_WORDS = {"blocked": "blocked", "completed": "completed", "done": "completed", "in progress": "in_progress", "pending": "pending",
                "on hold": "on_hold", "testing": "testing", "review": "code_review", "analysis": "analysis", "reopened": "reopened"}


class Assistant:
    def __init__(self, engine: AnalyticsEngine, llm: LLMProvider, services: Dict[str, Any]) -> None:
        self.engine = engine
        self.llm = llm
        self.svc = services  # narrative, forecast, risk, anomalies, recommendations

    # ------------------------------------------------------------------ parsing
    def _dimensions(self, base: Filters) -> Dict[str, List[str]]:
        a, _, reps = self.engine.scope(Filters(**{**base.__dict__, "start_date": date(2000, 1, 1), "end_date": date(2100, 1, 1), "sprint": []}))
        if not len(a):
            return {"employees": [], "projects": [], "boards": [], "sprints": []}
        return {"employees": sorted({str(x) for x in a["employee"].dropna()}), "projects": sorted({str(x) for x in a["project"].dropna()}),
                "boards": sorted({str(x) for x in a["jira_board"].dropna()}), "sprints": sorted({str(x) for x in a["sprint"].dropna()}) if "sprint" in a.columns else []}

    @staticmethod
    def _find_names(q: str, options: List[str]) -> List[str]:
        ql = q.lower()
        hits = []
        for o in options:
            ol = o.lower()
            if ol and (ol in ql or (len(ol.split()) > 1 and ol.split()[0] in ql.split() and ol.split()[-1] in ql)):
                hits.append(o)
        # prefer the longest match when names overlap ("Li Na" inside "Mei Ling Na")
        return sorted(set(hits), key=len, reverse=True)[:3]

    def parse_rules(self, q: str, base: Filters, dims: Dict[str, List[str]]) -> Dict[str, Any]:
        ql = q.lower()
        intent = "overview"
        best = 0
        for name, words in INTENTS.items():
            score = sum(1 for w in words if w in ql)
            if score > best:
                intent, best = name, score
        preset = None
        for pat, p in PERIODS:
            if pat.search(ql):
                preset = p
                break
        spec = {"intent": intent, "preset": preset, "employee": self._find_names(q, dims["employees"]),
                "project": self._find_names(q, dims["projects"]), "jira_board": self._find_names(q, dims["boards"]),
                "sprint": self._find_names(q, dims["sprints"]), "status": [v for k, v in STATUS_WORDS.items() if k in ql and intent not in ("blocked", "completed")],
                "parser": "rules"}
        return spec

    def parse_llm(self, q: str, dims: Dict[str, List[str]]) -> Optional[Dict[str, Any]]:
        system = ("You convert a delivery manager's question about Jira delivery data into a JSON filter spec. "
                  "Only use values from the provided lists; never invent names. Output JSON with keys: intent (one of "
                  f"{list(INTENTS)}), preset (one of last_7_days,last_15_days,last_30_days,last_60_days,current_week,previous_week,"
                  "current_month,previous_month,all or null), employee (list), project (list), jira_board (list), sprint (list), status (list of "
                  f"{sorted(set(STATUS_WORDS.values()))}).")
        user = json.dumps({"question": q, "employees": dims["employees"][:200], "projects": dims["projects"][:50], "boards": dims["boards"][:50], "sprints": dims["sprints"][:60]})
        out = self.llm.chat_json(system, user, max_tokens=300)
        if not out or out.get("intent") not in INTENTS:
            return None
        # validate against known values
        def keep(vals: Any, allowed: List[str]) -> List[str]:
            al = {v.lower(): v for v in allowed}
            return [al[str(v).lower()] for v in (vals or []) if str(v).lower() in al][:3]
        return {"intent": out["intent"], "preset": out.get("preset") if out.get("preset") in dict(PERIODS).values() or out.get("preset") in ("all", "last_7_days", "last_15_days", "last_30_days", "last_60_days", "current_week", "previous_week", "current_month", "previous_month") else None,
                "employee": keep(out.get("employee"), dims["employees"]), "project": keep(out.get("project"), dims["projects"]),
                "jira_board": keep(out.get("jira_board"), dims["boards"]), "sprint": keep(out.get("sprint"), dims["sprints"]),
                "status": [s for s in (out.get("status") or []) if s in set(STATUS_WORDS.values())], "parser": "llm"}

    # ------------------------------------------------------------------ answering
    def ask(self, question: str, base: Filters) -> Dict[str, Any]:
        q = (question or "").strip()
        if not q:
            return {"answer": "Ask something like 'what is blocked for Priya this week?' or 'when will Phoenix finish?'", "spec": None}
        dims = self._dimensions(base)
        spec = self.parse_llm(q, dims) if self.llm.enabled else None
        if spec is None:
            spec = self.parse_rules(q, base, dims)
        f = self._filters(spec, base)
        answer, data, links = self._answer(spec["intent"], f, q)
        return {"question": q, "spec": spec, "filters": f.to_dict(), "answer": answer, "data": data, "links": links,
                "grounding": "Figures computed by the analytics engine for the filter shown; the language model (if any) only interpreted the question."}

    def _filters(self, spec: Dict[str, Any], base: Filters) -> Filters:
        kw = dict(base.__dict__)
        if spec.get("preset"):
            if spec["preset"] == "all":
                kw["start_date"], kw["end_date"] = date(2000, 1, 1), date(2100, 1, 1)
            else:
                kw["start_date"], kw["end_date"] = preset_range(spec["preset"])
        for k in ("employee", "project", "jira_board", "sprint", "status"):
            if spec.get(k):
                kw[k] = list(spec[k])
        return self.engine.resolve_filters(Filters(**kw))

    def _answer(self, intent: str, f: Filters, q: str) -> Tuple[str, Dict[str, Any], List[Dict[str, str]]]:
        qs = self._qs(f)
        scope = ", ".join(f.employee) or ", ".join(f.jira_board) or ", ".join(f.project) or "the team"
        if intent == "forecast":
            fc = self.svc["forecast"].forecast(f)
            if fc.get("completion"):
                p85 = next(x for x in fc["completion"]["percentiles"] if x["p"] == 85)
                p50 = next(x for x in fc["completion"]["percentiles"] if x["p"] == 50)
                txt = (f"{scope} has {fc['remaining']} open tickets. At the recent pace ({fc['history']['avg_per_week']}/week) they are likely done by "
                       f"{p50['date']} (50%) and very likely by {p85['date']} (85%). Confidence: {fc['confidence']}.")
            else:
                txt = fc.get("note") or "Not enough history to forecast."
            return txt, {"forecast": fc}, [{"label": "Open the forecast", "url": f"/sprints{qs}"}]
        if intent == "risk":
            r = self.svc["risk"].score(f, limit=10)
            s = r["summary"]
            top = r["items"][:5]
            txt = (f"{s['high']} of {s['open']} open tickets for {scope} are high-risk ({s.get('expected_slips', 0)} expected slips). "
                   + (("Most at risk: " + "; ".join(f"{t['ticket_id']} ({int(t['risk'] * 100)}%, {t['employee'] or 'unassigned'})" for t in top) + ".") if top else ""))
            return txt, {"risk": r}, [{"label": "Open risk view", "url": f"/intelligence{qs}"}]
        if intent == "anomalies":
            an = self.svc["anomalies"].detect(f)
            txt = ("No unusual weekly movement detected." if not an["items"] else
                   f"{len(an['items'])} unusual signal(s): " + " ".join(i["text"] for i in an["items"][:3]))
            return txt, {"anomalies": an}, [{"label": "Open anomalies", "url": f"/intelligence{qs}#anomalies"}]
        if intent == "recommend":
            rc = self.svc["recommendations"].recommend(f)
            txt = ("Nothing to recommend right now." if not rc["items"] else
                   "Suggested focus: " + " ".join(f"({i + 1}) {r['title']}." for i, r in enumerate(rc["items"][:4])))
            return txt, {"recommendations": rc}, [{"label": "Open recommendations", "url": f"/intelligence{qs}#recommendations"}]
        ov = self.engine.overview(f)
        k = ov["kpis"]
        if intent == "blocked":
            t = self.engine.tickets_view(Filters(**{**f.__dict__, "status": ["blocked"]}), compact=True)["items"]
            names = "; ".join(f"{x['ticket_id']} ({x['employee']})" for x in t[:6])
            txt = f"{k['blocked_tickets']} ticket(s) are blocked for {scope} in {f.label()}." + (f" {names}." if names else "")
            return txt, {"tickets": t[:25]}, [{"label": "See blocked tickets", "url": f"/jira{self._qs(Filters(**{**f.__dict__, 'status': ['blocked']}))}"}]
        if intent == "overdue":
            t = [x for x in self.engine.tickets_view(f, compact=True)["items"] if x.get("overdue")]
            txt = f"{len(t)} open ticket(s) are past their due date for {scope}." + (" " + "; ".join(f"{x['ticket_id']} ({x['employee']}, due {str(x.get('due_date'))[:10]})" for x in t[:6]) + "." if t else "")
            return txt, {"tickets": t[:25]}, [{"label": "See tickets", "url": f"/jira{qs}"}]
        if intent == "completed":
            prev = ov.get("previous_kpis")
            delta = f" ({k['completed_tickets'] - prev['completed_tickets']:+d} vs the previous period)" if prev else ""
            txt = f"{k['completed_tickets']} of {k['total_tickets']} tickets completed for {scope} in {f.label()}{delta}; {k['production_released']} production releases deployed."
            return txt, {"kpis": k}, [{"label": "Open overview", "url": f"/{qs}"}]
        if intent == "in_progress":
            txt = f"{k['in_progress_tickets']} in progress, {k['pending_tickets']} pending / on hold and {k['blocked_tickets']} blocked for {scope} ({k.get('remaining_tickets', 0)} remaining in total)."
            return txt, {"kpis": k}, [{"label": "Open tickets", "url": f"/jira{qs}"}]
        if intent == "releases":
            txt = f"{k['production_released']} of {k['production_releases']} production releases are deployed for {scope} in {f.label()}; {k['production_pending']} pending. Dev: {k['dev_deployed']} deployed, {k['dev_pending']} pending."
            return txt, {"kpis": k}, [{"label": "Open releases", "url": f"/deployments/production{qs}"}]
        if intent == "velocity":
            sp = self.engine.sprints_overview(f) if hasattr(self.engine, "sprints_overview") else None
            vel = (sp or {}).get("velocity") if sp else None
            txt = (f"Average velocity {vel['average_completed']} per sprint (last 3: {vel['average_last3']}) across {vel['closed_sprints']} closed sprints."
                   if vel else f"{k['completed_tickets']} tickets completed in {f.label()} for {scope}.")
            return txt, {"velocity": vel}, [{"label": "Open sprints", "url": f"/sprints{qs}"}]
        if intent == "people":
            status = list(getattr(f, "status", None) or [])
            if status and len(status) == 1 and status[0] in ("blocked", "in_progress", "pending", "completed", "on_hold", "reopened"):
                # "who has the most blocked tickets?" -> rank by that status only
                key = status[0]
                ranked = [e for e in sorted(ov["employees"], key=lambda e: -e.get(key, 0)) if e.get(key, 0) > 0]
                label = key.replace("_", " ")
                txt = (f"Most {label} tickets: " + ", ".join(f"{e['employee']} ({e[key]})" for e in ranked[:5]) + ".") if ranked else f"Nobody has {label} tickets in {f.label()} for {scope}."
                return txt, {"employees": ranked[:15]}, [{"label": "Open people", "url": f"/employees{qs}"}]
            emps = sorted(ov["employees"], key=lambda e: -e["completed"])
            load = sorted(ov["employees"], key=lambda e: -(e["in_progress"] + e["pending"] + e["blocked"]))
            txt = (f"Most completed: " + ", ".join(f"{e['employee']} ({e['completed']})" for e in emps[:3]) + ". Heaviest open load: "
                   + ", ".join(f"{e['employee']} ({e['in_progress'] + e['pending'] + e['blocked']})" for e in load[:3]) + ".") if emps else "No people in scope."
            return txt, {"employees": emps[:15]}, [{"label": "Open people", "url": f"/employees{qs}"}]
        n = self.svc["narrative"].summary(f)
        return " ".join(p["text"] for p in n["paragraphs"][:3]), {"narrative": n}, [{"label": "Open overview", "url": f"/{qs}"}]

    @staticmethod
    def _qs(f: Filters) -> str:
        from urllib.parse import urlencode
        params: List[Tuple[str, str]] = []
        if f.start_date:
            params.append(("start_date", f.start_date.isoformat()))
        if f.end_date:
            params.append(("end_date", f.end_date.isoformat()))
        for k in ("employee", "project", "jira_board", "sprint", "status"):
            for v in getattr(f, k) or []:
                params.append((k, v))
        return ("?" + urlencode(params)) if params else ""
