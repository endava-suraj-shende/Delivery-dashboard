"""Typed response contracts for the most-used endpoints.

Models declare the stable, documented part of each payload and allow extra keys (``extra="allow"``) so that
additive analytics fields never break clients, while removing or renaming a declared field fails tests here first.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------------- shared
class Period(_Open):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    label: str
    days: int
    report_count: int = 0


class FilterEcho(_Open):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    employee: List[str] = Field(default_factory=list)
    project: List[str] = Field(default_factory=list)
    jira_board: List[str] = Field(default_factory=list)
    sprint: List[str] = Field(default_factory=list)
    status: List[str] = Field(default_factory=list)


class Kpis(_Open):
    total_employees: int
    active_employees: int
    total_tickets: int
    completed_tickets: int
    in_progress_tickets: int
    pending_tickets: int
    blocked_tickets: int
    other_status_tickets: int = 0
    completion_rate: Optional[float] = None
    production_releases: int = 0
    production_released: int = 0
    production_pending: int = 0
    dev_deployed: int = 0
    dev_pending: int = 0


class Insight(_Open):
    type: str
    title: str
    detail: str
    value: Any = None
    link: Optional[Dict[str, str]] = None


# ---------------------------------------------------------------- auth
class UserOut(_Open):
    id: str
    email: str
    name: str
    role: str
    is_superuser: bool = False
    demo_mode: bool = False
    demo_only: bool = False
    status: str
    must_change_password: bool = False
    board_ids: List[str] = Field(default_factory=list)  # board config ids, not Jira board numbers
    board_count: Optional[int] = None
    access_expires_at: Optional[str] = None


class SessionOut(BaseModel):
    user: Optional[UserOut] = None


class SsoInfo(BaseModel):
    enabled: bool
    label: str
    login_url: Optional[str] = None
    local_login: bool = True


class AuthOptions(_Open):
    roles: List[Dict[str, str]]
    allowed_domains: List[str]
    email_enabled: bool
    password_rules: str
    code_roles: List[str]
    guest_days: int
    sso: SsoInfo


# ---------------------------------------------------------------- dashboards
class Overview(_Open):
    period: Period
    filters: FilterEcho
    kpis: Kpis
    previous_kpis: Optional[Kpis] = None
    charts: Dict[str, Any]
    insights: List[Insight]
    employees: List[Dict[str, Any]]
    projects: List[Dict[str, Any]]
    source: Optional[str] = None


class EmployeeRow(_Open):
    employee: str
    unique_tickets: int
    completed: int
    in_progress: int
    pending: int
    blocked: int
    completion_rate: Optional[float] = None
    carried_in: int = 0
    new_in_period: int = 0
    avg_cycle_days: Optional[float] = None
    overdue: int = 0


class EmployeesOut(_Open):
    period: Period
    items: List[EmployeeRow]
    inactive: List[str] = Field(default_factory=list)
    all: List[str] = Field(default_factory=list)
    team: Optional[Dict[str, Any]] = None
    source: Optional[str] = None


class TicketRow(_Open):
    ticket_id: str
    work_status: Optional[str] = None
    work_type: Optional[str] = None
    employee: Optional[str] = None
    project: Optional[str] = None
    jira_board: Optional[str] = None
    sprint: Optional[str] = None
    last_seen: Optional[str] = None
    overdue: Optional[bool] = None
    blocked_since: Optional[str] = None


class TicketsOut(_Open):
    total: int
    items: List[TicketRow]
    page: Optional[int] = None
    page_size: Optional[int] = None
    filters: Optional[FilterEcho] = None


class SprintSummary(_Open):
    name: str
    state: Optional[str] = None
    tickets: int = 0
    completed: int = 0
    blocked: int = 0
    employees: int = 0
    completed_share: Optional[float] = None


class SprintsOut(_Open):
    items: List[SprintSummary]
    active: Optional[str] = None
    source: Optional[str] = None
    velocity: Optional[Dict[str, Any]] = None


class NarrativeFlag(BaseModel):
    code: str
    severity: str
    text: str
    value: Any = None
    link: Optional[Dict[str, str]] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class NarrativeParagraph(BaseModel):
    kind: str
    text: str


class NarrativeOut(_Open):
    period: Period
    scope: str
    headline: str
    paragraphs: List[NarrativeParagraph]
    flags: List[NarrativeFlag]
    facts: Dict[str, Any]
    generated_at: str


class HealthOut(BaseModel):
    status: str
    database: bool
    loaded: bool
    version: int
    app_version: str


class ReportInfoOut(_Open):
    report_id: str
    report_type: str
    format: str
    file_name: str
    size_bytes: int
    created_at: str
    target: Optional[str] = None
    period: Optional[str] = None
    created_by: Optional[str] = None


class ReportListOut(BaseModel):
    items: List[ReportInfoOut]


class ScheduleOut(_Open):
    id: str
    owner_id: str
    name: str
    report_type: str
    format: str
    filters: Dict[str, Any]
    preset: str
    cadence: str
    weekday: int
    hour_utc: int
    recipients: List[str]
    include_narrative: bool
    active: bool
    last_run_at: Optional[str] = None
    last_status: Optional[str] = None
    next_run_at: Optional[str] = None
    created_at: str
    owner: Optional[Dict[str, str]] = None


class ScheduleListOut(BaseModel):
    items: List[ScheduleOut]
    cadences: List[str]
    presets: List[str]
    formats: List[str]
    email_enabled: bool
