"""Jira integration tests using a fake HTTP transport (no network)."""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict

import httpx
import pytest

from app.core.exceptions import AppError
from app.services.filter_service import Filters
from app.services.jira_client import JiraSiteClient, parse_board_url

ALL = Filters(start_date=date(2000, 1, 1), end_date=date(2100, 1, 1))

USERS = {
    "u-alice": {"accountId": "u-alice", "displayName": "Alice A", "emailAddress": "alice.a@x.com"},
    "u-bob": {"accountId": "u-bob", "displayName": "B Bob", "emailAddress": "bob.b@x.com"},
    "u-zed": {"accountId": "u-zed", "displayName": "Zed Z", "emailAddress": "zed@x.com"},
}

# Jira truth for the synthetic workbooks in conftest
ISSUES: Dict[str, Dict[str, Any]] = {
    "A-1": {"status": "Done", "cat": "done", "assignee": "u-alice", "updated": "2026-10-29T10:00:00.000+0000", "resolved": "2026-10-29T10:00:00.000+0000",
            "components": ["App1"], "fix": True, "carried": True, "due": "2026-10-30",
            "history": [("2026-10-10T09:00:00.000+0000", "Backlog", "In Dev"), ("2026-10-20T09:00:00.000+0000", "In Dev", "In QA"), ("2026-10-29T10:00:00.000+0000", "In QA", "Done")]},
    "A-2": {"status": "In Progress", "cat": "indeterminate", "assignee": "u-alice", "updated": "2026-10-31T10:00:00.000+0000", "type": "Spike",
            "history": [("2026-10-15T09:00:00.000+0000", "Backlog", "In Progress")]},  # Excel: Completed -> conflict
    "A-3": {"status": "Blocked", "cat": "indeterminate", "assignee": "u-bob", "updated": "2026-10-10T10:00:00.000+0000", "type": "Bug", "due": "2026-10-01",
            "history": [("2026-10-10T09:00:00.000+0000", "In Dev", "Blocked")]},        # assignee mismatch
    "A-4": {"status": "In Testing", "cat": "indeterminate", "assignee": None, "updated": "2026-10-20T10:00:00.000+0000"},        # unassigned
    "A-5": {"status": "Done", "cat": "done", "assignee": "u-alice", "updated": "2026-10-31T10:00:00.000+0000", "due": "2026-09-30"},                  # Excel in progress -> jira done
    # A-6 missing in Jira -> not_found
    "B-1": {"status": "Done", "cat": "done", "assignee": "u-bob", "updated": "2026-10-16T10:00:00.000+0000"},
    "B-2": {"status": "On Hold", "cat": "indeterminate", "assignee": "u-bob", "updated": "2026-10-16T10:00:00.000+0000"},
    # Jira-only issue assigned to Alice, not in any sheet
    "A-9": {"status": "In Progress", "cat": "indeterminate", "assignee": "u-alice", "updated": "2026-10-28T10:00:00.000+0000",
            "history": [("2026-10-28T10:00:00.000+0000", "Backlog", "In Progress")]},
}


SPRINT_6 = {"id": 6, "name": "Sprint 6", "state": "closed", "startDate": "2026-10-06T08:00:00.000Z", "endDate": "2026-10-19T17:00:00.000Z", "completeDate": "2026-10-19T17:30:00.000Z", "originBoardId": 921}
SPRINT_7 = {"id": 7, "name": "Sprint 7", "state": "active", "startDate": "2026-10-20T08:00:00.000Z", "endDate": "2026-11-02T17:00:00.000Z", "originBoardId": 921}


def _issue_json(key: str) -> Dict[str, Any]:
    d = ISSUES[key]
    sprints = [SPRINT_6, SPRINT_7] if d.get("carried") else [SPRINT_7]
    return {"key": key, "fields": {
        "summary": f"Summary {key}", "status": {"name": d["status"], "statusCategory": {"key": d["cat"]}},
        "assignee": USERS.get(d["assignee"]) if d["assignee"] else None, "reporter": USERS["u-alice"],
        "issuetype": {"name": d.get("type", "Story")}, "priority": {"name": "Medium"}, "project": {"key": key.split("-")[0], "name": "Project A"},
        "created": d.get("created", "2026-10-01T00:00:00.000+0000"), "updated": d["updated"], "resolutiondate": d.get("resolved"),
        "resolution": {"name": "Done"} if d.get("resolved") else None,
        "fixVersions": [{"name": "V1.0", "released": True, "releaseDate": "2026-10-29"}] if d.get("fix") else [],
        "labels": d.get("labels", []), "components": [{"name": c} for c in d.get("components", [])],
        "customfield_10020": sprints,
        "customfield_10007": sprints,
        "customfield_13000": {"name": "Team Alpha"} if d.get("team", True) else None,
        "customfield_10004": 3.0, "parent": None, "duedate": d.get("due"), "description": None,
        "comment": {"comments": [{"author": USERS["u-alice"], "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "last note"}]}]}}]},
    }, "changelog": {"histories": [
        {"created": t, "items": [{"field": "status", "fromString": fr, "toString": to}]} for t, fr, to in d.get("history", [])
    ]}}


class FakeJira:
    """Minimal Jira Cloud emulation for the endpoints the client uses."""

    def __init__(self) -> None:
        self.calls: list = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, request.url.path, dict(request.url.params)))
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Basic "):
            return httpx.Response(401, json={"errorMessages": ["no auth"]})
        p = request.url.path
        if p == "/rest/api/3/myself":
            return httpx.Response(200, json={"displayName": "Suraj", "emailAddress": "s@x.com", "accountId": "u-me", "active": True})
        if p == "/rest/agile/1.0/board/921":
            return httpx.Response(200, json={"id": 921, "name": "A Scrum Board", "type": "scrum", "location": {"projectKey": "A", "projectName": "Project A"}})
        if p == "/rest/agile/1.0/board/999":
            return httpx.Response(404, json={"errorMessages": ["Board does not exist"]})
        if p == "/rest/agile/1.0/board/403":
            return httpx.Response(403, json={"errorMessages": ["forbidden"]})
        if p == "/rest/agile/1.0/board":
            return httpx.Response(200, json={"isLast": True, "values": [
                {"id": 921, "name": "A Scrum Board", "type": "scrum", "location": {"projectKey": "A", "projectName": "Project A"}},
                {"id": 922, "name": "B Kanban", "type": "kanban", "location": {"projectKey": "B", "projectName": "Project B"}}]})
        if p == "/rest/agile/1.0/board/921/sprint":
            state = request.url.params.get("state", "")
            values = [s for s in (SPRINT_6, SPRINT_7) if not state or s["state"] in state]
            return httpx.Response(200, json={"isLast": True, "values": values})
        if p == "/rest/agile/1.0/board/921/issue":
            keys = [k for k in ISSUES if k.startswith("A-")]
            return httpx.Response(200, json={"total": len(keys), "issues": [_issue_json(k) for k in keys]})
        if p == "/rest/api/3/field":
            return httpx.Response(200, json=[
                {"id": "customfield_17692", "name": "Team"}, {"id": "customfield_13000", "name": "Team"},
                {"id": "customfield_10007", "name": "Sprint"}, {"id": "customfield_10004", "name": "Story Points"},
                {"id": "customfield_10100", "name": "Epic Link"}, {"id": "customfield_10206", "name": "Technical Lead"}])
        if p == "/rest/api/3/project/A/versions":
            return httpx.Response(200, json=[{"name": "V1.0", "released": True, "releaseDate": "2026-10-29"}])
        if p == "/rest/api/3/search/jql":
            body = json.loads(request.content or b"{}")
            jql = body.get("jql", "")
            import re
            wanted = [k.strip().upper() for k in re.search(r"key in \((.*?)\)", jql).group(1).split(",")] if "key in" in jql else list(ISSUES)
            found = [_issue_json(k) for k in wanted if k in ISSUES]
            return httpx.Response(200, json={"issues": found, "isLast": True})
        if p == "/rest/api/3/user/assignable/search":
            return httpx.Response(200, json=[{**u, "accountType": "atlassian", "active": True} for u in USERS.values()])
        if p.startswith("/rest/api/3/issue/"):
            key = p.rsplit("/", 1)[-1].upper()
            return httpx.Response(200, json=_issue_json(key)) if key in ISSUES else httpx.Response(404, json={"errorMessages": ["Issue does not exist"]})
        return httpx.Response(404, json={"errorMessages": [f"unknown path {p}"]})


@pytest.fixture
def fake_jira(monkeypatch: pytest.MonkeyPatch) -> FakeJira:
    fake = FakeJira()
    original_init = JiraSiteClient.__init__

    def patched_init(self, base_url, email, token, timeout=30, cache_minutes=10):  # type: ignore[no-untyped-def]
        original_init(self, base_url, email, token, timeout, cache_minutes)
        self._client = httpx.Client(base_url=self.base_url, transport=httpx.MockTransport(fake.handler),
                                    headers={"Authorization": self._auth, "Accept": "application/json"})

    monkeypatch.setattr(JiraSiteClient, "__init__", patched_init)
    return fake


@pytest.fixture
def jira_settings(settings):
    settings.jira_email = "me@x.com"
    settings.jira_api_token = "secret-token"
    settings.data_source = "excel"
    return settings


@pytest.fixture
def jira_services(jira_settings, fake_jira):
    from tests.conftest import services as _services_fixture  # noqa: F401  (documentation only)
    from app.events.event_bus import EventBus
    from app.processors.status_normalizer import StatusNormalizer
    from app.services.analytics_service import AnalyticsEngine
    from app.services.data_store import InMemoryDataStore
    from app.services.excel_service import ExcelService
    from app.services.jira_board_registry import JiraBoardRegistry
    from app.services.jira_client import JiraClientPool
    from app.services.jira_reconcile_service import JiraReconcileService

    s = jira_settings
    for d in (s.upload_dir, s.report_dir, s.status_config_path.parent):
        d.mkdir(parents=True, exist_ok=True)
    bus = EventBus()
    normalizer = StatusNormalizer(s.status_config_path)
    store = InMemoryDataStore(normalizer)
    excel = ExcelService(s, store, bus)
    engine = AnalyticsEngine(store, normalizer, 15)
    pool = JiraClientPool(s.jira_email, s.jira_api_token, 5, 10)
    registry = JiraBoardRegistry(s.jira_boards_path, pool)
    jira = JiraReconcileService(store, normalizer, registry, pool, bus, s.jira_user_map_path, auto_sync=True)
    excel.load_all(force=True, reason="test")
    return type("S", (), {"store": store, "excel": excel, "engine": engine, "pool": pool, "registry": registry, "jira": jira, "bus": bus})()


# ---------------------------------------------------------------- url parsing
def test_parse_board_url_variants():
    r = parse_board_url("https://annalect.atlassian.net/jira/software/c/projects/OCS/boards/921")
    assert (r.base_url, r.board_id, r.project_key) == ("https://annalect.atlassian.net", 921, "OCS")
    r = parse_board_url("https://x.atlassian.net/jira/software/projects/MRE/boards/12?selectedIssue=MRE-1")
    assert (r.board_id, r.project_key) == (12, "MRE")
    r = parse_board_url("https://x.atlassian.net/secure/RapidBoard.jspa?rapidView=77&projectKey=MED")
    assert r.board_id == 77
    with pytest.raises(AppError):
        parse_board_url("https://x.atlassian.net/browse/OCS-1")


# ---------------------------------------------------------------- registry
def test_registry_add_test_discover(jira_services):
    s = jira_services
    cfg = s.registry.add("https://fake.atlassian.net/jira/software/c/projects/A/boards/921")
    assert cfg.board_name == "A Scrum Board" and cfg.project_key == "A" and cfg.last_test_ok
    assert cfg.label == "A Scrum Board"
    with pytest.raises(AppError):
        s.registry.add("https://fake.atlassian.net/jira/software/c/projects/A/boards/921")
    bad = s.registry.test_url("https://fake.atlassian.net/jira/software/c/projects/A/boards/999")
    assert bad["ok"] is False and "not found" in bad["error"].lower()
    forb = s.registry.test_url("https://fake.atlassian.net/jira/software/c/projects/A/boards/403")
    assert forb["ok"] is False and "credentials" in forb["error"].lower()
    disc = s.registry.discover("https://fake.atlassian.net", ["A", "B"])
    assert {d["board_id"]: d["configured"] for d in disc} == {921: True, 922: False}
    assert s.registry.by_project("a").id == cfg.id
    s.registry.update(cfg.id, excel_board_names=["ALPHA Board"])
    assert s.registry.by_excel_name("alpha board").id == cfg.id
    # persisted
    from app.services.jira_board_registry import JiraBoardRegistry
    again = JiraBoardRegistry(s.registry._path, s.pool)
    assert len(again.list()) == 1
    s.registry.remove(cfg.id)
    assert s.registry.list() == []


def test_not_configured_raises(settings, fake_jira):
    from app.services.jira_client import JiraClientPool, JiraNotConfigured
    pool = JiraClientPool("", "", 5, 1)
    with pytest.raises(JiraNotConfigured):
        pool.for_site("https://fake.atlassian.net")


# ---------------------------------------------------------------- reconciliation
def test_sync_and_reconcile(jira_services, fake_jira):
    s = jira_services
    s.registry.add("https://fake.atlassian.net/jira/software/c/projects/A/boards/921")
    st = s.jira.sync()
    assert st["fetched_issues"] >= 8 and st["errors"] == [] and st["last_sync"]
    rec = s.jira.reconcile(ALL)
    by_key = {(r["ticket_id"], r["employee"]): r for r in rec["items"]}
    codes = lambda k, e="Alice A": {f["code"] for f in by_key[(k, e)]["flags"]}  # noqa: E731
    assert by_key[("A-1", "Alice A")]["verdict"] == "ok"
    assert "completed_not_resolved" in codes("A-2")
    assert "assignee_mismatch" in codes("A-3")
    assert "unassigned" in codes("A-4")
    assert "jira_done_excel_open" in codes("A-5")
    assert by_key[("A-6", "Alice A")]["jira_found"] is False and "not_found" in codes("A-6")
    assert by_key[("B-1", "Bob B")]["verdict"] == "ok"
    missing = [r for r in rec["items"] if r["flags"] and r["flags"][0]["code"] == "missing_from_excel"]
    assert [m["ticket_id"] for m in missing] == ["A-9"] and missing[0]["employee"] == "Alice A"
    sm = rec["summary"]
    # not found: A-6 (absent in Jira) + IN-100 / IN-101 (project without a configured board -> unmapped_board)
    assert sm["not_found"] == 1 and sm["unmapped_board"] == 2 and sm["missing_from_excel"] == 1 and sm["errors"] >= 2
    assert sm["by_check"]["unmapped_board"] == 2 and sm["by_check"]["not_found"] == 1
    assert sm["compared"] == 12  # 12 activity rows - 1 'No Jira' row + 1 extra from the A-4/A-5 cell
    assert by_key[("IN-100", "Carol C")]["jira_found"] is False


def test_user_mapping_fuzzy_and_override(jira_services):
    s = jira_services
    s.registry.add("https://fake.atlassian.net/jira/software/c/projects/A/boards/921")
    s.jira.sync()
    m = {u["employee"]: u for u in s.jira.user_map_summary()}
    assert m["Alice A"]["match"] == "exact" and m["Alice A"]["account_id"] == "u-alice"
    assert m["Bob B"]["account_id"] == "u-bob" and m["Bob B"]["match"] == "fuzzy"  # 'B Bob' token match
    assert m["Carol C"]["account_id"] is None
    s.jira.set_user_mapping("Carol C", "u-zed", "Zed Z", "zed@x.com")
    assert s.jira.resolve_employee("Carol C")["match"] == "manual"
    s.jira.set_user_mapping("Carol C", None, None, None)
    assert s.jira.resolve_employee("Carol C")["match"] == "none"


def test_reconcile_single_file_and_period_filter(jira_services):
    s = jira_services
    s.registry.add("https://fake.atlassian.net/jira/software/c/projects/A/boards/921")
    s.jira.sync()
    reps = s.store.reports()
    fid = reps[reps["file_name"] == "Alice_A-30-10-2026.xlsx"].iloc[0]["file_id"]
    rec = s.jira.reconcile(None, file_id=fid, include_missing=False)
    assert {r["ticket_id"] for r in rec["items"]} == {"A-1", "A-4", "A-5", "A-6"}
    rec2 = s.jira.reconcile(Filters(start_date=date(2026, 10, 15), end_date=date(2026, 10, 16)))
    assert all(r["ticket_id"] != "A-9" for r in rec2["items"])  # A-9 updated 28 Oct is outside the period


# ---------------------------------------------------------------- API
@pytest.fixture
def jira_client_api(jira_settings, fake_jira, monkeypatch):
    from fastapi.testclient import TestClient
    import app.core.config as cfg
    import app.services.container as container_mod
    for d in (jira_settings.upload_dir, jira_settings.report_dir, jira_settings.status_config_path.parent):
        d.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cfg, "get_settings", lambda: jira_settings)
    container_mod.get_container.cache_clear()
    monkeypatch.setattr(container_mod, "get_settings", lambda: jira_settings)
    from app.main import app as fastapi_app
    with TestClient(fastapi_app) as c:
        yield c
    container_mod.get_container.cache_clear()


def test_jira_api_flow(jira_client_api):
    c = jira_client_api
    st = c.get("/api/v1/jira/connections").json()
    assert st["configured"] is True and st["boards"] == [] and "A" in st["uncovered_projects"]
    t = c.post("/api/v1/jira/connections/test", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"}).json()
    assert t["ok"] and t["board"]["board_name"] == "A Scrum Board" and t["active_sprints"] == ["Sprint 7"]
    b = c.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    assert b.status_code == 200
    bid = b.json()["id"]
    assert c.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"}).status_code == 400
    assert c.get("/api/v1/jira/connections/discover").json()["items"][1]["board_id"] == 922
    assert c.get("/api/v1/jira/connections/me").json()["display_name"] == "Suraj"
    sync = c.post("/api/v1/jira/live/sync").json()
    assert sync["fetched_issues"] >= 8
    rec = c.get("/api/v1/jira/live/reconciliation", params={"preset": "all"}).json()
    assert rec["summary"]["not_found"] == 1 and rec["period"]["label"] == "All data"
    files = c.get("/api/v1/excel/files").json()["items"]
    fid = next(f["file_id"] for f in files if f["file_name"] == "Alice_A-15-10-2026.xlsx")
    frec = c.get(f"/api/v1/jira/live/reconciliation/file/{fid}").json()
    assert frec["summary"]["compared"] == 3
    assert c.get("/api/v1/jira/live/issues/A-1").json()["status"] == "Done"
    assert c.get("/api/v1/jira/live/issues/NOPE-1").status_code == 404
    users = c.get("/api/v1/jira/live/users").json()
    assert len(users["jira_users"]) == 3
    r = c.put("/api/v1/jira/live/user-map", json={"employee": "Carol C", "account_id": "u-zed", "display_name": "Zed Z"})
    assert next(m for m in r.json()["mapping"] if m["employee"] == "Carol C")["match"] == "manual"
    ex = c.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()
    assert ex["jira"]["compared"] == 12 and ex["insights"][0]["title"] == "Excel vs Jira discrepancies"
    assert c.put(f"/api/v1/jira/connections/boards/{bid}", json={"enabled": False}).json()["enabled"] is False
    assert c.delete(f"/api/v1/jira/connections/boards/{bid}").status_code == 200


def test_jira_api_when_not_configured(client):
    st = client.get("/api/v1/jira/connections").json()
    assert st["configured"] is False
    r = client.post("/api/v1/jira/live/sync")
    assert r.status_code == 409 and r.json()["error"] == "jira_not_configured"
    ex = client.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()
    assert ex["jira"] is None
