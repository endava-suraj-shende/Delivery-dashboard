"""Analytics engine tests: filtering, unique-ticket counting, latest-status rules, reconciliation, reports."""
from __future__ import annotations

from datetime import date

from app.services.filter_service import Filters, preset_range

ALL = Filters(start_date=date(2000, 1, 1), end_date=date(2100, 1, 1))


def test_store_loaded(services):
    s = services
    assert len(s.store.reports()) == 5
    assert len(s.store.activities()) == 4 + 3 + 3 + 2  # Alice x2, Bob, Carol
    assert len(s.store.releases()) == 2
    assert int(s.store.activities()["is_duplicate"].sum()) == 1  # Bob's duplicated row


def test_unique_ticket_counting_latest_report_rule(services):
    ov = services.engine.overview(ALL, include_prev=False)
    k = ov["kpis"]
    # Tickets: A-1..A-6 (6), B-1, B-2, IN-100, IN-101 => 10 unique; "No Jira" not counted
    assert k["total_tickets"] == 10
    assert k["total_activities"] == 12
    assert k["activities_without_ticket"] == 1
    # A-1 latest (30 Oct) = Completed; A-2 completed; B-1 completed; IN-100 done => 4 completed
    assert k["completed_tickets"] == 4
    assert k["blocked_tickets"] == 1  # A-3
    assert k["on_hold_tickets"] == 1  # B-2
    assert k["other_status_tickets"] == 1  # A-6 'Galactic'
    # In progress: A-4, A-5 (testing counts as in-progress group), IN-101
    assert k["in_progress_tickets"] == 3
    assert k["tickets_changed_status"] == 1  # A-1
    assert k["production_releases"] == 2 and k["production_released"] == 1 and k["production_pending"] == 1
    assert k["dev_deployed"] == 3  # Alice A-1 (30 Oct) + Bob B-1 twice (duplicate row kept, flagged)


def test_kpis_reconcile_with_tables(services):
    ov = services.engine.overview(ALL, include_prev=False)
    k = ov["kpis"]
    assert sum(e["total_activities"] for e in ov["employees"]) == k["total_activities"]
    assert sum(p["total_activities"] for p in ov["projects"]) == k["total_activities"]
    assert sum(k["ticket_status"].values()) == k["total_tickets"]
    assert sum(c["value"] for c in ov["charts"]["ticket_status"]) == k["total_tickets"]
    assert sum(c["value"] for c in ov["charts"]["work_type"]) == k["total_activities"]
    assert sum(t["activities"] for t in ov["charts"]["trend"]) == k["total_activities"]
    # tickets attributed to each employee that reported them: no ticket is shared in sample, so sums match
    assert sum(e["unique_tickets"] for e in ov["employees"]) == k["total_tickets"]


def test_most_advanced_rule_changes_result(services):
    s = services
    # Make A-1 appear completed first then in progress: with latest_report rule it would be in progress.
    s.normalizer.update_config({"latest_status_rule": "most_advanced"})
    s.bus.publish("config.status_changed")
    tickets = s.engine.ticket_table(s.store.activities(), s.store.releases())
    a1 = tickets[tickets["ticket_id"] == "A-1"].iloc[0]
    assert a1["work_status"] == "completed"
    s.normalizer.update_config({"latest_status_rule": "latest_report"})
    s.bus.publish("config.status_changed")


def test_date_filtering_inclusive(services):
    e = services.engine
    f = Filters(start_date=date(2026, 10, 15), end_date=date(2026, 10, 16))
    a, r, reps = e.scope(f)
    # Emp D's empty workbook is still a report (date from file name) but contributes no activities
    assert set(reps["employee"]) == {"Alice A", "Bob B", "Carol C", "Emp D"}
    assert set(a["employee"]) == {"Alice A", "Bob B", "Carol C"}
    assert len(a) == 4 + 3 + 2
    f2 = Filters(start_date=date(2026, 10, 17), end_date=date(2026, 10, 30))
    a2, r2, reps2 = e.scope(f2)
    assert set(reps2["employee"]) == {"Alice A"} and len(a2) == 3
    assert len(r2) == 2  # release dated 29 Oct and the one defaulting to report date 30 Oct
    f3 = Filters(start_date=date(2026, 11, 1), end_date=date(2026, 11, 30))
    assert len(e.scope(f3)[0]) == 0


def test_employee_and_project_filters(services):
    e = services.engine
    a, _, _ = e.scope(Filters(**{**ALL.__dict__, "employee": ["alice a"]}))
    assert set(a["employee"]) == {"Alice A"}
    a, _, _ = e.scope(Filters(**{**ALL.__dict__, "project": ["Project Y"]}))
    assert set(a["employee"]) == {"Bob B"}
    a, _, _ = e.scope(Filters(**{**ALL.__dict__, "status": ["blocked"]}))
    assert list(a["ticket_id"]) == ["A-3"]
    a, _, _ = e.scope(Filters(**{**ALL.__dict__, "search": "spike"}))
    assert list(a["ticket_id"]) == ["A-2"]
    a, _, _ = e.scope(Filters(**{**ALL.__dict__, "ticket": ["a-5"]}))
    assert len(a) == 1 and a.iloc[0]["ticket_ids"] == ["A-4", "A-5"]


def test_ticket_detail_and_history(services):
    d = services.engine.ticket_detail("a-1")
    assert d and d["ticket"]["work_status"] == "completed"
    assert [h["status"] for h in d["ticket"]["status_history"]] == ["in_progress", "completed"]
    assert len(d["activities"]) == 2 and len(d["releases"]) == 1
    assert services.engine.ticket_detail("NOPE-1") is None


def test_insights_and_quality(services):
    ov = services.engine.overview(ALL, include_prev=False)
    titles = {i["title"] for i in ov["insights"]}
    assert "Most completed tickets" in titles and "Most blocked tickets" in titles
    assert "Unmapped statuses" in titles
    dq = services.engine.data_quality()
    s = dq["summary"]
    assert s["duplicates"] == 1 and s["missing_employee"] >= 2 and s["invalid_dates"] >= 1
    assert s["unmapped_statuses"] == 1 and s["activities_without_ticket"] == 1


def test_previous_period_and_compare(services):
    e = services.engine
    c = e.compare(Filters(start_date=date(2026, 10, 1), end_date=date(2026, 10, 20)),
                  Filters(start_date=date(2026, 10, 21), end_date=date(2026, 10, 31)))
    assert c["deltas"]["total_activities"]["a"] == 9 and c["deltas"]["total_activities"]["b"] == 3
    assert c["deltas"]["total_activities"]["delta"] == -6


def test_presets():
    s, e = preset_range("last_15_days", date(2026, 11, 2))
    assert s == date(2026, 10, 19) and e == date(2026, 11, 2)
    s, e = preset_range("previous_month", date(2026, 11, 2))
    assert s == date(2026, 10, 1) and e == date(2026, 10, 31)
    s, e = preset_range("current_week", date(2026, 11, 4))  # Wednesday
    assert s == date(2026, 11, 2) and e == date(2026, 11, 8)


def test_reports_generated_in_all_formats(services):
    r = services.reports
    for fmt in ("pdf", "xlsx", "csv"):
        info = r.generate("management", fmt, ALL)
        assert info["size_bytes"] > 500 and info["file_name"].endswith(fmt)
        assert r.get(info["report_id"])["path"]
    emp = r.generate("employee", "pdf", ALL, target="Alice A")
    assert emp["target"] == "Alice A"
    import pytest
    from app.core.exceptions import ValidationFailedError
    with pytest.raises(ValidationFailedError):
        r.generate("employee", "pdf", ALL)
    with pytest.raises(ValidationFailedError):
        r.generate("nope", "pdf", ALL)


def test_excel_report_sheets(services):
    from openpyxl import load_workbook
    info = services.reports.generate("management", "xlsx", ALL)
    wb = load_workbook(services.reports.get(info["report_id"])["path"])
    assert wb.sheetnames == ["Executive Summary", "Employee Summary", "Project Summary", "Jira Ticket Details",
                             "Development Deployment", "Production Deployment", "Detailed Activities", "Data Quality"]
    ws = wb["Detailed Activities"]
    assert ws.max_row - 1 == 12  # header + 12 activities


def test_refresh_detects_new_file(services, sample_data_dir):
    from tests.conftest import write_template
    from datetime import datetime
    before = len(services.store.reports())
    assert not services.excel.needs_refresh()
    write_template(sample_data_dir / "EmpE" / "Eve_E-30-10-2026.xlsx", "Eve E", "Project X", "App1", datetime(2026, 10, 30),
                   work=[["App1", "E-1", None, "x", "Development", "Completed", "No", "Not Applicable", None]])
    assert services.excel.needs_refresh()
    assert services.excel.refresh_if_changed()
    assert len(services.store.reports()) == before + 1
