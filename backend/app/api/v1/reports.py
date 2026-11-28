"""Report Center endpoints."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse

from app.api.auth_deps import managers
from app.api.deps import container, loaded_container, scope_filters
from app.db.base import get_db
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


# ---------------------------------------------------------------- scheduled digests
class ScheduleBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    recipients: List[str]
    cadence: str = "weekly"
    weekday: int = 0
    hour_utc: int = 6
    preset: str = "last_15_days"
    format: str = "pdf"
    report_type: str = "management"
    include_narrative: bool = True
    active: bool = True
    filters: Dict[str, Any] = Field(default_factory=dict)


class SchedulePatch(BaseModel):
    name: Optional[str] = None
    recipients: Optional[List[str]] = None
    cadence: Optional[str] = None
    weekday: Optional[int] = None
    hour_utc: Optional[int] = None
    preset: Optional[str] = None
    format: Optional[str] = None
    report_type: Optional[str] = None
    include_narrative: Optional[bool] = None
    active: Optional[bool] = None
    filters: Optional[Dict[str, Any]] = None


@router.get("/schedules")
async def list_schedules(c: Container = Depends(container), user: User = Depends(managers), db: Session = Depends(get_db)) -> Dict[str, Any]:
    from app.services.schedule_service import CADENCES, FORMATS, PRESETS
    return {"items": c.schedules.list(db, user), "cadences": list(CADENCES), "presets": list(PRESETS), "formats": list(FORMATS),
            "email_enabled": c.email.enabled}


@router.post("/schedules")
async def create_schedule(body: ScheduleBody, c: Container = Depends(container), user: User = Depends(managers), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.schedules.create(db, user, body.model_dump())
    db.commit()
    return out


@router.patch("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: SchedulePatch, c: Container = Depends(container), user: User = Depends(managers),
                          db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.schedules.update(db, user, schedule_id, body.model_dump(exclude_none=True))
    db.commit()
    return out


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, c: Container = Depends(container), user: User = Depends(managers), db: Session = Depends(get_db)) -> Dict[str, Any]:
    c.schedules.delete(db, user, schedule_id)
    db.commit()
    return {"ok": True}


@router.post("/schedules/{schedule_id}/send-now")
async def send_schedule_now(schedule_id: str, c: Container = Depends(container), user: User = Depends(managers), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Builds and sends the digest immediately (also the easiest way to test recipients)."""
    row = c.schedules._get(db, user, schedule_id)
    out = c.schedules.run(db, row, send=True)
    row.last_run_at = __import__("app.db.models", fromlist=["utcnow"]).utcnow()
    db.commit()
    return out


@router.post("/schedules/{schedule_id}/preview")
async def preview_schedule(schedule_id: str, c: Container = Depends(container), user: User = Depends(managers), db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = c.schedules._get(db, user, schedule_id)
    return c.schedules.run(db, row, send=False)
