"""Synthetic demo workspace for Guest users.

Guests never see real data. A deterministic generator emulates two Jira boards (scrum + kanban) behind an
httpx mock transport, and the ordinary pipeline (JiraDataSource -> InMemoryDataStore -> AnalyticsEngine) builds the
dashboards from it, so every screen behaves exactly like production - with invented people and tickets.
"""
from __future__ import annotations

import json
import random
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import Settings
from app.core.logging import get_logger
from app.events.event_bus import EventBus
from app.processors.status_normalizer import StatusNormalizer
from app.services.analytics_service import AnalyticsEngine
from app.services.data_source_service import DataSourceService
from app.services.data_store import InMemoryDataStore
from app.services.excel_service import ExcelService
from app.services.jira_board_registry import BoardConfig, JiraBoardRegistry
from app.services.jira_client import JiraClientPool, JiraSiteClient
from app.services.jira_data_source import JiraDataSource
from app.services.jira_reconcile_service import JiraReconcileService
from app.services.report_service import ReportService

log = get_logger("demo")

SITE = "https://demo.atlassian.net"
PEOPLE = ["Aarav Mehta", "Priya Nair", "Rohan Iyer", "Sneha Kulkarni", "Vikram Rao", "Ananya Desai", "Karan Shah",
          "Meera Pillai", "Arjun Verma", "Isha Bhatt", "Nikhil Joshi", "Divya Menon", "Sameer Khan", "Tanvi Reddy"]
TEAMS = {"Phoenix": PEOPLE[:8], "Atlas": PEOPLE[8:]}
APPS = {"Phoenix": ["Customer Portal", "Billing API", "Mobile App"], "Atlas": ["Data Platform", "Reporting Service"]}
ISSUE_TYPES = [("Story", 55), ("Bug", 25), ("Task", 15), ("Spike", 5)]
# status pipeline (names map to the default normalizer categories)
FLOW = ["To Do", "In Progress", "In Review", "In Testing", "Ready for Deployment", "Deployed to Dev", "Done", "In Production"]
SUMMARIES = ["Add export to CSV", "Fix login timeout", "Improve dashboard load time", "Migrate payments webhook",
             "Update onboarding flow", "Refactor notification service", "Resolve duplicate invoices", "Add audit trail",
             "Optimise search index", "Upgrade dependency versions", "Implement role filters", "Fix date parsing bug",
             "Add retry to sync job", "Redesign settings page", "Improve error messages", "Support bulk upload",
             "Add sprint velocity chart", "Fix timezone offset", "Enable dark mode", "Automate release notes"]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


class DemoJira:
    """Generates and serves a consistent fake Jira site."""

    def __init__(self, today: Optional[date] = None, seed: int = 42) -> None:
        self.today = today or date.today()
        self.rng = random.Random(seed)
        self.boards = {
            921: {"id": 921, "name": "Phoenix Scrum Board", "type": "scrum", "location": {"projectKey": "PHX", "projectName": "Phoenix"}},
            922: {"id": 922, "name": "Atlas Kanban", "type": "kanban", "location": {"projectKey": "ATL", "projectName": "Atlas"}},
        }
        self.sprints = self._make_sprints()
        self.issues: Dict[str, Dict[str, Any]] = {}
        self._make_issues("PHX", "Phoenix", 921, 320)
        self._make_issues("ATL", "Atlas", 922, 140)

    # ------------------------------------------------------------------ generation
    def _make_sprints(self) -> List[Dict[str, Any]]:
        out = []
        # 9 two-week sprints, the last one active (started a few days ago)
        start = datetime.combine(self.today, datetime.min.time()) - timedelta(days=4 + 14 * 8)
        for i in range(9):
            s = start + timedelta(days=14 * i)
            e = s + timedelta(days=13, hours=17)
            state = "active" if i == 8 else "closed"
            sp = {"id": 100 + i, "name": f"PHX Sprint {31 + i}", "state": state, "startDate": _iso(s), "endDate": _iso(e), "originBoardId": 921,
                  "goal": f"Increment {31 + i}"}
            if state == "closed":
                sp["completeDate"] = _iso(e + timedelta(minutes=30))
            out.append(sp)
        return out

    def _sprint_for(self, dt: datetime) -> Optional[Dict[str, Any]]:
        for sp in self.sprints:
            if sp["startDate"] <= _iso(dt) <= sp["endDate"]:
                return sp
        return None

    def _make_issues(self, key: str, team: str, board_id: int, count: int) -> None:
        rng = self.rng
        people = TEAMS[team]
        apps = APPS[team]
        now = datetime.combine(self.today, datetime.min.time()) + timedelta(hours=18)
        for n in range(1, count + 1):
            created = now - timedelta(days=rng.randint(3, 170), hours=rng.randint(0, 9))
            itype = rng.choices([t for t, _ in ISSUE_TYPES], [w for _, w in ISSUE_TYPES])[0]
            # how far along the pipeline this ticket got: older tickets are more likely finished
            age = (now - created).days
            depth_cap = len(FLOW) if age > 25 else (5 if age > 10 else 3)
            depth = rng.randint(1, depth_cap)
            if rng.random() < 0.04:
                final = "Blocked"
            elif rng.random() < 0.03:
                final = "On Hold"
            else:
                final = FLOW[depth - 1]
            history, t = [], created
            prev = FLOW[0]
            for st in FLOW[1:depth]:
                t = t + timedelta(days=rng.randint(1, 4), hours=rng.randint(1, 8))
                if t > now:
                    break
                history.append((_iso(t), prev, st))
                prev = st
            if final in ("Blocked", "On Hold") and history:
                t = t + timedelta(days=1)
                history.append((_iso(t), prev, final))
            elif final in ("Blocked", "On Hold"):
                history.append((_iso(created + timedelta(days=1)), prev, final))
            updated = datetime.strptime(history[-1][0][:19], "%Y-%m-%dT%H:%M:%S") if history else created
            resolved = updated if final in ("Done", "In Production") else None
            sprints = []
            if board_id == 921:
                sp = self._sprint_for(created + timedelta(days=1))
                if sp:
                    sprints.append(sp)
                    if resolved is None and sp["state"] == "closed" and rng.random() < 0.35:
                        nxt = next((s for s in self.sprints if s["id"] == sp["id"] + 1), None)
                        if nxt:
                            sprints.append(nxt)  # carried over
            assignee = rng.choice(people) if rng.random() > 0.03 else None
            fix = [{"name": f"Release {2 + n % 3}.{n % 7}", "released": final == "In Production", "releaseDate": (updated.date().isoformat() if final == "In Production" else None)}] if rng.random() < 0.3 else []
            self.issues[f"{key}-{n}"] = {
                "key": f"{key}-{n}",
                "fields": {
                    "summary": f"{rng.choice(SUMMARIES)} ({key}-{n})",
                    "status": {"name": final, "statusCategory": {"key": "done" if resolved else ("new" if final == "To Do" else "indeterminate")}},
                    "assignee": {"accountId": f"u-{people.index(assignee)}-{team}", "displayName": assignee, "emailAddress": assignee.lower().replace(" ", ".") + "@example.com"} if assignee else None,
                    "reporter": {"accountId": "u-pm", "displayName": "Product Owner"},
                    "issuetype": {"name": itype}, "priority": {"name": rng.choice(["High", "Medium", "Low"])},
                    "project": {"key": key, "name": team},
                    "created": _iso(created), "updated": _iso(updated),
                    "resolutiondate": _iso(resolved) if resolved else None,
                    "resolution": {"name": "Done"} if resolved else None,
                    "fixVersions": fix, "labels": [], "components": [{"name": rng.choice(apps)}],
                    "customfield_10007": sprints, "customfield_13000": {"name": f"Team {team}"},
                    "customfield_10004": float(rng.choice([1, 2, 3, 3, 5, 5, 8])) if itype != "Bug" else None,
                    "customfield_10206": {"displayName": people[0]},
                    "parent": None, "duedate": None, "description": None,
                    "comment": {"comments": [{"author": {"displayName": assignee or "Product Owner"}, "created": _iso(updated),
                                              "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"Status update: {final.lower()}"}]}]}}]},
                },
                "changelog": {"histories": [{"created": t, "items": [{"field": "status", "fromString": a, "toString": b}]} for t, a, b in history]},
            }

    # ------------------------------------------------------------------ transport
    def handler(self, request: httpx.Request) -> httpx.Response:
        p = request.url.path
        if p == "/rest/api/3/myself":
            return httpx.Response(200, json={"displayName": "Demo User", "emailAddress": "demo@example.com", "accountId": "u-demo", "active": True})
        if p == "/rest/api/3/field":
            return httpx.Response(200, json=[{"id": "customfield_13000", "name": "Team"}, {"id": "customfield_10007", "name": "Sprint"},
                                             {"id": "customfield_10004", "name": "Story Points"}, {"id": "customfield_10206", "name": "Technical Lead"}])
        if p == "/rest/agile/1.0/board":
            return httpx.Response(200, json={"isLast": True, "values": list(self.boards.values())})
        if p.startswith("/rest/agile/1.0/board/"):
            parts = p.split("/")
            bid = int(parts[5])
            if bid not in self.boards:
                return httpx.Response(404, json={"errorMessages": ["Board does not exist"]})
            if len(parts) == 6:
                return httpx.Response(200, json=self.boards[bid])
            if parts[6] == "sprint":
                state = request.url.params.get("state", "")
                vals = [s for s in self.sprints if not state or s["state"] in state] if bid == 921 else []
                return httpx.Response(200, json={"isLast": True, "values": vals})
            if parts[6] == "issue":
                prefix = self.boards[bid]["location"]["projectKey"] + "-"
                start = int(request.url.params.get("startAt", 0))
                keys = [k for k in self.issues if k.startswith(prefix)]
                page = keys[start:start + 100]
                return httpx.Response(200, json={"total": len(keys), "startAt": start, "maxResults": 100,
                                                 "issues": [self.issues[k] for k in page], "isLast": start + 100 >= len(keys)})
        if p.startswith("/rest/api/3/project/") and p.endswith("/versions"):
            return httpx.Response(200, json=[{"name": f"Release 2.{i}", "released": i < 4, "releaseDate": (self.today - timedelta(days=30 * (4 - i))).isoformat() if i < 4 else None} for i in range(7)])
        if p == "/rest/api/3/search/jql":
            body = json.loads(request.content or b"{}")
            import re
            m = re.search(r"key in \((.*?)\)", body.get("jql", ""))
            wanted = [k.strip().upper() for k in m.group(1).split(",")] if m else list(self.issues)
            return httpx.Response(200, json={"issues": [self.issues[k] for k in wanted if k in self.issues], "isLast": True})
        if p.startswith("/rest/api/3/issue/"):
            key = p.rsplit("/", 1)[-1].upper()
            return httpx.Response(200, json=self.issues[key]) if key in self.issues else httpx.Response(404, json={"errorMessages": ["Issue does not exist"]})
        if p == "/rest/api/3/user/assignable/search":
            return httpx.Response(200, json=[{"accountId": f"u-{i}", "displayName": n, "emailAddress": n.lower().replace(" ", ".") + "@example.com", "accountType": "atlassian", "active": True} for i, n in enumerate(PEOPLE)])
        return httpx.Response(404, json={"errorMessages": [f"unknown path {p}"]})

    def client(self) -> JiraSiteClient:
        c = JiraSiteClient(SITE, "demo@example.com", "demo-token", timeout=5, cache_minutes=60)
        c._client = httpx.Client(base_url=SITE, transport=httpx.MockTransport(self.handler),
                                 headers={"Authorization": c._auth, "Accept": "application/json"})
        return c


class _DemoRegistry(JiraBoardRegistry):
    """Board registry whose clients all talk to the in-process fake Jira."""

    def __init__(self, path: Path, pool: JiraClientPool, fake: DemoJira) -> None:
        self._fake = fake
        super().__init__(path, pool)
        if not self._boards:
            for bid, b in fake.boards.items():
                loc = b["location"]
                self._boards.append(BoardConfig(id=f"demo{bid}", url=f"{SITE}/jira/software/c/projects/{loc['projectKey']}/boards/{bid}",
                                                base_url=SITE, board_id=bid, project_key=loc["projectKey"], label=b["name"],
                                                board_name=b["name"], board_type=b["type"], project_name=loc["projectName"],
                                                last_test_ok=True))
            self._save()

    def client_for(self, cfg: BoardConfig):  # type: ignore[override]
        return self._fake.client()


class DemoWorkspace:
    """Container look-alike used by the API for guest sessions."""

    def __init__(self, settings: Settings) -> None:
        root = settings.upload_dir.parent / "demo"
        root.mkdir(parents=True, exist_ok=True)
        (root / "Data").mkdir(exist_ok=True)
        self.settings = settings.model_copy(update={
            "data_dir": root / "Data", "upload_dir": root / "uploads", "report_dir": root / "reports",
            "status_config_path": root / "status_mapping.json", "jira_boards_path": root / "boards.json",
            "jira_user_map_path": root / "user_map.json", "data_source_config_path": root / "data_source.json",
            "jira_credentials_path": root / "credentials.json", "data_source": "jira", "jira_auto_sync": False})
        for d in (self.settings.upload_dir, self.settings.report_dir):
            d.mkdir(parents=True, exist_ok=True)
        s = self.settings
        self.bus = EventBus()
        self.fake = DemoJira()
        self.normalizer = StatusNormalizer(None)  # defaults only, never persisted
        self.store = InMemoryDataStore(self.normalizer)
        self.excel = ExcelService(s, self.store, self.bus)
        self.analytics = AnalyticsEngine(self.store, self.normalizer, s.default_period_days)
        self.reports = ReportService(s, self.analytics, self.bus)
        self.jira_pool = JiraClientPool("demo@example.com", "demo-token", 5, 60)
        self.jira_boards = _DemoRegistry(s.jira_boards_path, self.jira_pool, self.fake)
        self.jira = JiraReconcileService(self.store, self.normalizer, self.jira_boards, self.jira_pool, self.bus,
                                         s.jira_user_map_path, auto_sync=False)
        self.jira_source = JiraDataSource(self.jira_boards, self.normalizer, 180, 3000)
        self.data = DataSourceService(s, self.store, self.excel, self.jira_source, self.jira_boards, self.jira_pool, self.bus)
        self.analytics.source_mode = lambda: self.data.mode
        self.jira.source_mode = lambda: self.data.mode
        self.analytics.board_members = self.data.board_members
        self.bus.subscribe("data.loaded", lambda e: self.analytics.invalidate())
        self._lock = threading.Lock()
        self.is_demo = True

    def ensure_loaded(self) -> None:
        with self._lock:
            if not self.store.is_loaded:
                log.info("Building synthetic demo dataset for guest access")
                self.data.load_all(force=True, reason="demo")
