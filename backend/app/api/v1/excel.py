"""Excel data management endpoints."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel

from app.api.auth_deps import active_user, workspace
from app.api.auth_deps import workspace as _ws, workspace_db
from app.api.deps import container, loaded_container
from app.core.exceptions import NotFoundError
from app.db.base import get_db
from app.db.models import ROLE_EMPLOYEE, ExcelUpload, ExcelUploadRow, User, utcnow
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.schemas.common import ValidateRequest
from app.services.container import Container

router = APIRouter(prefix="/excel", tags=["Excel Management"])


def _owners(c: Container) -> Dict[str, str]:
    return dict(c.upload_owners.read() or {}) if getattr(c, "upload_owners", None) is not None else {}


def _visible_files(c: Container, user: User) -> List[Dict[str, Any]]:
    """Employees only see the workbooks they uploaded themselves; everyone else sees all files with the uploader name."""
    owners = _owners(c)
    names: Dict[str, str] = {}
    if owners:
        from sqlalchemy import select
        with c.db() as db:
            names = {u.id: u.name for u in db.execute(select(User).where(User.id.in_(set(owners.values())))).scalars().all()}
    items = []
    for f in c.excel.files():
        owner = owners.get(f["file_name"]) if f.get("origin") == "upload" else None
        if user.role == ROLE_EMPLOYEE and owner != user.id:
            continue
        items.append({**f, "uploaded_by": names.get(owner) if owner else None, "own": owner == user.id})
    return items


def _check_file(c: Container, user: User, file_id: str) -> None:
    if user.role == ROLE_EMPLOYEE and not any(f["file_id"] == file_id for f in _visible_files(c, user)):
        raise NotFoundError(f"File '{file_id}' not found")


def _persist_upload(c: Container, db: Session, user: User, result: Dict[str, Any]) -> Optional[ExcelUpload]:
    """Record the uploaded workbook and its ticket rows in the database for the uploader's own view.

    The workbook is parsed directly from disk so this works in every data-source mode (in Jira mode uploaded
    files are not part of the in-memory store)."""
    from app.processors.excel_reader import read_workbook
    from app.utils.text import clean_text
    name = result.get("file_name")
    if not name:
        return None
    path = c.settings.upload_dir / name
    if not path.exists():
        return None
    try:
        rep = c.excel.parser.parse(read_workbook(path))
    except Exception:  # noqa: BLE001 - already validated by save_upload; never block the upload
        return None
    n = c.normalizer
    row = db.execute(select(ExcelUpload).where(ExcelUpload.file_name == name, ExcelUpload.user_id == user.id)).scalar_one_or_none()
    if row is None:
        row = ExcelUpload(user_id=user.id, file_name=name, stored_path=str(path))
        db.add(row)
    for r in list(row.rows):
        db.delete(r)
    meta = rep.metadata
    row.file_id = result.get("file_id")
    row.size_bytes = path.stat().st_size
    row.employee, row.project, row.application, row.jira_board = meta.employee, meta.project, meta.application, meta.jira_board
    row.report_date = meta.report_date.isoformat() if meta.report_date else None
    row.layout, row.work_items, row.releases, row.issues, row.ok = rep.layout, len(rep.work_items), len(rep.releases), len(rep.issues), rep.ok
    row.uploaded_at = utcnow()
    db.flush()
    for w in rep.work_items:
        ids = list(w.get("ticket_ids") or [])
        ws, wt = n.normalize("work_status", w.get("work_status")), n.normalize("work_type", w.get("work_type"))
        dd, pr, pdp = n.normalize("dev_deployment", w.get("dev_deployment")), n.normalize("prod_required", w.get("prod_required")), n.normalize("prod_deployment", w.get("prod_deployment"))
        db.add(ExcelUploadRow(
            upload_id=row.id, user_id=user.id, source_row=w.get("source_row"),
            ticket_id=ids[0] if ids else clean_text(w.get("ticket_id")), ticket_link=clean_text(w.get("ticket_link")),
            application=clean_text(w.get("application")) or meta.application, work_details=clean_text(w.get("work_details")),
            work_type_raw=wt.original, work_type=wt.category, work_status_raw=ws.original, work_status=ws.category,
            prod_required=pr.category, dev_deployment_raw=dd.original, dev_deployment=dd.category, prod_deployment=pdp.category,
            comments=clean_text(w.get("comments")), report_date=row.report_date))
    return row


def _employee_status(c: Container, user: User, db: Session) -> Dict[str, Any]:
    """Employee view: counts come from the workbooks this user uploaded (stored in the database)."""
    ups = db.execute(select(ExcelUpload).where(ExcelUpload.user_id == user.id)).scalars().all()
    base = c.excel.status()
    last = max((u.uploaded_at for u in ups), default=None)
    return {**base, "file_count": len(ups), "uploads": len(ups), "report_count": len(ups),
            "activity_count": sum(u.work_items for u in ups), "release_count": sum(u.releases for u in ups),
            "employee_count": 1 if ups else 0, "project_count": len({u.project for u in ups if u.project}),
            "issues_count": sum(u.issues for u in ups), "source_dir": "Your uploads", "scoped": True,
            "last_refresh": last.isoformat() if last else None,
            "date_min": min((u.report_date for u in ups if u.report_date), default=None),
            "date_max": max((u.report_date for u in ups if u.report_date), default=None)}


@router.get("/status")
async def status(c: Container = Depends(workspace), user: User = Depends(active_user), db: Session = Depends(workspace_db)) -> Dict[str, Any]:
    if user.role == ROLE_EMPLOYEE:
        return _employee_status(c, user, db)
    if not c.store.is_loaded:
        c.data.load_all(force=True, reason="startup")
    out = c.data.status()
    if getattr(c, "is_demo", False):
        out["demo"] = True
    return out


@router.post("/refresh")
async def refresh(force: bool = Query(True), c: Container = Depends(_ws)) -> Dict[str, Any]:
    return c.data.load_all(force=force, reason="manual refresh")


class DataSourceUpdate(BaseModel):
    mode: Optional[str] = None
    lookback_days: Optional[int] = None
    refresh_minutes: Optional[int] = None


data_router = APIRouter(prefix="/data", tags=["Data Source"])


@data_router.get("/source")
async def get_source(c: Container = Depends(_ws)) -> Dict[str, Any]:
    return c.data.status()


@data_router.put("/source")
async def put_source(body: DataSourceUpdate, c: Container = Depends(_ws)) -> Dict[str, Any]:
    c.data.update_config(body.mode, body.lookback_days, body.refresh_minutes)
    return c.data.load_all(force=True, reason=f"data source changed to {c.data.mode}")


@data_router.post("/reload")
async def reload(c: Container = Depends(_ws)) -> Dict[str, Any]:
    return c.data.load_all(force=True, reason="manual reload")


@router.get("/files")
async def files(c: Container = Depends(loaded_container), user: User = Depends(active_user), db: Session = Depends(workspace_db)) -> Dict[str, Any]:
    items = _visible_files(c, user)
    return {"items": items, "status": _employee_status(c, user, db) if user.role == ROLE_EMPLOYEE else c.excel.status()}


@router.get("/files/{file_id}")
async def file_detail(file_id: str, c: Container = Depends(loaded_container), user: User = Depends(active_user)) -> Dict[str, Any]:
    _check_file(c, user, file_id)
    return c.excel.file_detail(file_id)


@router.get("/sheets")
async def sheets(file_id: str = Query(...), c: Container = Depends(loaded_container), user: User = Depends(active_user)) -> Dict[str, Any]:
    _check_file(c, user, file_id)
    return c.excel.sheets(file_id)


@router.get("/preview")
async def preview(file_id: str = Query(...), sheet_name: Optional[str] = Query(None),
                  limit: int = Query(30, ge=1, le=200), c: Container = Depends(loaded_container),
                  user: User = Depends(active_user)) -> Dict[str, Any]:
    _check_file(c, user, file_id)
    return c.excel.preview(file_id, sheet_name, limit)


@router.post("/validate")
async def validate(body: ValidateRequest, c: Container = Depends(loaded_container), user: User = Depends(active_user)) -> Dict[str, Any]:
    if not body.file_id:
        from app.core.exceptions import ValidationFailedError
        raise ValidationFailedError("file_id is required")
    _check_file(c, user, body.file_id)
    return c.excel.validate(body.file_id, body.sheet_name, body.column_overrides)


@router.post("/upload")
async def upload(file: UploadFile = File(...), replace: bool = Query(False), c: Container = Depends(_ws),
                 user: User = Depends(active_user), db: Session = Depends(workspace_db)) -> Dict[str, Any]:
    content = await file.read()
    result = c.excel.save_upload(file.filename or "upload.xlsx", content, replace=replace)
    if getattr(c, "upload_owners", None) is not None and result.get("file_name"):
        owners = _owners(c)
        owners[result["file_name"]] = user.id
        c.upload_owners.write(owners)
    if getattr(c, "upload_owners", None) is not None:
        rec = _persist_upload(c, db, user, result)
        db.commit()
        result["upload_id"] = rec.id if rec else None
    if user.role == ROLE_EMPLOYEE:
        result["status"] = _employee_status(c, user, db)
    result["jira"] = None
    if c.data.mode != "jira" and c.jira.configured and result.get("file_id"):
        try:
            rec = c.jira.reconcile(None, file_id=result["file_id"], include_missing=False)
            result["jira"] = rec["summary"]
        except Exception as exc:  # noqa: BLE001 - upload must succeed even if Jira is down
            result["jira"] = {"error": getattr(exc, "message", str(exc))}
    return result


@router.delete("/uploads/{file_id}")
async def remove_upload(file_id: str, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.excel.remove_upload(file_id)


@router.delete("/uploads")
async def clear_uploads(c: Container = Depends(_ws)) -> Dict[str, Any]:
    return c.excel.clear_uploads()


@router.get("/my")
async def my_uploads(user: User = Depends(active_user), db: Session = Depends(workspace_db)) -> Dict[str, Any]:
    """The caller's own uploaded workbooks and every ticket row read from them (stored in the database)."""
    ups = db.execute(select(ExcelUpload).where(ExcelUpload.user_id == user.id).order_by(ExcelUpload.uploaded_at.desc())).scalars().all()
    rows = db.execute(select(ExcelUploadRow).where(ExcelUploadRow.user_id == user.id).order_by(ExcelUploadRow.report_date.desc(), ExcelUploadRow.source_row)).scalars().all()
    names = {u.id: u.file_name for u in ups}
    return {"uploads": [u.to_dict() for u in ups],
            "tickets": [{**r.to_dict(), "file_name": names.get(r.upload_id)} for r in rows]}


@router.get("/history")
async def history(c: Container = Depends(_ws), user: User = Depends(active_user)) -> Dict[str, Any]:
    items = c.excel.history()
    if user.role == ROLE_EMPLOYEE:
        mine = {f["file_name"] for f in _visible_files(c, user)}
        items = [h for h in items if any(name in str(h.get("reason", "")) for name in mine)]
    return {"items": items}
