"""Jira boards as the primary data source (uses the FakeJira transport from test_jira)."""
from __future__ import annotations

from datetime import date

import pytest

from app.services.filter_service import Filters
from tests.test_jira import fake_jira, jira_settings  # noqa: F401  (fixtures)

ALL = Filters(start_date=date(2000, 1, 1), end_date=date(2100, 1, 1))


@pytest.fixture
def jira_mode(jira_settings, fake_jira, monkeypatch):  # noqa: F811
    jira_settings.data_source = "auto"
    from fastapi.testclient import TestClient
    import app.core.config as cfg
    import app.services.container as container_mod
    for d in (jira_settings.upload_dir, jira_settings.report_dir, jira_settings.status_config_path.parent):
        d.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cfg, "get_settings", lambda: jira_settings)
    container_mod.get_container.cache_clear()
    monkeypatch.setattr(container_mod, "get_settings", lambda: jira_settings)
    from app.main import app as fastapi_app
    from tests.conftest import login_as_admin
    with TestClient(fastapi_app) as c:
        login_as_admin(c)
        yield c, container_mod.get_container()
    container_mod.get_container.cache_clear()


def test_auto_mode_switches_to_jira_when_board_added(jira_mode):
    client, c = jira_mode
    assert c.data.mode == "excel"  # no boards yet -> Excel
    assert client.get("/api/v1/data/source").json()["source"] == "excel"
    client.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    assert c.data.mode == "jira"
    st = client.post("/api/v1/data/reload").json()
    assert st["source"] == "jira" and st["jira"]["issues"] == 6 and st["jira"]["boards"] == ["A Scrum Board"]
    a = c.store.activities()
    # A-1: created + 3 transitions = 4; A-2: 2 (+1 snapshot at later update); A-3: 2; A-4/A-5: created + snapshot = 2 each; A-9: 2
    assert len(a) == 15
    assert set(a["employee"]) == {"Alice A", "B Bob", "Unassigned"}
    assert set(a["project"]) == {"Team Alpha"}
    assert a[a["ticket_id"] == "A-1"]["application"].iloc[0] == "App1"
    assert a[a["ticket_id"] == "A-2"]["application"].iloc[0] == "Project A"  # fallback: project name
    a1 = a[a["ticket_id"] == "A-1"].sort_values("report_date")
    assert list(a1["work_status_raw"]) == ["Backlog", "In Dev", "In QA", "Done"]
    assert list(a1["work_status"]) == ["pending", "development", "testing", "completed"]
    assert list(a1["dev_deployment"]) == ["pending", "deployed", "deployed", "deployed"]
    assert list(a1["report_date"].dt.date) == [date(2026, 10, 1), date(2026, 10, 10), date(2026, 10, 20), date(2026, 10, 29)]
    assert a[a["ticket_id"] == "A-2"]["work_type"].iloc[0] == "analysis"  # Spike
    assert a[a["ticket_id"] == "A-3"]["work_type"].iloc[0] == "bug_fix"
    # carried-over ticket: work is attributed to the sprint whose window contains the day
    assert list(a1["sprint"]) == ["Sprint 6", "Sprint 6", "Sprint 7", "Sprint 7"]
    assert "Sprint: Sprint 7" in a1["comments"].iloc[-1]
    assert set(a[a["ticket_id"] == "A-2"]["sprint"]) == {"Sprint 7"}
    r = c.store.releases()
    assert len(r) == 1 and r.iloc[0]["ticket_id"] == "A-1" and r.iloc[0]["prod_deployment"] == "released"
    assert r.iloc[0]["release_date"].date() == date(2026, 10, 29)


def test_jira_mode_dashboards_and_rules(jira_mode):
    client, c = jira_mode
    client.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    client.post("/api/v1/data/reload")
    ex = client.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()
    assert ex["source"] == "jira" and ex["jira"] is None  # Excel-vs-Jira comparison is off in Jira mode
    assert ex["kpis"]["total_tickets"] == 6 and ex["kpis"]["completed_tickets"] == 2
    assert ex["kpis"]["production_releases"] == 1
    assert "changelog" in ex["calculation_rules"][0]
    emp = client.get("/api/v1/employees/Alice A/summary", params={"preset": "all"}).json()
    assert emp["kpis"]["total_tickets"] == 4  # A-1, A-2, A-5, A-9
    t = client.get("/api/v1/jira/tickets/A-1").json()
    assert [h["status"] for h in t["ticket"]["status_history"]] == ["pending", "development", "testing", "completed"]
    rep = client.post("/api/v1/reports/generate", json={"report_type": "management", "format": "xlsx", "filters": {"start_date": "2000-01-01", "end_date": "2100-01-01"}})
    assert rep.status_code == 200


def test_switch_mode_and_both(jira_mode):
    client, c = jira_mode
    client.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    st = client.put("/api/v1/data/source", json={"mode": "excel"}).json()
    assert st["source"] == "excel" and st["activity_count"] == 12 and st["jira"] is None
    st = client.put("/api/v1/data/source", json={"mode": "both", "lookback_days": 90}).json()
    assert st["source"] == "both" and st["activity_count"] == 27 and st["lookback_days"] == 90
    # 10 Excel tickets + A-9 (Jira only); A-1..A-5 appear in both sources but count once
    assert client.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()["kpis"]["total_tickets"] == 11
    assert client.put("/api/v1/data/source", json={"mode": "bogus"}).status_code == 422
    st = client.put("/api/v1/data/source", json={"mode": "jira"}).json()
    assert st["source"] == "jira"
    # history records the source of each load
    hist = client.get("/api/v1/excel/history").json()["items"]
    assert hist[0]["source"] == "jira" and any(h["source"] == "both" for h in hist)


def test_jira_mode_without_credentials_falls_back_to_excel(client):
    st = client.get("/api/v1/data/source").json()
    assert st["source"] == "excel" and st["jira_available"] is False


def test_board_credentials_encrypted_and_people_filter(settings, fake_jira, monkeypatch):
    """Credentials entered in the UI are stored encrypted and the people mapping limits the loaded data."""
    import json
    from fastapi.testclient import TestClient
    import app.core.config as cfg
    import app.services.container as container_mod
    settings.data_source = "auto"
    for d in (settings.upload_dir, settings.report_dir, settings.status_config_path.parent):
        d.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cfg, "get_settings", lambda: settings)
    container_mod.get_container.cache_clear()
    monkeypatch.setattr(container_mod, "get_settings", lambda: settings)
    from app.main import app as fastapi_app
    from tests.conftest import login_as_admin
    with TestClient(fastapi_app) as client:
        login_as_admin(client)
        assert client.get("/api/v1/jira/connections/credentials").json()["configured"] is False
        # add a board with its own credentials (no default credentials at all)
        r = client.post("/api/v1/jira/connections/boards", json={
            "url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921", "email": "me@x.com", "token": "board-secret"})
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        assert r.json()["credential_source"] == "ui" and "token" not in r.json() and "token_enc" not in r.json()
        # persisted in the database (jira_boards.config) with the token encrypted
        import sqlite3
        db_path = settings.database_url.replace("sqlite:///", "", 1)
        rows = sqlite3.connect(db_path).execute("select config from jira_boards").fetchall()
        raw = json.loads(rows[0][0])
        assert raw["token_enc"].startswith("enc:") and "board-secret" not in rows[0][0]
        # the credentials used for the first board are remembered as the default for the next ones
        creds = client.get("/api/v1/jira/connections/credentials").json()
        assert creds["configured"] is True and creds["source"] == "ui" and creds["email"] == "me@x.com"
        settings_rows = sqlite3.connect(db_path).execute("select value from app_settings where key='jira_default_credentials'").fetchall()
        assert settings_rows and "board-secret" not in settings_rows[0][0]
        st = client.post("/api/v1/data/reload").json()
        assert st["source"] == "jira" and st["employee_count"] == 3
        # people mapping: only Alice
        a = client.get(f"/api/v1/jira/connections/boards/{bid}/assignees").json()
        assert set(a["assignees"]) == {"Alice A", "B Bob", "Unassigned"}
        client.put(f"/api/v1/jira/connections/boards/{bid}", json={"people": ["Alice A"]})
        st = client.post("/api/v1/data/reload").json()
        assert st["employee_count"] == 1
        assert set(client.get("/api/v1/meta/dimensions").json()["employees"]) == {"Alice A"}
        k = client.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()["kpis"]
        assert k["total_employees"] == 1 and k["inactive_employees"] == 0  # roster = people mapped on the board
        # default credentials via UI, encrypted
        c = client.put("/api/v1/jira/connections/credentials", json={"email": "default@x.com", "token": "default-secret"}).json()
        assert c["configured"] and c["source"] == "ui" and c["token_masked"].endswith("cret")
        settings_rows = sqlite3.connect(db_path).execute("select value from app_settings where key='jira_default_credentials'").fetchall()
        assert "default-secret" not in settings_rows[0][0]
    container_mod.get_container.cache_clear()


def test_sprint_catalogue_and_sprint_scoped_performance(jira_mode):
    """Sprints come from the board + issue sprint field; a sprint view uses the sprint's own window."""
    client, c = jira_mode
    client.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    client.post("/api/v1/data/reload")
    assert client.get("/api/v1/meta/dimensions").json()["sprints"] == ["Sprint 6", "Sprint 7"]
    lst = client.get("/api/v1/sprints").json()
    assert lst["active"] == "Sprint 7"
    by = {s["name"]: s for s in lst["items"]}
    assert by["Sprint 7"]["state"] == "active" and by["Sprint 7"]["start_date"] == "2026-10-20"
    assert by["Sprint 6"]["state"] == "closed" and by["Sprint 6"]["complete_date"] == "2026-10-19"
    # A-1 has work in both sprints (carried over); every other issue is Sprint 7 only
    assert by["Sprint 6"]["tickets"] == 1 and by["Sprint 6"]["completed"] == 0
    assert by["Sprint 7"]["tickets"] == 6 and by["Sprint 7"]["completed"] == 2  # A-1 Done, A-5 Done
    # velocity: every fake issue carries 3 story points -> committed 18 / completed 6 in Sprint 7, chronological order
    v = lst["velocity"]
    assert v["unit"] == "points" and [s["name"] for s in v["items"]] == ["Sprint 6", "Sprint 7"]
    assert v["items"][1]["committed"] == 18.0 and v["items"][1]["completed"] == 6.0
    assert v["items"][0]["committed"] == 3.0 and v["items"][0]["completed"] == 0.0 and v["average_completed"] == 0.0
    # global date range is ignored for the sprint table, other filters apply; empty closed sprints are dropped
    narrow = client.get("/api/v1/sprints", params={"start_date": "2026-10-01", "end_date": "2026-10-02", "employee": "B Bob"}).json()
    assert {s["name"]: s["tickets"] for s in narrow["items"]} == {"Sprint 7": 1}
    # detail is scoped to the sprint window, previous sprint is exposed for comparison
    d = client.get("/api/v1/sprints/sprint 7").json()
    assert d["sprint"]["name"] == "Sprint 7" and d["previous_sprint"]["name"] == "Sprint 6"
    assert d["period"]["start_date"] == "2026-10-20" and d["filters"]["sprint"] == ["Sprint 7"]
    assert d["kpis"]["total_tickets"] == 6 and {t["ticket_id"] for t in d["tickets"]} >= {"A-1", "A-5"}
    assert client.get("/api/v1/sprints/nope").status_code == 404
    # a board filter hides sprints that belong to other boards
    assert client.get("/api/v1/sprints", params={"jira_board": "Some Other Board"}).json()["items"] == []
    assert len(client.get("/api/v1/sprints", params={"jira_board": "A Scrum Board"}).json()["items"]) == 2
    # the sprint filter works on every endpoint
    ov = client.get("/api/v1/dashboard/executive", params={"preset": "all", "sprint": "Sprint 6"}).json()
    assert ov["kpis"]["total_tickets"] == 1 and ov["kpis"]["total_activities"] == 2


def test_delivery_performance_rating(jira_mode):
    """On-time delivery from due dates / sprint end, score + rating bands, team status, individual metric table."""
    client, c = jira_mode
    client.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    client.post("/api/v1/data/reload")
    tk = {t["ticket_id"]: t for t in client.get("/api/v1/jira/tickets", params={"preset": "all"}).json()["items"]}
    assert tk["A-1"]["due_date"].startswith("2026-10-30") and tk["A-1"]["on_time"] is True       # resolved 10-29 <= due 10-30
    assert tk["A-5"]["late"] is True                                                            # completed 10-01 > due 09-30
    assert tk["A-3"]["overdue"] is True and tk["A-3"]["on_time"] is False                       # blocked, due 10-01
    assert tk["A-2"]["due_source"] == "sprint" and tk["A-2"]["due_date"].startswith("2026-11-02")  # no Jira due -> sprint end
    perf = client.get("/api/v1/employees/performance", params={"preset": "all"}).json()
    rows = {r["employee"]: r for r in perf["items"]}
    alice, bob = rows["Alice A"], rows["B Bob"]
    assert alice["on_time"] == 1 and alice["late"] == 1 and alice["overdue"] == 2 and alice["on_time_pct"] == 25.0  # A-2 / A-9 open past sprint end
    assert alice["score"] is not None and alice["rating"] in {"excellent", "good", "needs_improvement", "at_risk"}
    # Bob: 1 ticket, blocked and overdue -> at risk by the hard rule
    assert bob["blocked"] == 1 and bob["overdue"] == 1 and bob["rating"] == "at_risk" and "blocked_share" in bob["risk_flags"]
    team = perf["team"]
    assert team["rating"] in {b["key"] for b in perf["bands"]} and sum(d["value"] for d in team["distribution"]) >= 2
    assert team["at_risk"] == ["B Bob"] and perf["performance_rules"]
    # individual metric table (current vs previous)
    ind = client.get("/api/v1/employees/Alice A/performance", params={"preset": "all"}).json()["performance"]
    keys = [m["key"] for m in ind["metrics"]]
    assert {"unique_tickets", "completed", "in_progress", "code_review", "testing_tickets", "blocked", "dev_deployed", "production_released"} <= set(keys)
    assert ind["current"]["employee"] == "Alice A" and ind["current"]["rating_label"]
    # list endpoint carries the rating too
    lst = client.get("/api/v1/employees", params={"preset": "all"}).json()
    assert lst["team"]["score"] == team["score"] and all("rating" in e for e in lst["items"])


def test_employee_flow_metrics_and_weekly_timeline(jira_mode):
    """Carried-in vs new tickets, cycle time and the per-week assigned/completed series behind the employee table."""
    client, c = jira_mode
    client.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921"})
    client.post("/api/v1/data/reload")
    # period starting after A-1's first activity (created 10-01) -> A-1 is carried in for Alice, others are new
    ov = client.get("/api/v1/dashboard/executive", params={"start_date": "2026-10-05", "end_date": "2026-11-30"}).json()
    alice = next(e for e in ov["employees"] if e["employee"] == "Alice A")
    assert alice["carried_in"] >= 1 and alice["carried_in"] + alice["new_in_period"] == alice["unique_tickets"]
    assert alice["completed_pct"] == round(100.0 * alice["completed"] / alice["unique_tickets"], 1)
    assert alice["avg_cycle_days"] is not None and alice["team_avg_cycle_days"] is not None
    tk = {t["ticket_id"]: t for t in client.get("/api/v1/jira/tickets", params={"preset": "all"}).json()["items"]}
    assert tk["A-1"]["cycle_days"] == 28  # created 10-01 -> Done 10-29
    # weekly timeline is computed on demand (not part of the overview payload any more)
    from datetime import date as _d
    from app.services.filter_service import Filters as _F
    f = _F(start_date=_d(2026, 10, 5), end_date=_d(2026, 11, 30))
    a, r, _ = c.analytics.scope(f)
    wk = c.analytics.weekly_by_employee(a, c.analytics.ticket_table(a, r), f)
    assert wk["weeks"] and wk["weeks"][0] <= "2026-10-05"
    row = next(e for e in wk["employees"] if e["employee"] == "Alice A")
    assert len(row["weeks"]) == len(wk["weeks"]) and row["total_completed"] == alice["completed"]
    assert any(c["new"] > 0 for c in row["weeks"]) and sum(c["completed"] for c in row["weeks"]) == alice["completed"]
