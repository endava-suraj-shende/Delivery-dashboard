"""Shared fixtures: synthetic bi-weekly template workbooks (no real business data)."""
from __future__ import annotations

import os

os.environ.setdefault("EDD_FAST_HASH", "1")  # cheap Argon2 parameters for the test-suite only

from datetime import date, datetime
from pathlib import Path
from typing import List, Optional

import pytest
from openpyxl import Workbook

from app.core.config import Settings
from app.events.event_bus import EventBus
from app.processors.status_normalizer import StatusNormalizer
from app.services.analytics_service import AnalyticsEngine
from app.services.data_store import InMemoryDataStore
from app.services.excel_service import ExcelService
from app.services.report_service import ReportService


def write_template(
    path: Path,
    employee: str,
    project: str,
    application: str,
    report_date: object,
    board: str = "ALPHA Board",
    work: Optional[List[list]] = None,
    releases: Optional[List[list]] = None,
    notes: Optional[str] = None,
    ticket_header: str = "Jira Ticket ID",
) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "Bi-Weekly Work Update"
    ws.append(["Bi-Weekly Delivery Status & Work Update"])
    ws.append([])
    ws.append(["Date:", report_date, None, "Jira Board:", board, None, "Team Lead:", "Lead Person"])
    ws.append([])
    ws.append(["Employee Information"])
    ws.append(["Employee Name :", employee, None, "Project / Team Name :", project, None, "Application Name :", application])
    ws.append([])
    ws.append(["Work Items & Delivery Tracking"])
    ws.append([])
    ws.append(["Application Name", ticket_header, "Jira Ticket Link", "Work Details", "Work Type", "Work Status",
               "Production Deployment Required?", "Dev Deployment Status", "Additional Comments"])
    for row in work or []:
        ws.append(row)
    ws.append([])
    ws.append(["Production Deployment Summary"])
    ws.append([])
    ws.append(["Application Name", "Production Release Tickets", "Production Release Details", "Production Release Date",
               "Production Deployment Status"])
    for row in releases or []:
        ws.append(row)
    ws.append([])
    ws.append(["Additional Work in the Last 2 Weeks"])
    ws.append([])
    ws.append(["Additional work notes:", notes or ""])
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


def write_flat(path: Path, rows: List[list]) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["Jira TicketID", "Description", "Status", "Environment", "Closing Comments"])
    for r in rows:
        ws.append(r)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


@pytest.fixture
def sample_data_dir(tmp_path: Path) -> Path:
    data = tmp_path / "Data"
    # Employee A: two reports, ticket A-1 moves In Progress -> Completed; A-3 blocked; multi-id cell
    write_template(
        data / "EmpA" / "Alice_A-15-10-2026.xlsx", "Alice A", "Project X", "App1", datetime(2026, 10, 15),
        work=[
            ["App1", "A-1", "https://x/browse/A-1", "Build feature", "Development", "In Progress", "Yes", "Pending", None],
            ["App1", "A-2", None, "Analyse spike", "Analysis", "Completed", "No", "Not Applicable", None],
            ["App1", "A-3", None, "Blocked work", "Development", "Blocked", "Yes", "Pending", "waiting on infra"],
            ["App1", "No Jira", None, "Support task", "Support", "Completed", "No", "Not Applicable", None],
        ],
        notes="Helped onboarding.",
    )
    write_template(
        data / "EmpA" / "Alice_A-30-10-2026.xlsx", "Alice A", "Project X", "App1", datetime(2026, 10, 30),
        work=[
            ["App1", "A-1", None, "Build feature", "Development", "Completed", "Yes", "Deployed", None],
            ["App1", "A-4, A-5", None, "Two tickets one row", "Testing", "In Progress", "No", "Not Applicable", None],
            ["App1", "A-6", None, "Weird status", "Development", "Galactic", "No", "Not Applicable", None],
        ],
        releases=[["App1", "A-1", "Released feature", datetime(2026, 10, 29), "Deployed"],
                  ["App1", "A-2", "Pending release", None, "Pending"]],
    )
    # Employee B: invalid date cell, falls back to file name; duplicate row
    write_template(
        data / "EmpB" / "Bob_B-16-10-2026.xlsx", "Bob B", "Project Y", "App2", "19/15/2026", board="BETA",
        work=[
            ["App2", "B-1", None, "Fix bug", "Bug Fix", "Completed", "Yes", "Deployed", None],
            ["App2", "B-1", None, "Fix bug", "Bug Fix", "Completed", "Yes", "Deployed", None],
            ["App2", "B-2", None, "Docs", "Documentation", "On Hold", "No", "Not Applicable", None],
        ],
        ticket_header="Jira/OS Ticket ID",
    )
    # Employee C: flat layout, no metadata (employee from folder)
    write_flat(data / "Carol_C" / "CarolC- Work Update - 15-10-2026.xlsx", [
        ["IN-100", "Access request", "Done", "Prod", "granted"],
        ["IN-101", "Key rotation", "Inprogress", "Dev", None],
    ])
    # Empty workbook
    wb = Workbook()
    (data / "EmpD").mkdir(parents=True)
    wb.save(data / "EmpD" / "Dan_D-16-10-2026.xlsx")
    return data


@pytest.fixture
def settings(tmp_path: Path, sample_data_dir: Path) -> Settings:
    return Settings(
        data_dir=sample_data_dir,
        upload_dir=tmp_path / "storage" / "uploads",
        report_dir=tmp_path / "storage" / "reports",
        status_config_path=tmp_path / "config" / "status_mapping.json",
        jira_boards_path=tmp_path / "config" / "jira_boards.json",
        jira_user_map_path=tmp_path / "config" / "jira_user_map.json",
        data_source_config_path=tmp_path / "config" / "data_source.json",
        jira_credentials_path=tmp_path / "config" / "jira_credentials.json",
        secret_key_path=tmp_path / "config" / ".secret.key",
        jira_email="",
        jira_api_token="",
        data_source="excel",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        environment="test",
        resend_api_key="",
    )


@pytest.fixture
def services(settings: Settings):
    for d in (settings.upload_dir, settings.report_dir, settings.status_config_path.parent):
        d.mkdir(parents=True, exist_ok=True)
    bus = EventBus()
    normalizer = StatusNormalizer(settings.status_config_path)
    store = InMemoryDataStore(normalizer)
    excel = ExcelService(settings, store, bus)
    engine = AnalyticsEngine(store, normalizer, settings.default_period_days)
    reports = ReportService(settings, engine, bus)
    bus.subscribe("data.loaded", lambda e: engine.invalidate())
    bus.subscribe("config.status_changed", lambda e: (store.renormalize(), engine.invalidate()))
    excel.load_all(force=True, reason="test")
    return type("S", (), {"settings": settings, "bus": bus, "normalizer": normalizer, "store": store, "excel": excel,
                          "engine": engine, "reports": reports})()


def login_as_admin(client) -> None:
    """Create a superuser in the running app and sign the TestClient in (cookie session)."""
    import app.services.container as container_mod
    cont = container_mod.get_container()
    with cont.db() as db:
        cont.auth.create_superuser(db, "admin@endava.com", "Admin", "Admin-Pass-123!")
        db.commit()
    r = client.post("/api/v1/auth/login", json={"email": "admin@endava.com", "password": "Admin-Pass-123!"})
    assert r.status_code == 200, r.text


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch):
    """FastAPI test client wired to the sample data."""
    from fastapi.testclient import TestClient

    import app.core.config as cfg
    import app.services.container as container_mod

    for d in (settings.upload_dir, settings.report_dir, settings.status_config_path.parent):
        d.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cfg, "get_settings", lambda: settings)
    container_mod.get_container.cache_clear()
    monkeypatch.setattr(container_mod, "get_settings", lambda: settings)
    from app.main import app as fastapi_app

    with TestClient(fastapi_app) as c:
        login_as_admin(c)  # existing API tests run as superuser
        yield c
    container_mod.get_container.cache_clear()


@pytest.fixture
def anon(client):
    """Same app, no session cookie."""
    from fastapi.testclient import TestClient
    return TestClient(client.app)


ALL = {"start_date": date(2000, 1, 1).isoformat(), "end_date": date(2100, 1, 1).isoformat()}
