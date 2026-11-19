"""Pydantic schemas shared by the API layer."""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)


class FilterParams(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    employee: Optional[List[str]] = None
    project: Optional[List[str]] = None
    application: Optional[List[str]] = None
    jira_board: Optional[List[str]] = None
    status: Optional[List[str]] = None
    work_type: Optional[List[str]] = None
    dev_deployment: Optional[List[str]] = None
    prod_deployment: Optional[List[str]] = None
    sprint: Optional[List[str]] = None
    search: Optional[str] = None


class PeriodInfo(BaseModel):
    start_date: Optional[date]
    end_date: Optional[date]
    label: str
    days: int
    report_dates: List[date] = Field(default_factory=list)


class DataSourceStatus(BaseModel):
    loaded: bool
    source_dir: str
    file_count: int
    report_count: int
    activity_count: int
    release_count: int
    employee_count: int
    project_count: int
    last_refresh: Optional[str]
    load_duration_ms: Optional[int]
    signature: Optional[str]
    date_min: Optional[date]
    date_max: Optional[date]
    issues_count: int
    uploads: int


class FileInfo(BaseModel):
    file_id: str
    file_name: str
    folder: str
    origin: str
    size_bytes: int
    modified_at: Optional[str]
    sheet_name: Optional[str]
    layout: str
    employee: Optional[str]
    project: Optional[str]
    report_date: Optional[date]
    report_date_source: str
    work_items: int
    releases: int
    issues: int
    ok: bool


class UploadResponse(BaseModel):
    file: FileInfo
    status: DataSourceStatus
    issues: List[Dict[str, Any]]


class ValidateRequest(BaseModel):
    file_id: Optional[str] = None
    sheet_name: Optional[str] = None
    column_overrides: Optional[Dict[str, Dict[str, str]]] = None


class StatusConfigUpdate(BaseModel):
    mappings: Optional[Dict[str, Dict[str, List[str]]]] = None
    latest_status_rule: Optional[str] = None
    count_blank_status_as: Optional[str] = None


class StatusMappingAdd(BaseModel):
    dimension: str
    category: str
    value: str


class ReportRequest(BaseModel):
    report_type: str = Field(..., description="employee | all_employees | project | application | jira_board | jira_status | dev_deployment | prod_deployment | management | team")
    format: str = Field("pdf", description="pdf | xlsx | csv")
    target: Optional[str] = Field(None, description="Employee / project / application / board name when applicable")
    filters: FilterParams = Field(default_factory=FilterParams)


class ReportInfo(BaseModel):
    report_id: str
    report_type: str
    format: str
    file_name: str
    size_bytes: int
    created_at: str
    target: Optional[str]
    period: Optional[str]
