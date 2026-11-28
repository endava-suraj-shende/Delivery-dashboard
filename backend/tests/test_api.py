"""API integration tests via FastAPI TestClient."""
from __future__ import annotations

import io
from datetime import datetime

from openpyxl import Workbook

ALL = {"start_date": "2000-01-01", "end_date": "2100-01-01"}


def test_status_and_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["loaded"] is True
    r = client.get("/api/v1/excel/status"); s = r.json()
    assert r.status_code == 200, r.text
    assert s["file_count"] == 5 and s["activity_count"] == 12


def test_executive_dashboard(client):
    r = client.get("/api/v1/dashboard/executive", params=ALL)
    assert r.status_code == 200
    d = r.json()
    assert d["kpis"]["total_tickets"] == 10
    assert d["period"]["label"] == "All data"
    assert d["previous_kpis"] is None
    assert "data_quality" in d and len(d["calculation_rules"]) > 5


def test_default_period_is_30_days(client):
    d = client.get("/api/v1/dashboard/executive").json()
    assert d["period"]["days"] == 30


def test_preset_param(client):
    d = client.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()
    assert d["kpis"]["total_activities"] == 12


def test_employee_endpoints(client):
    r = client.get("/api/v1/employees", params=ALL).json()
    assert {e["employee"] for e in r["items"]} == {"Alice A", "Bob B", "Carol C"}
    assert "Emp D" in r["inactive"]
    s = client.get("/api/v1/employees/alice a/summary", params=ALL)
    assert s.status_code == 200 and s.json()["employee"] == "Alice A"
    assert s.json()["kpis"]["total_tickets"] == 6
    assert client.get("/api/v1/employees/Nobody/summary", params=ALL).status_code == 404
    a = client.get("/api/v1/employees/Alice A/activities", params=ALL).json()
    assert a["total"] == 7
    p = client.get("/api/v1/employees/Alice A/performance", params=ALL).json()
    assert len(p["tickets"]) == 6 and len(p["releases"]) == 2


def test_project_endpoints(client):
    r = client.get("/api/v1/projects", params=ALL).json()
    assert {p["project"] for p in r["items"]} >= {"Project X", "Project Y"}
    s = client.get("/api/v1/projects/Project X/summary", params=ALL).json()
    assert s["project"] == "Project X" and s["kpis"]["total_tickets"] == 6


def test_jira_endpoints(client):
    s = client.get("/api/v1/jira/summary", params=ALL).json()
    assert s["kpis"]["completed_tickets"] == 4
    t = client.get("/api/v1/jira/tickets", params={**ALL, "status": "blocked"}).json()
    assert t["total"] == 1 and t["items"][0]["ticket_id"] == "A-3"
    d = client.get("/api/v1/jira/tickets/A-1").json()
    assert d["ticket"]["has_release"] is True
    assert client.get("/api/v1/jira/tickets/ZZZ-9").status_code == 404


def test_deployment_endpoints(client):
    dev = client.get("/api/v1/deployment/dev/summary", params=ALL).json()
    assert dev["kpis"]["dev_deployed"] == 3
    prod = client.get("/api/v1/deployment/production/summary", params=ALL).json()
    assert prod["kpis"]["production_releases"] == 2 and len(prod["items"]) == 2


def test_search_and_dimensions(client):
    d = client.get("/api/v1/meta/dimensions").json()
    assert "Alice A" in d["employees"] and "Project X" in d["projects"]
    s = client.get("/api/v1/search", params={"q": "a-4"}).json()
    assert s["tickets"][0]["ticket_id"] == "A-4"
    s = client.get("/api/v1/search", params={"q": "bob"}).json()
    assert s["employees"] == ["Bob B"]


def test_config_endpoints_renormalize(client):
    cfg = client.get("/api/v1/config/status").json()
    assert "Galactic" in cfg["unmapped"]["work_status"]
    r = client.post("/api/v1/config/status/mapping", json={"dimension": "work_status", "category": "in_progress", "value": "Galactic"})
    assert r.status_code == 200
    k = client.get("/api/v1/jira/summary", params=ALL).json()["kpis"]
    assert k["other_status_tickets"] == 0 and k["in_progress_tickets"] == 4
    assert client.post("/api/v1/config/status/mapping", json={"dimension": "bogus", "category": "x", "value": "y"}).status_code == 422
    client.post("/api/v1/config/status/reset")
    assert client.get("/api/v1/jira/summary", params=ALL).json()["kpis"]["other_status_tickets"] == 1


def test_excel_files_preview_validate(client):
    files = client.get("/api/v1/excel/files").json()["items"]
    fid = next(f["file_id"] for f in files if f["employee"] == "Alice A")
    assert client.get("/api/v1/excel/sheets", params={"file_id": fid}).json()["sheets"] == ["Bi-Weekly Work Update"]
    prev = client.get("/api/v1/excel/preview", params={"file_id": fid, "limit": 5}).json()
    assert len(prev["rows"]) == 5
    v = client.post("/api/v1/excel/validate", json={"file_id": fid}).json()
    assert v["valid"] and v["work_mapping"]["fields"]["ticket_id"]["header"] == "Jira Ticket ID"
    detail = client.get(f"/api/v1/excel/files/{fid}").json()
    assert detail["metadata"]["employee"] == "Alice A"
    assert client.get("/api/v1/excel/files/nope").status_code == 404


def _workbook_bytes(employee: str) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["Date:", datetime(2026, 10, 30), None, "Jira Board:", "B"])
    ws.append(["Employee Name :", employee, None, "Project / Team Name :", "Project Z", None, "Application Name :", "App9"])
    ws.append(["Application Name", "Jira Ticket ID", "Work Details", "Work Type", "Work Status", "Production Deployment Required?", "Dev Deployment Status"])
    ws.append(["App9", "Z-1", "work", "Development", "Completed", "No", "Deployed"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_upload_remove_and_validation_errors(client):
    r = client.post("/api/v1/excel/upload", files={"file": ("Zed_Z-30-10-2026.xlsx", _workbook_bytes("Zed Z"), "application/octet-stream")})
    assert r.status_code == 200, r.text
    fid = r.json()["file_id"]
    assert r.json()["status"]["uploads"] == 1
    assert "Zed Z" in client.get("/api/v1/meta/dimensions").json()["employees"]
    # bad extension
    assert client.post("/api/v1/excel/upload", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 422
    # not an excel file
    assert client.post("/api/v1/excel/upload", files={"file": ("x.xlsx", b"garbage", "application/octet-stream")}).status_code == 422
    # path traversal in name is neutralised
    r2 = client.post("/api/v1/excel/upload", files={"file": ("..\\..\\evil.xlsx", _workbook_bytes("Evil E"), "application/octet-stream")})
    assert r2.status_code == 200 and "/" not in r2.json()["file_name"] and "\\" not in r2.json()["file_name"]
    # remove
    assert client.delete(f"/api/v1/excel/uploads/{fid}").status_code == 200
    # cannot remove a source-folder file
    src = next(f["file_id"] for f in client.get("/api/v1/excel/files").json()["items"] if f["origin"] == "folder")
    assert client.delete(f"/api/v1/excel/uploads/{src}").status_code == 422
    client.delete("/api/v1/excel/uploads")
    assert client.get("/api/v1/excel/status").json()["uploads"] == 0
    assert len(client.get("/api/v1/excel/history").json()["items"]) >= 3


def test_reports_api(client):
    body = {"report_type": "management", "format": "pdf", "filters": ALL}
    r = client.post("/api/v1/reports/generate", json=body)
    assert r.status_code == 200
    rid = r.json()["report_id"]
    dl = client.get(f"/api/v1/reports/download/{rid}")
    assert dl.status_code == 200 and dl.headers["content-type"] == "application/pdf" and dl.content[:4] == b"%PDF"
    r = client.post("/api/v1/reports/employee", json={"report_type": "employee", "format": "xlsx", "target": "Alice A", "filters": ALL})
    assert r.status_code == 200 and r.json()["format"] == "xlsx"
    assert client.post("/api/v1/reports/generate", json={"report_type": "employee", "format": "pdf", "filters": ALL}).status_code == 422
    assert client.post("/api/v1/reports/generate", json={"report_type": "management", "format": "docx", "filters": ALL}).status_code == 422
    assert client.get("/api/v1/reports/download/nope").status_code == 404
    assert len(client.get("/api/v1/reports").json()["items"]) >= 2
    assert client.get("/api/v1/reports/types").json()["formats"] == ["pdf", "xlsx", "csv"]


def test_compare_and_quality_endpoints(client):
    c = client.get("/api/v1/dashboard/compare", params={"a_start": "2026-10-01", "a_end": "2026-10-20", "b_start": "2026-10-21", "b_end": "2026-10-31"})
    assert c.status_code == 200 and c.json()["deltas"]["total_activities"]["delta"] == -6
    assert client.get("/api/v1/dashboard/compare", params={"a_start": "x", "a_end": "y", "b_start": "z", "b_end": "w"}).status_code == 422
    q = client.get("/api/v1/dashboard/data-quality", params={"scope": "all"}).json()
    assert q["summary"]["total_issues"] > 0 and len(q["issues"]) == q["summary"]["total_issues"]


def test_request_validation_error_shape(client):
    r = client.get("/api/v1/dashboard/executive", params={"start_date": "not-a-date"})
    assert r.status_code == 422 and r.json()["error"] == "request_validation"


def test_employee_counts_follow_board_filter(client):
    """Total / inactive employee counts and the roster are scoped to the selected board, not all boards."""
    dims = client.get("/api/v1/meta/dimensions").json()
    boards = dims["jira_boards"]
    assert len(boards) >= 2
    all_k = client.get("/api/v1/dashboard/executive", params=ALL).json()["kpis"]
    one = client.get("/api/v1/dashboard/executive", params={**ALL, "jira_board": boards[0]}).json()["kpis"]
    assert one["total_employees"] < all_k["total_employees"]
    assert one["total_employees"] == one["active_employees"] + one["inactive_employees"]
    lst = client.get("/api/v1/employees", params={**ALL, "jira_board": boards[0]}).json()
    assert len(lst["all"]) == one["total_employees"] and set(lst["inactive"]) <= set(lst["all"])
    # the Employee filter options follow the board too
    scoped = client.get("/api/v1/meta/dimensions", params={"jira_board": boards[0]}).json()
    assert set(scoped["employees"]) == set(lst["all"]) and len(scoped["employees"]) < len(dims["employees"])
    assert scoped["jira_boards"] == dims["jira_boards"]  # board list itself stays complete


def test_narrative_endpoints(client):
    r = client.get("/api/v1/dashboard/narrative", params=ALL)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["headline"] and d["paragraphs"][0]["kind"] == "headline"
    assert str(d["facts"]["completed"]) in d["headline"]
    assert isinstance(d["flags"], list) and all({"code", "severity", "text"} <= set(fl) for fl in d["flags"])
    name = client.get("/api/v1/employees", params=ALL).json()["items"][0]["employee"]
    e = client.get(f"/api/v1/employees/{name}/narrative", params=ALL).json()
    assert e["scope"] == name and any(p["kind"] == "people" for p in e["paragraphs"])


def test_tickets_pagination_and_compact(client):
    full = client.get("/api/v1/jira/tickets", params={**ALL, "compact": "false"}).json()
    page = client.get("/api/v1/jira/tickets", params={**ALL, "page": 1, "page_size": 2}).json()
    assert page["total"] == full["total"] and len(page["items"]) == min(2, full["total"]) and page["page_size"] == 2
    if full["items"]:
        assert "report_count" in full["items"][0] and "report_count" not in page["items"][0]
        assert "work_status_raw" in page["items"][0]


def test_report_history_persists_and_is_scoped(client):
    r = client.post("/api/v1/reports/management", json={"report_type": "management", "format": "csv", "filters": ALL})
    assert r.status_code == 200, r.text
    rid = r.json()["report_id"]
    items = client.get("/api/v1/reports").json()["items"]
    assert any(i["report_id"] == rid for i in items) and items[0]["created_by"]
    # survives a new ReportService instance (DB-backed registry)
    import app.services.container as cm
    from app.services.report_service import ReportService
    cont = cm.get_container()
    fresh = ReportService(cont.settings, cont.analytics, cont.bus, db_factory=cont.db)
    assert fresh.get(rid)["report_id"] == rid


def test_schedule_digest_lifecycle(client, monkeypatch):
    from datetime import timedelta
    import app.services.container as cm
    from app.db.models import ReportSchedule, utcnow
    from app.services.schedule_service import next_run
    # next_run: weekly Monday 06:00 from a Wednesday -> following Monday; fortnightly lands on an even ISO week
    from datetime import datetime
    wed = datetime(2026, 11, 25, 12, 0)
    assert next_run(wed, "weekly", 0, 6) == datetime(2026, 11, 30, 6, 0)
    assert next_run(wed, "fortnightly", 0, 6).isocalendar()[1] % 2 == 0
    assert next_run(wed, "daily", 0, 6) == datetime(2026, 11, 26, 6, 0)

    body = {"name": "Weekly OCS digest", "recipients": ["pm@endava.com", "client@partner.example"], "cadence": "weekly",
            "weekday": 0, "hour_utc": 6, "preset": "last_30_days", "format": "csv"}
    assert client.post("/api/v1/reports/schedules", json=body).status_code == 400  # csv is not a digest format
    body["format"] = "pdf"
    r = client.post("/api/v1/reports/schedules", json=body)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert r.json()["next_run_at"] and r.json()["owner"]["email"] == "admin@endava.com"
    assert any(i["id"] == sid for i in client.get("/api/v1/reports/schedules").json()["items"])

    prev = client.post(f"/api/v1/reports/schedules/{sid}/preview").json()
    assert prev["sent"] is False and prev["paragraphs"] and prev["attachment"].endswith(".pdf")

    cont = cm.get_container()
    captured = {}
    monkeypatch.setattr(cont.email, "send", lambda to, subject, html_body, text_body, attachments=None: captured.update(
        to=to, subject=subject, attachments=attachments) or {"sent": True, "id": "x"})
    with cont.db() as db:
        row = db.get(ReportSchedule, sid)
        row.next_run_at = utcnow() - timedelta(minutes=1)
        db.commit()
        assert cont.schedules.run_due(db) == 1
        row = db.get(ReportSchedule, sid)
        assert row.last_status == "sent" and row.next_run_at > utcnow()
    assert captured["to"] == ["pm@endava.com", "client@partner.example"] and captured["attachments"][0][0].endswith(".pdf")
    assert "digest" in captured["subject"].lower()

    pr = client.patch(f"/api/v1/reports/schedules/{sid}", json={"active": False})
    assert pr.status_code == 200, pr.text
    assert pr.json()["next_run_at"] is None
    assert client.delete(f"/api/v1/reports/schedules/{sid}").json()["ok"] is True
    assert not any(i["id"] == sid for i in client.get("/api/v1/reports/schedules").json()["items"])


def test_forecast_endpoint_shapes(client):
    r = client.get("/api/v1/dashboard/forecast", params={**ALL, "target_date": "2030-01-01"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["history"]["weeks"] == 8 and d["runs"] == 10000 and d["confidence"] in ("good", "fair", "low")
    # the sample workbooks hold ~12 activities: not enough history -> an explicit note, never a fake number
    if d["confidence"] == "low":
        assert d["note"] and d["completion"] is None
    else:
        assert d["completion"]["percentiles"][0]["p"] == 50 and d["by_date"]["date"] == "2030-01-01"
    r2 = client.get("/api/v1/dashboard/forecast", params={**ALL, "remaining": 0})
    assert r2.json()["remaining"] == 0
