"""API integration tests via FastAPI TestClient."""
from __future__ import annotations

import io
from datetime import datetime

from openpyxl import Workbook

ALL = {"start_date": "2000-01-01", "end_date": "2100-01-01"}


def test_status_and_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["loaded"] is True
    s = client.get("/api/v1/excel/status").json()
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
