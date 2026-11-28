"""Report Center endpoints."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.api.auth_deps import managers
from app.api.deps import loaded_container, scope_filters
from app.db.models import User
from app.schemas.common import ReportRequest
from app.services.container import Container
from app.services.filter_service import Filters
from app.services.report_service import REPORT_TYPES

router = APIRouter(prefix="/reports", tags=["Reports"], dependencies=[Depends(managers)])

MEDIA = {"pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "csv": "text/csv"}


def _filters(body: ReportRequest, c: Container, user: User) -> Filters:
    return scope_filters(Filters.from_query(**body.filters.model_dump()), c, user)


@router.get("/types")
async def types() -> Dict[str, Any]:
    return {"items": [{"key": k, "label": v, "requires_target": k in ("employee", "project", "application", "jira_board")}
                      for k, v in REPORT_TYPES.items()], "formats": list(MEDIA)}


@router.post("/generate")
async def generate(body: ReportRequest, c: Container = Depends(loaded_container), user: User = Depends(managers)) -> Dict[str, Any]:
    return c.reports.generate(body.report_type, body.format, _filters(body, c, user), body.target, created_by=user.id)


@router.post("/employee")
async def employee_report(body: ReportRequest, c: Container = Depends(loaded_container), user: User = Depends(managers)) -> Dict[str, Any]:
    return c.reports.generate("employee" if body.target else "all_employees", body.format, _filters(body, c, user), body.target, created_by=user.id)


@router.post("/team")
async def team_report(body: ReportRequest, c: Container = Depends(loaded_container), user: User = Depends(managers)) -> Dict[str, Any]:
    return c.reports.generate("team", body.format, _filters(body, c, user), None, created_by=user.id)


@router.post("/project")
async def project_report(body: ReportRequest, c: Container = Depends(loaded_container), user: User = Depends(managers)) -> Dict[str, Any]:
    return c.reports.generate("project", body.format, _filters(body, c, user), body.target, created_by=user.id)


@router.post("/management")
async def management_report(body: ReportRequest, c: Container = Depends(loaded_container), user: User = Depends(managers)) -> Dict[str, Any]:
    return c.reports.generate("management", body.format, _filters(body, c, user), None, created_by=user.id)


@router.get("")
async def list_reports(c: Container = Depends(loaded_container), user: User = Depends(managers)) -> Dict[str, Any]:
    # delivery managers see their own history; admins see everyone's
    return {"items": c.reports.list(created_by=None if user.role == "admin" else user.id)}


@router.get("/download/{report_id}")
async def download(report_id: str, c: Container = Depends(loaded_container), user: User = Depends(managers)) -> FileResponse:
    info = c.reports.get(report_id)
    if user.role != "admin" and info.get("created_by") not in (None, user.id):
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Report not found or expired")
    return FileResponse(info["path"], media_type=MEDIA[info["format"]], filename=info["file_name"])
