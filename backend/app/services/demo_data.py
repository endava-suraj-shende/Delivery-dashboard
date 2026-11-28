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

# Six delivery streams, ten boards. Boards 1..7 scrum, 8..10 kanban.
BOARDS: List[Dict[str, Any]] = [
    {"id": 901, "name": "Phoenix Scrum Board", "type": "scrum", "key": "PHX", "project": "Phoenix - Customer Platform", "team": "Phoenix", "size": 420},
    {"id": 902, "name": "Phoenix Mobile", "type": "scrum", "key": "PHM", "project": "Phoenix - Customer Platform", "team": "Phoenix Mobile", "size": 260},
    {"id": 903, "name": "Atlas Data Platform", "type": "scrum", "key": "ATL", "project": "Atlas - Data & Analytics", "team": "Atlas", "size": 340},
    {"id": 904, "name": "Helios Payments", "type": "scrum", "key": "HEL", "project": "Helios - Payments", "team": "Helios", "size": 300},
    {"id": 905, "name": "Nimbus Cloud Migration", "type": "scrum", "key": "NIM", "project": "Nimbus - Cloud", "team": "Nimbus", "size": 220},
    {"id": 906, "name": "Orion Integrations", "type": "scrum", "key": "ORI", "project": "Orion - Integrations", "team": "Orion", "size": 240},
    {"id": 907, "name": "Vega QA Automation", "type": "scrum", "key": "VEG", "project": "Vega - Quality", "team": "Vega", "size": 180},
    {"id": 908, "name": "Atlas Reporting Kanban", "type": "kanban", "key": "ATR", "project": "Atlas - Data & Analytics", "team": "Atlas Reporting", "size": 160},
    {"id": 909, "name": "Helios Support Desk", "type": "kanban", "key": "HSD", "project": "Helios - Payments", "team": "Helios Support", "size": 200},
    {"id": 910, "name": "Platform Ops Kanban", "type": "kanban", "key": "OPS", "project": "Nimbus - Cloud", "team": "Platform Ops", "size": 150},
]

# ~60 people with mixed international names, 5-7 per team; a few people work across two teams.
PEOPLE_BY_TEAM: Dict[str, List[str]] = {
    "Phoenix": ["Aarav Mehta", "Priya Nair", "Lukas Mueller", "Sofia Martins", "Chen Wei", "Olivia Bennett", "Rohan Iyer"],
    "Phoenix Mobile": ["Mateo Alvarez", "Hana Kobayashi", "Ananya Desai", "Noah Fischer", "Zanele Dlamini", "Rohan Iyer"],
    "Atlas": ["Karan Shah", "Elena Petrova", "Daniel Costa", "Fatima Al-Sayed", "Ivan Horvat", "Meera Pillai", "Tomasz Nowak"],
    "Atlas Reporting": ["Isabella Rossi", "Nikhil Joshi", "Aisha Okafor", "Jonas Lindqvist", "Divya Menon"],
    "Helios": ["Arjun Verma", "Camila Silva", "Sameer Khan", "Emma Dubois", "Kenji Sato", "Tanvi Reddy", "Oluwaseun Adeyemi"],
    "Helios Support": ["Marta Kowalski", "Vikram Rao", "Leila Haddad", "Diego Fernandez", "Isha Bhatt"],
    "Nimbus": ["Sven Andersen", "Kavya Krishnan", "Pedro Oliveira", "Yuki Tanaka", "Amara Nwosu", "Rahul Bose"],
    "Platform Ops": ["Marcus Johansson", "Neha Gupta", "Gabriel Moreau", "Li Na", "Santiago Ruiz"],
    "Orion": ["Anika Sharma", "Felix Weber", "Nadia Rahman", "Thomas O'Brien", "Mei Ling", "Adeel Hussain"],
    "Vega": ["Claire Fontaine", "Siddharth Rao", "Ngozi Eze", "Mikhail Volkov", "Sara Lindgren", "Devika Nambiar"],
}
TEAM_LEAD = {"Phoenix": "Priya Nair", "Phoenix Mobile": "Mateo Alvarez", "Atlas": "Elena Petrova", "Atlas Reporting": "Isabella Rossi",
             "Helios": "Arjun Verma", "Helios Support": "Marta Kowalski", "Nimbus": "Sven Andersen", "Platform Ops": "Marcus Johansson",
             "Orion": "Anika Sharma", "Vega": "Claire Fontaine"}
APPS_BY_TEAM: Dict[str, List[str]] = {
    "Phoenix": ["Customer Portal", "Billing API", "Identity Service"], "Phoenix Mobile": ["Mobile App iOS", "Mobile App Android"],
    "Atlas": ["Data Platform", "Ingestion Pipeline", "Feature Store"], "Atlas Reporting": ["Reporting Service", "Executive Dashboards"],
    "Helios": ["Payments Gateway", "Ledger", "Fraud Engine"], "Helios Support": ["Payments Gateway", "Merchant Console"],
    "Nimbus": ["Kubernetes Platform", "CI/CD", "Observability"], "Platform Ops": ["Observability", "Access Management"],
    "Orion": ["Partner API", "Webhooks", "SFTP Connector"], "Vega": ["Test Automation", "Performance Lab"],
}
PEOPLE = sorted({p for ps in PEOPLE_BY_TEAM.values() for p in ps})
ISSUE_TYPES = [("Story", 48), ("Bug", 24), ("Task", 16), ("Spike", 5), ("Sub-task", 5), ("Epic", 2)]
# status pipeline (names map to the default normalizer categories)
FLOW = ["To Do", "In Analysis", "In Progress", "In Review", "Ready for QA", "In Testing", "Ready for Deployment", "Deployed to Dev", "Done", "In Production"]
SUMMARIES = ["Add export to CSV", "Fix login timeout", "Improve dashboard load time", "Migrate payments webhook",
             "Update onboarding flow", "Refactor notification service", "Resolve duplicate invoices", "Add audit trail",
             "Optimise search index", "Upgrade dependency versions", "Implement role filters", "Fix date parsing bug",
             "Add retry to sync job", "Redesign settings page", "Improve error messages", "Support bulk upload",
             "Add sprint velocity chart", "Fix timezone offset", "Enable dark mode", "Automate release notes",
             "Harden rate limiting", "Localise currency formatting", "Migrate to OAuth 2.1", "Reduce cold start time",
             "Add idempotency keys", "Fix memory leak in worker", "Archive stale accounts", "Introduce feature flags",
             "Backfill historical data", "Rotate signing keys", "Add health-check endpoint", "Improve accessibility labels",
             "Consolidate logging format", "Deprecate legacy endpoint", "Add contract tests", "Tune autoscaling thresholds",
             "Fix rounding in tax calculation", "Add SSO for partner console", "Encrypt PII at rest", "Document runbooks"]
RELEASES = ["Release 3.8", "Release 3.9", "Release 4.0", "Release 4.1", "Hotfix 3.9.1", "Release 4.2 (planned)"]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


class DemoJira:
    """Generates and serves a consistent fake Jira site with ten boards and ~2,500 tickets."""

    def __init__(self, today: Optional[date] = None, seed: int = 42) -> None:
        self.today = today or date.today()
        self.rng = random.Random(seed)
        self.boards = {b["id"]: {"id": b["id"], "name": b["name"], "type": b["type"], "location": {"projectKey": b["key"], "projectName": b["project"]}} for b in BOARDS}
        self._meta = {b["id"]: b for b in BOARDS}
        self.sprints_by_board: Dict[int, List[Dict[str, Any]]] = {}
        self.sprints: List[Dict[str, Any]] = []
        for b in BOARDS:
            if b["type"] == "scrum":
                sp = self._make_sprints(b)
                self.sprints_by_board[b["id"]] = sp
                self.sprints.extend(sp)
        self.issues: Dict[str, Dict[str, Any]] = {}
        self.versions: Dict[str, List[Dict[str, Any]]] = {}
        for b in BOARDS:
            self._make_issues(b)

    # ------------------------------------------------------------------ generation
    def _make_sprints(self, b: Dict[str, Any]) -> List[Dict[str, Any]]:
        out = []
        offset = self.rng.randint(0, 6)  # teams start sprints on different days
        start = datetime.combine(self.today, datetime.min.time()) - timedelta(days=offset + 14 * 10)
        for i in range(11):
            s = start + timedelta(days=14 * i)
            e = s + timedelta(days=13, hours=17)
            state = "active" if i == 10 else "closed"
            sp = {"id": b["id"] * 100 + i, "name": f"{b['key']} Sprint {20 + i}", "state": state, "startDate": _iso(s), "endDate": _iso(e),
                  "originBoardId": b["id"], "goal": self.rng.choice(["Stabilise release", "Onboard new partner", "Reduce incident backlog", "Deliver reporting MVP", "Platform hardening"])}
            if state == "closed":
                sp["completeDate"] = _iso(e + timedelta(minutes=30))
            out.append(sp)
        return out

    def _sprint_for(self, bid: int, dt: datetime) -> Optional[Dict[str, Any]]:
        key = _iso(dt)
        for sp in self.sprints_by_board.get(bid, []):
            if sp["startDate"] <= key <= sp["endDate"]:
                return sp
        return None

    def _make_issues(self, b: Dict[str, Any]) -> None:
        rng = self.rng
        key, team, bid = b["key"], b["team"], b["id"]
        people = PEOPLE_BY_TEAM[team]
        apps = APPS_BY_TEAM[team]
        lead = TEAM_LEAD[team]
        now = datetime.combine(self.today, datetime.min.time()) + timedelta(hours=18)
        # per-person "profile": a couple of strong performers, one overloaded, one mostly on bugs
        strong = set(rng.sample(people, 2))
        overloaded = rng.choice([p for p in people if p not in strong])
        self.versions[key] = [{"name": r, "released": not r.endswith("(planned)") and i < 4, "releaseDate": (self.today - timedelta(days=75 - i * 18)).isoformat() if i < 4 else None}
                              for i, r in enumerate(RELEASES)]
        for n in range(1, b["size"] + 1):
            created = now - timedelta(days=rng.randint(2, 175), hours=rng.randint(0, 9))
            itype = rng.choices([t for t, _ in ISSUE_TYPES], [w for _, w in ISSUE_TYPES])[0]
            if rng.random() < 0.04:
                assignee = None
            else:
                weights = [3.0 if p == overloaded else (1.6 if p in strong else 1.0) for p in people]
                assignee = rng.choices(people, weights)[0]
            age = (now - created).days
            depth_cap = len(FLOW) if age > 28 else (7 if age > 12 else 4)
            depth = rng.randint(1, depth_cap)
            if assignee in strong and depth < len(FLOW) and rng.random() < 0.35:
                depth = min(len(FLOW), depth + 2)
            roll = rng.random()
            if roll < 0.045:
                final = "Blocked"
            elif roll < 0.07:
                final = "On Hold"
            elif roll < 0.09:
                final = "Cancelled"
            elif roll < 0.11 and depth >= 8:
                final = "Reopened"
            else:
                final = FLOW[depth - 1]
            history, t, prev = [], created, FLOW[0]
            for st in FLOW[1:depth]:
                t = t + timedelta(days=rng.randint(1, 4), hours=rng.randint(1, 8))
                if t > now:
                    break
                history.append((_iso(t), prev, st))
                prev = st
            if final not in FLOW:
                t = min(now, t + timedelta(days=1))
                history.append((_iso(t), prev, final))
            updated = datetime.strptime(history[-1][0][:19], "%Y-%m-%dT%H:%M:%S") if history else created
            done = final in ("Done", "In Production", "Cancelled")
            resolved = updated if done else None
            sprints: List[Dict[str, Any]] = []
            if b["type"] == "scrum":
                sp = self._sprint_for(bid, created + timedelta(days=1))
                if sp:
                    sprints.append(sp)
                    nxt = sp
                    # carry-over: unfinished work rolls into the next sprint(s)
                    while resolved is None and nxt["state"] == "closed" and rng.random() < 0.4:
                        cand = next((s for s in self.sprints_by_board[bid] if s["id"] == nxt["id"] + 1), None)
                        if not cand:
                            break
                        sprints.append(cand)
                        nxt = cand
            fix = []
            if rng.random() < 0.35:
                v = rng.choice(self.versions[key][:5])
                fix = [v]
            due = (created + timedelta(days=rng.randint(5, 30))).date() if rng.random() < 0.6 else None
            points = None if itype in ("Bug", "Epic") else float(rng.choice([1, 2, 3, 3, 5, 5, 8, 13]))
            env = rng.choice(["Production", "Staging", "Dev", None, None])
            comment_txt = rng.choice([f"Status update: {final.lower()}", "Waiting on partner API keys", "Blocked by infra change window",
                                      "Ready for review, PR #" + str(rng.randint(1000, 4999)), "Verified on staging", "Re-opened after UAT feedback"])
            self.issues[f"{key}-{n}"] = {
                "key": f"{key}-{n}",
                "fields": {
                    "summary": f"{rng.choice(SUMMARIES)} ({key}-{n})",
                    "status": {"name": final, "statusCategory": {"key": "done" if done else ("new" if final == "To Do" else "indeterminate")}},
                    "assignee": {"accountId": f"u-{PEOPLE.index(assignee)}", "displayName": assignee, "emailAddress": assignee.lower().replace(" ", ".").replace("'", "") + "@example.com"} if assignee else None,
                    "reporter": {"accountId": "u-po", "displayName": lead},
                    "issuetype": {"name": itype}, "priority": {"name": rng.choices(["Highest", "High", "Medium", "Low"], [1, 3, 5, 2])[0]},
                    "project": {"key": key, "name": b["project"]},
                    "created": _iso(created), "updated": _iso(updated),
                    "resolutiondate": _iso(resolved) if resolved else None,
                    "resolution": {"name": "Won't Do" if final == "Cancelled" else "Done"} if resolved else None,
                    "fixVersions": fix, "labels": rng.sample(["backend", "frontend", "security", "tech-debt", "customer-impact"], k=rng.randint(0, 2)),
                    "components": [{"name": rng.choice(apps)}],
                    "customfield_10007": sprints, "customfield_13000": {"name": f"Team {team}"},
                    "customfield_10004": points, "customfield_10206": {"displayName": lead},
                    "customfield_10300": {"value": env} if env else None,
                    "parent": None, "duedate": due.isoformat() if due else None, "description": None,
                    "comment": {"comments": [{"author": {"displayName": assignee or lead}, "created": _iso(updated),
                                              "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_txt}]}]}}]},
                },
                "changelog": {"histories": [{"created": t, "items": [{"field": "status", "fromString": a, "toString": z}]} for t, a, z in history]},
            }

    # ------------------------------------------------------------------ transport
    def handler(self, request: httpx.Request) -> httpx.Response:
        p = request.url.path
        if p == "/rest/api/3/myself":
            return httpx.Response(200, json={"displayName": "Demo User", "emailAddress": "demo@example.com", "accountId": "u-demo", "active": True})
        if p == "/rest/api/3/field":
            return httpx.Response(200, json=[{"id": "customfield_13000", "name": "Team"}, {"id": "customfield_10007", "name": "Sprint"},
                                             {"id": "customfield_10004", "name": "Story Points"}, {"id": "customfield_10206", "name": "Technical Lead"},
                                             {"id": "customfield_10300", "name": "Environment"}])
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
                vals = [s for s in self.sprints_by_board.get(bid, []) if not state or s["state"] in state]
                return httpx.Response(200, json={"isLast": True, "values": vals})
            if parts[6] == "issue":
                prefix = self.boards[bid]["location"]["projectKey"] + "-"
                start = int(request.url.params.get("startAt", 0))
                keys = [k for k in self.issues if k.startswith(prefix)]
                page = keys[start:start + 100]
                return httpx.Response(200, json={"total": len(keys), "startAt": start, "maxResults": 100,
                                                 "issues": [self.issues[k] for k in page], "isLast": start + 100 >= len(keys)})
        if p.startswith("/rest/api/3/project/") and p.endswith("/versions"):
            key = p.split("/")[5]
            return httpx.Response(200, json=self.versions.get(key, []))
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
            return httpx.Response(200, json=[{"accountId": f"u-{i}", "displayName": n, "emailAddress": n.lower().replace(" ", ".").replace("'", "") + "@example.com", "accountType": "atlassian", "active": True} for i, n in enumerate(PEOPLE)])
        return httpx.Response(404, json={"errorMessages": [f"unknown path {p}"]})

    def client(self) -> JiraSiteClient:
        c = JiraSiteClient(SITE, "demo@example.com", "demo-token", timeout=5, cache_minutes=60)
        c._client = httpx.Client(base_url=SITE, transport=httpx.MockTransport(self.handler),
                                 headers={"Authorization": c._auth, "Accept": "application/json"})
        return c


class _DemoRegistry(JiraBoardRegistry):
    """Board registry whose clients all talk to the in-process fake Jira."""

    def __init__(self, path: Path, pool: JiraClientPool, fake: DemoJira, repo: Any = None, owners: Optional[Dict[int, str]] = None) -> None:
        self._fake = fake
        super().__init__(path, pool, repo=repo)
        if not self._boards:
            for bid, b in fake.boards.items():
                loc = b["location"]
                self._boards.append(BoardConfig(id=f"demo{bid}", url=f"{SITE}/jira/software/c/projects/{loc['projectKey']}/boards/{bid}",
                                                base_url=SITE, board_id=bid, project_key=loc["projectKey"], label=b["name"],
                                                board_name=b["name"], board_type=b["type"], project_name=loc["projectName"],
                                                last_test_ok=True, owner_id=(owners or {}).get(bid)))
            self._save()

    def client_for(self, cfg: BoardConfig):  # type: ignore[override]
        return self._fake.client()


def _demo_db(path: Path):
    """Separate SQLite file for synthetic accounts / codes / boards. Rebuilt from the models on every start."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db.base import Base
    from app.db import models  # noqa: F401  (registers tables)
    if path.exists():
        path.unlink()  # demo state is disposable: start clean so presentations are predictable
    engine = create_engine(f"sqlite:///{path.as_posix()}", future=True, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


# (name, email, role, superuser, status, extra)
DEMO_ACCOUNTS = [
    ("Sofia Martins", "sofia.martins@example.com", "admin", True, "active", {}),
    ("Daniel Costa", "daniel.costa@example.com", "admin", False, "active", {}),
    ("Ravi Kapoor", "ravi.kapoor@example.com", "admin", False, "pending_approval", {}),
    ("Demo Delivery Manager", "demo.manager@example.com", "dm", False, "active", {"boards": [901, 902], "granted": [907]}),
    ("Priya Nair", "priya.nair@example.com", "dm", False, "active", {"granted": [901]}),
    ("Elena Petrova", "elena.petrova@example.com", "dm", False, "active", {"boards": [903, 908]}),
    ("Arjun Verma", "arjun.verma@example.com", "dm", False, "active", {"boards": [904, 909]}),
    ("Sven Andersen", "sven.andersen@example.com", "dm", False, "active", {"boards": [905, 910]}),
    ("Anika Sharma", "anika.sharma@example.com", "dm", False, "active", {"boards": [906]}),
    ("Claire Fontaine", "claire.fontaine@example.com", "dm", False, "active", {"boards": [907]}),
    ("Mateo Alvarez", "mateo.alvarez@example.com", "dm", False, "active", {"granted": [902]}),
    ("Lucas Pereira", "lucas.pereira@example.com", "dm", False, "pending_verification", {}),
    ("Meera Pillai", "meera.pillai@example.com", "employee", False, "active", {}),
    ("Karan Shah", "karan.shah@example.com", "employee", False, "active", {}),
    ("Chen Wei", "chen.wei@example.com", "employee", False, "active", {}),
    ("Oluwaseun Adeyemi", "oluwaseun.adeyemi@example.com", "employee", False, "active", {}),
    ("Hana Kobayashi", "hana.kobayashi@example.com", "employee", False, "active", {"must_change": True}),
    ("Tomasz Nowak", "tomasz.nowak@example.com", "employee", False, "disabled", {}),
    ("Diego Fernandez", "diego.fernandez@example.com", "employee", False, "pending_verification", {}),
    ("Visiting Partner", "visitor@partner.example", "guest", False, "active", {"guest_days": 3}),
    ("Board Member", "board.member@investor.example", "guest", False, "active", {"guest_days": 1}),
    ("Expired Guest", "former.guest@partner.example", "guest", False, "pending_approval", {"guest_days": -2}),
    ("Rejected Applicant", "someone@random.example", "admin", False, "rejected", {"reason": "Not a known stakeholder"}),
]


def _seed_demo_db(factory, auth) -> Dict[int, str]:
    """Idempotent: creates the fake accounts / codes once and returns board owners (board id -> user id)."""
    from datetime import timedelta
    from sqlalchemy import select
    from app.db.models import (AccessRule, User, UserBoardAccess, utcnow)
    from app.core.security import hash_password
    owners: Dict[int, str] = {}
    with factory() as db:
        if db.execute(select(User)).first() is None:
            db.add(AccessRule(kind="domain", value="example.com", note="demo"))
            db.add(AccessRule(kind="email", value="visitor@partner.example", note="demo"))
            users: Dict[str, User] = {}
            for i, (name, email, role, su, status, extra) in enumerate(DEMO_ACCOUNTS):
                u = User(email=email, name=name, password_hash=hash_password("Demo-Pass-2026!"), role=role, requested_role=role,
                         status=status, is_superuser=su, created_at=utcnow() - timedelta(days=60 - i * 2),
                         email_verified_at=None if status == "pending_verification" else utcnow() - timedelta(days=59 - i * 2),
                         approved_at=utcnow() - timedelta(days=58 - i * 2) if status == "active" else None,
                         last_login_at=utcnow() - timedelta(hours=3 + i * 11) if status in ("active", "disabled") else None,
                         must_change_password=bool(extra.get("must_change")), rejection_reason=extra.get("reason"))
                if role == "guest":
                    u.access_expires_at = utcnow() + timedelta(days=extra.get("guest_days", 5))
                db.add(u)
                users[email] = u
            db.flush()
            for (name, email, role, su, status, extra) in DEMO_ACCOUNTS:
                for bid in extra.get("boards", []):
                    owners[bid] = users[email].id
            actor = users["sofia.martins@example.com"]
            for role, label, uses, exp, mx in (("employee", "Phoenix team onboarding", 6, None, None), ("employee", "Helios new joiners", 2, 30, 10),
                                               ("dm", "Delivery leads Q4", 4, None, None), ("guest", "Stakeholder preview", 2, 14, 5),
                                               ("guest", "Investor demo (exhausted)", 3, None, 3), ("admin", "Platform admins", 1, None, 2)):
                d = auth.create_code(db, actor, role, label, None, exp, mx)
                from app.db.models import AuthCode
                row = db.get(AuthCode, d["id"])
                row.uses = uses
            db.commit()
            # board grants are applied after boards exist (see DemoWorkspace)
        else:
            dms = db.execute(select(User).where(User.role == "dm")).scalars().all()
            by_email = {u.email: u for u in dms}
            for (name, email, role, su, status, extra) in DEMO_ACCOUNTS:
                if email in by_email:
                    for bid in extra.get("boards", []):
                        owners[bid] = by_email[email].id
    return owners


def _apply_demo_grants(factory, auth, boards) -> None:
    from sqlalchemy import select
    from app.db.models import User, UserBoardAccess
    by_num = {b.board_id: b for b in boards}
    with factory() as db:
        for (name, email, role, su, status, extra) in DEMO_ACCOUNTS:
            for bid in extra.get("granted", []):
                u = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
                b = by_num.get(bid)
                if not u or not b:
                    continue
                if db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == u.id, UserBoardAccess.board_id == b.id)).scalar_one_or_none() is None:
                    code = auth.ensure_board_code(db, b.id, b.owner_id)
                    db.add(UserBoardAccess(user_id=u.id, board_id=b.id, granted_via=code.id))
                    code.uses += 1
        db.commit()


class DemoWorkspace:
    """Container look-alike used by the API for guest sessions and superuser demo mode."""

    def __init__(self, settings: Settings, secrets: Any = None, auth_secret: str = "demo-secret") -> None:
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
        # own SQLite database with synthetic accounts, codes and boards (never the real one)
        from app.db.repos import BoardRepo
        from app.services.auth_service import AuthService
        from app.services.email_service import EmailService
        self.db = _demo_db(root / "demo.db")
        self.secrets = secrets
        self.email = EmailService(s.model_copy(update={"resend_api_key": ""}))
        self.auth = AuthService(s, self.email, auth_secret, box=secrets)
        self.upload_owners = None
        owners = _seed_demo_db(self.db, self.auth)
        self.normalizer = StatusNormalizer(None)  # defaults only, never persisted
        self.store = InMemoryDataStore(self.normalizer)
        self.excel = ExcelService(s, self.store, self.bus)
        self.analytics = AnalyticsEngine(self.store, self.normalizer, s.default_period_days)
        self.reports = ReportService(s, self.analytics, self.bus, db_factory=self.db, workspace="demo")
        from app.services.narrative_service import NarrativeService
        self.narrative = NarrativeService(self.analytics)
        from app.services.forecast_service import ForecastService
        self.forecast = ForecastService(self.analytics)
        self.reports.narrative, self.reports.forecast = self.narrative, self.forecast
        from app.services.reconciliation_workflow import ReconciliationWorkflow
        self.recon_workflow = ReconciliationWorkflow(self, workspace="demo")
        self.jira_pool = JiraClientPool("demo@example.com", "demo-token", 5, 60)
        self.jira_boards = _DemoRegistry(s.jira_boards_path, self.jira_pool, self.fake, repo=BoardRepo(self.db), owners=owners)
        with self.db() as dbs:
            for b in self.jira_boards.list():
                self.auth.ensure_board_code(dbs, b.id, b.owner_id)
            dbs.commit()
        _apply_demo_grants(self.db, self.auth, self.jira_boards.list())
        self.jira = JiraReconcileService(self.store, self.normalizer, self.jira_boards, self.jira_pool, self.bus,
                                         s.jira_user_map_path, auto_sync=False)
        self.jira_source = JiraDataSource(self.jira_boards, self.normalizer, 180, 5000)
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
