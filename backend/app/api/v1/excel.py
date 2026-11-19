"""Excel data management endpoints."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel

from app.api.deps import container, loaded_container
from app.schemas.common import ValidateRequest
from app.services.container import Container

router = APIRouter(prefix="/excel", tags=["Excel Management"])


@router.get("/status")
async def status(c: Container = Depends(container)) -> Dict[str, Any]:
    if not c.store.is_loaded:
        c.data.load_all(force=True, reason="startup")
    return c.data.status()


@router.post("/refresh")
async def refresh(force: bool = Query(True), c: Container = Depends(container)) -> Dict[str, Any]:
    return c.data.load_all(force=force, reason="manual refresh")


class DataSourceUpdate(BaseModel):
    mode: Optional[str] = None
    lookback_days: Optional[int] = None
    refresh_minutes: Optional[int] = None


data_router = APIRouter(prefix="/data", tags=["Data Source"])


@data_router.get("/source")
async def get_source(c: Container = Depends(container)) -> Dict[str, Any]:
    return c.data.status()


@data_router.put("/source")
async def put_source(body: DataSourceUpdate, c: Container = Depends(container)) -> Dict[str, Any]:
    c.data.update_config(body.mode, body.lookback_days, body.refresh_minutes)
    return c.data.load_all(force=True, reason=f"data source changed to {c.data.mode}")


@data_router.post("/reload")
async def reload(c: Container = Depends(container)) -> Dict[str, Any]:
    return c.data.load_all(force=True, reason="manual reload")


@router.get("/files")
async def files(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return {"items": c.excel.files(), "status": c.excel.status()}


@router.get("/files/{file_id}")
async def file_detail(file_id: str, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.excel.file_detail(file_id)


@router.get("/sheets")
async def sheets(file_id: str = Query(...), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.excel.sheets(file_id)


@router.get("/preview")
async def preview(file_id: str = Query(...), sheet_name: Optional[str] = Query(None),
                  limit: int = Query(30, ge=1, le=200), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.excel.preview(file_id, sheet_name, limit)


@router.post("/validate")
async def validate(body: ValidateRequest, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    if not body.file_id:
        from app.core.exceptions import ValidationFailedError
        raise ValidationFailedError("file_id is required")
    return c.excel.validate(body.file_id, body.sheet_name, body.column_overrides)


@router.post("/upload")
async def upload(file: UploadFile = File(...), replace: bool = Query(False), c: Container = Depends(container)) -> Dict[str, Any]:
    content = await file.read()
    result = c.excel.save_upload(file.filename or "upload.xlsx", content, replace=replace)
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
async def clear_uploads(c: Container = Depends(container)) -> Dict[str, Any]:
    return c.excel.clear_uploads()


@router.get("/history")
async def history(c: Container = Depends(container)) -> Dict[str, Any]:
    return {"items": c.excel.history()}
