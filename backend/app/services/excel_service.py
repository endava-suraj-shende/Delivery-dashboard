"""Workbook discovery, loading, uploading and refresh orchestration."""
from __future__ import annotations

import re
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.core.config import Settings
from app.core.exceptions import InvalidFileError, NotFoundError
from app.core.logging import get_logger
from app.events.event_bus import EventBus, Events
from app.processors.column_mapper import WORK_ITEM_FIELDS, RELEASE_FIELDS
from app.processors.excel_reader import folder_signature, list_sheet_names, preview_rows, read_workbook
from app.processors.template_parser import ParsedReport, TemplateParser
from app.services.data_store import InMemoryDataStore, LoadInfo

log = get_logger("excel_service")

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._ \-]+")


class ExcelService:
    def __init__(self, settings: Settings, store: InMemoryDataStore, bus: EventBus) -> None:
        self.settings = settings
        self.store = store
        self.bus = bus
        self.parser = TemplateParser()
        self._origins: Dict[str, str] = {}
        self._history: List[Dict[str, Any]] = []
        self._loading = False
        # Hook replaced by DataSourceService so uploads reload through the active source mode.
        self.reload: Callable[..., Dict[str, Any]] = self.load_all

    # ---- discovery -------------------------------------------------------
    def discover_files(self) -> List[Path]:
        files: List[Path] = []
        report_dir = self.settings.report_dir.resolve()
        for base, origin in ((self.settings.data_dir, "folder"), (self.settings.upload_dir, "upload")):
            if not base.exists():
                continue
            for p in sorted(base.rglob("*")):
                if not (p.is_file() and p.suffix.lower() in self.settings.allowed_extensions) or p.name.startswith("~$"):
                    continue
                if report_dir in p.resolve().parents:
                    continue
                if origin == "folder" and self.settings.upload_dir.resolve() in p.resolve().parents:
                    continue
                files.append(p)
                self._origins[str(p)] = origin
        return files

    def signature(self) -> str:
        return folder_signature(self.discover_files())

    def needs_refresh(self) -> bool:
        return self.store.load_info.signature != self.signature()

    # ---- loading ---------------------------------------------------------
    def parse_all(self) -> Tuple[List[ParsedReport], List[Dict[str, Any]], List[Path]]:
        """Parse every discovered workbook without touching the store."""
        files = self.discover_files()
        reports: List[ParsedReport] = []
        failures: List[Dict[str, Any]] = []
        for path in files:
            try:
                reports.append(self.parser.parse(read_workbook(path)))
            except InvalidFileError as exc:
                failures.append({"file": path.name, "error": exc.message})
                log.warning("Skipping %s: %s", path.name, exc.message)
            except Exception as exc:  # defensive: never let one bad file break the load
                failures.append({"file": path.name, "error": f"{exc.__class__.__name__}: {exc}"})
                log.exception("Unexpected failure parsing %s", path.name)
        return reports, failures, files

    def record_history(self, entry: Dict[str, Any]) -> None:
        self._history.insert(0, entry)
        del self._history[50:]

    def load_all(self, force: bool = False, reason: str = "manual") -> Dict[str, Any]:
        sig = self.signature()
        if not force and self.store.is_loaded and self.store.load_info.signature == sig:
            return self.status()
        self._loading = True
        started = time.perf_counter()
        self.bus.publish(Events.DATA_LOADING, reason=reason)
        reports, failures, files = self.parse_all()
        duration = int((time.perf_counter() - started) * 1000)
        info = LoadInfo(loaded_at=datetime.now(), duration_ms=duration, signature=sig, file_count=len(files),
                        source_dir=str(self.settings.data_dir), history=self._history, source="excel")
        self.store.replace(reports, self._origins, info)
        entry = {
            "id": uuid.uuid4().hex[:8], "timestamp": info.loaded_at.isoformat(), "reason": reason, "source": "excel",
            "files": len(files), "parsed": len(reports), "failed": len(failures), "duration_ms": duration,
            "activities": int(len(self.store.activities())), "releases": int(len(self.store.releases())),
            "failures": failures,
        }
        self.record_history(entry)
        self._loading = False
        self.bus.publish(Events.DATA_LOADED, **{k: v for k, v in entry.items() if k != "failures"})
        log.info("Loaded %d workbooks (%d activities, %d releases) in %dms", len(reports),
                 len(self.store.activities()), len(self.store.releases()), duration)
        return self.status()

    def refresh_if_changed(self) -> bool:
        if self.needs_refresh():
            self.load_all(force=True, reason="auto-detected change")
            return True
        return False

    # ---- status ----------------------------------------------------------
    def status(self) -> Dict[str, Any]:
        acts, rels, reps = self.store.activities(), self.store.releases(), self.store.reports()
        info = self.store.load_info
        dates = reps["report_date"].dropna() if len(reps) else []
        return {
            "loaded": self.store.is_loaded,
            "loading": self._loading,
            "source_dir": str(self.settings.data_dir),
            "upload_dir": str(self.settings.upload_dir.name),
            "file_count": info.file_count,
            "report_count": int(len(reps)),
            "activity_count": int(len(acts)),
            "release_count": int(len(rels)),
            "employee_count": int(acts["employee"].nunique()) if len(acts) else int(reps["employee"].nunique()) if len(reps) else 0,
            "project_count": int(reps["project"].nunique()) if len(reps) else 0,
            "last_refresh": info.loaded_at.isoformat() if info.loaded_at else None,
            "load_duration_ms": info.duration_ms,
            "signature": info.signature,
            "date_min": dates.min().date() if len(dates) else None,
            "date_max": dates.max().date() if len(dates) else None,
            "issues_count": int(len(self.store.issues())),
            "uploads": int((reps["origin"] == "upload").sum()) if len(reps) else 0,
            "needs_refresh": self.needs_refresh() if self.store.is_loaded else False,
            "version": self.store.version,
        }

    def history(self) -> List[Dict[str, Any]]:
        return list(self._history)

    def files(self) -> List[Dict[str, Any]]:
        reps = self.store.reports()
        out: List[Dict[str, Any]] = []
        for _, r in reps.sort_values(["employee", "report_date"], na_position="last").iterrows():
            out.append({
                "file_id": r["file_id"], "file_name": r["file_name"], "folder": r["folder"], "origin": r["origin"],
                "size_bytes": int(r["size_bytes"] or 0), "modified_at": r["modified_at"], "sheet_name": r["sheet_name"],
                "layout": r["layout"], "employee": r["employee"], "project": r["project"],
                "application": r["application"], "jira_board": r["jira_board"],
                "report_date": _d(r["report_date"]), "report_date_source": r["report_date_source"],
                "work_items": int(r["work_items"]), "releases": int(r["releases"]), "kt_items": int(r["kt_items"]),
                "issues": int(r["issues"]), "ok": bool(r["ok"]), "notes": list(r["notes"] or []),
            })
        return out

    def file_detail(self, file_id: str) -> Dict[str, Any]:
        rep = self.store.parsed(file_id)
        if rep is None:
            raise NotFoundError(f"File '{file_id}' not found")
        reps = self.store.reports()
        row = reps[reps["file_id"] == file_id].iloc[0]
        return {
            "file": next(f for f in self.files() if f["file_id"] == file_id),
            "metadata": {
                "employee": rep.metadata.employee, "employee_source": rep.metadata.employee_source,
                "project": rep.metadata.project, "application": rep.metadata.application,
                "jira_board": rep.metadata.jira_board, "team_lead": rep.metadata.team_lead,
                "team_members": rep.metadata.team_members, "report_date": _d(row["report_date"]),
                "report_date_raw": rep.metadata.report_date_raw, "report_date_source": rep.metadata.report_date_source,
                "notes": rep.metadata.notes,
            },
            "work_mapping": rep.work_mapping.to_dict() if rep.work_mapping else None,
            "release_mapping": rep.release_mapping.to_dict() if rep.release_mapping else None,
            "issues": [i.to_dict() for i in rep.issues],
            "work_items": [_json_record(w) for w in rep.work_items],
            "releases": [_json_record(r) for r in rep.releases],
            "kt_items": [_json_record(k) for k in rep.kt_items],
        }

    # ---- sheets / preview / validate -------------------------------------
    def _path_for(self, file_id: str) -> Path:
        rep = self.store.parsed(file_id)
        if rep is None:
            raise NotFoundError(f"File '{file_id}' not found")
        return Path(rep.file_path)

    def sheets(self, file_id: str) -> Dict[str, Any]:
        path = self._path_for(file_id)
        return {"file_id": file_id, "file_name": path.name, "sheets": list_sheet_names(path)}

    def preview(self, file_id: str, sheet_name: Optional[str] = None, limit: int = 30) -> Dict[str, Any]:
        path = self._path_for(file_id)
        wb = read_workbook(path)
        sheet = wb.sheet(sheet_name) if sheet_name else None
        if sheet is None:
            rep = self.store.parsed(file_id)
            sheet = wb.sheet(rep.sheet_name) if rep and rep.sheet_name else (wb.sheets[0] if wb.sheets else None)
        if sheet is None:
            raise InvalidFileError("Workbook has no sheets")
        return {"file_id": file_id, "file_name": path.name, "sheets": wb.sheet_names, **preview_rows(sheet, limit)}

    def validate(self, file_id: str, sheet_name: Optional[str] = None,
                 overrides: Optional[Dict[str, Dict[str, str]]] = None) -> Dict[str, Any]:
        path = self._path_for(file_id)
        parser = TemplateParser(overrides)
        rep = parser.parse(read_workbook(path), sheet_name)
        errors = [i.to_dict() for i in rep.issues if i.severity == "error"]
        warnings = [i.to_dict() for i in rep.issues if i.severity != "error"]
        return {
            "file_id": file_id, "file_name": rep.file_name, "sheet_name": rep.sheet_name, "layout": rep.layout,
            "valid": rep.ok and not errors, "errors": errors, "warnings": warnings,
            "work_items": len(rep.work_items), "releases": len(rep.releases),
            "work_mapping": rep.work_mapping.to_dict() if rep.work_mapping else None,
            "release_mapping": rep.release_mapping.to_dict() if rep.release_mapping else None,
            "canonical_fields": {"work_items": list(WORK_ITEM_FIELDS.keys()), "releases": list(RELEASE_FIELDS.keys())},
            "metadata": {"employee": rep.metadata.employee, "project": rep.metadata.project,
                         "report_date": rep.metadata.report_date.isoformat() if rep.metadata.report_date else None},
        }

    # ---- upload ----------------------------------------------------------
    def save_upload(self, original_name: str, content: bytes, replace: bool = False) -> Dict[str, Any]:
        name = Path(original_name).name
        suffix = Path(name).suffix.lower()
        if suffix not in self.settings.allowed_extensions:
            raise InvalidFileError(f"Unsupported file type '{suffix}'. Allowed: {', '.join(self.settings.allowed_extensions)}")
        if len(content) == 0:
            raise InvalidFileError("Uploaded file is empty")
        if len(content) > self.settings.max_upload_bytes:
            raise InvalidFileError(f"File exceeds {self.settings.max_upload_mb} MB limit")
        safe = _SAFE_NAME_RE.sub("_", Path(name).stem)[:120] or "upload"
        target = self.settings.upload_dir / f"{safe}{suffix}"
        if target.exists() and not replace:
            target = self.settings.upload_dir / f"{safe}_{datetime.now():%Y%m%d%H%M%S}{suffix}"
        target.write_bytes(content)
        try:
            rep = self.parser.parse(read_workbook(target))
        except InvalidFileError:
            target.unlink(missing_ok=True)
            raise
        if not rep.ok:
            target.unlink(missing_ok=True)
            raise InvalidFileError("Workbook does not contain a recognisable work-items table",
                                   {"issues": [i.to_dict() for i in rep.issues]})
        self.bus.publish(Events.FILE_UPLOADED, file=target.name, employee=rep.metadata.employee)
        self.reload(force=True, reason=f"upload: {target.name}")
        file_id = next((f["file_id"] for f in self.files() if f["file_name"] == target.name and f["origin"] == "upload"), None)
        return {"file_id": file_id, "file_name": target.name, "issues": [i.to_dict() for i in rep.issues],
                "status": self.status()}

    def remove_upload(self, file_id: str) -> Dict[str, Any]:
        path = self._path_for(file_id)
        if self.settings.upload_dir.resolve() not in path.resolve().parents:
            raise InvalidFileError("Only uploaded files can be removed; source folder files are read-only")
        path.unlink(missing_ok=True)
        self.bus.publish(Events.FILE_REMOVED, file=path.name)
        return self.reload(force=True, reason=f"removed upload: {path.name}")

    def clear_uploads(self) -> Dict[str, Any]:
        for p in self.settings.upload_dir.glob("*"):
            if p.is_file() and p.suffix.lower() in self.settings.allowed_extensions:
                p.unlink(missing_ok=True)
        return self.reload(force=True, reason="cleared uploads")


def _d(value: Any) -> Optional[str]:
    try:
        return None if value is None or value != value else value.date().isoformat()
    except Exception:
        return None


def _json_record(rec: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in rec.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out
