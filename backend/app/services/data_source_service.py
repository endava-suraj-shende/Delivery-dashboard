"""Chooses and loads the primary data source: Excel workbooks, Jira boards, or both."""
from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import Settings
from app.core.exceptions import ValidationFailedError
from app.core.logging import get_logger
from app.events.event_bus import EventBus, Events
from app.services.data_store import InMemoryDataStore, LoadInfo
from app.services.excel_service import ExcelService
from app.services.jira_board_registry import JiraBoardRegistry
from app.services.jira_client import JiraClientPool
from app.services.jira_data_source import JiraDataSource

log = get_logger("data_source")

MODES = ("auto", "jira", "excel", "both")


class DataSourceService:
    def __init__(self, settings: Settings, store: InMemoryDataStore, excel: ExcelService, jira_source: JiraDataSource,
                 registry: JiraBoardRegistry, pool: JiraClientPool, bus: EventBus, config_store: Any = None) -> None:
        from app.db.repos import FileJsonStore
        self.settings = settings
        self.store = store
        self.excel = excel
        self.jira_source = jira_source
        self.registry = registry
        self.pool = pool
        self.bus = bus
        self._lock = threading.RLock()
        self._cfg_store = config_store or FileJsonStore(settings.data_source_config_path)
        self._config: Dict[str, Any] = {"mode": settings.data_source, "lookback_days": settings.jira_lookback_days,
                                        "refresh_minutes": settings.jira_refresh_minutes}
        self._load_config()
        self.jira_source.lookback_days = int(self._config["lookback_days"])
        self._loading = False
        self.excel.reload = self.load_all

    # ------------------------------------------------------------------ config
    def _load_config(self) -> None:
        data = self._cfg_store.read() or {}
        for k in ("mode", "lookback_days", "refresh_minutes"):
            if k in data:
                self._config[k] = data[k]

    def _save_config(self) -> None:
        self._cfg_store.write(dict(self._config))

    @property
    def configured_mode(self) -> str:
        return str(self._config.get("mode") or "auto")

    @property
    def jira_available(self) -> bool:
        has_creds = self.pool.configured or any(b.token_env or b.token_enc for b in self.registry.list())
        return has_creds and bool(self.registry.enabled())

    @property
    def mode(self) -> str:
        """Effective mode (resolves 'auto')."""
        m = self.configured_mode
        if m == "auto":
            return "jira" if self.jira_available else "excel"
        if m in ("jira", "both") and not self.jira_available:
            return "excel"
        return m

    @property
    def refresh_minutes(self) -> int:
        return max(1, int(self._config.get("refresh_minutes") or 15))

    def board_members(self, board_labels: List[str]) -> Optional[List[str]]:
        """Team roster for the selected boards (all enabled boards when empty) in Jira mode.

        A board's roster is its People mapping when one is set, otherwise every assignee seen on it.
        Returns None outside Jira mode so callers fall back to report-based rosters."""
        if self.mode != "jira":
            return None
        wanted = {b.strip().lower() for b in board_labels if b and b.strip()}
        members: set = set()
        for cfg in self.registry.enabled():
            label = cfg.label or cfg.board_name or f"Board {cfg.board_id}"
            if wanted and label.lower() not in wanted:
                continue
            people = [p for p in (cfg.people or []) if p and p.strip()]
            members.update(people or [a for a in self.jira_source.assignees(cfg.id) if a and a != "Unassigned"])
        return sorted(members)

    def update_config(self, mode: Optional[str] = None, lookback_days: Optional[int] = None,
                      refresh_minutes: Optional[int] = None) -> Dict[str, Any]:
        with self._lock:
            if mode is not None:
                if mode not in MODES:
                    raise ValidationFailedError(f"mode must be one of {', '.join(MODES)}")
                self._config["mode"] = mode
            if lookback_days is not None:
                self._config["lookback_days"] = max(7, min(int(lookback_days), 730))
                self.jira_source.lookback_days = self._config["lookback_days"]
            if refresh_minutes is not None:
                self._config["refresh_minutes"] = max(1, min(int(refresh_minutes), 1440))
            self._save_config()
        return self.status()

    # ------------------------------------------------------------------ loading
    def load_all(self, force: bool = False, reason: str = "manual") -> Dict[str, Any]:
        mode = self.mode
        if mode == "excel":
            return self._finish(self.excel.load_all(force=force, reason=reason))
        with self._lock:
            self._loading = True
            started = time.perf_counter()
            self.bus.publish(Events.DATA_LOADING, reason=reason, source=mode)
            try:
                reports, stats = self.jira_source.load()
                origins: Dict[str, str] = {r.file_path: "jira" for r in reports}
                failures: List[Dict[str, Any]] = [{"file": e["scope"], "error": e["error"]} for e in stats.errors]
                file_count = stats.boards
                source_dir = "Jira: " + ", ".join(b.label for b in self.registry.enabled())
                if mode == "both":
                    x_reports, x_failures, files = self.excel.parse_all()
                    origins.update(self.excel._origins)
                    reports = x_reports + reports
                    failures += x_failures
                    file_count += len(files)
                    source_dir = f"{self.settings.data_dir} + {source_dir}"
                duration = int((time.perf_counter() - started) * 1000)
                info = LoadInfo(loaded_at=datetime.now(), duration_ms=duration, signature=self.signature(),
                                file_count=file_count, source_dir=source_dir, history=self.excel._history, source=mode,
                                details={"jira": stats.__dict__})
                self.store.replace(reports, origins, info)
                entry = {"id": uuid.uuid4().hex[:8], "timestamp": info.loaded_at.isoformat(), "reason": reason,
                         "source": mode, "files": file_count, "parsed": len(reports), "failed": len(failures),
                         "duration_ms": duration, "activities": int(len(self.store.activities())),
                         "releases": int(len(self.store.releases())), "failures": failures,
                         "jira_issues": stats.issues}
                self.excel.record_history(entry)
                self.bus.publish(Events.DATA_LOADED, **{k: v for k, v in entry.items() if k != "failures"})
                log.info("Loaded from %s: %d issues -> %d activities, %d releases in %dms", mode, stats.issues,
                         len(self.store.activities()), len(self.store.releases()), duration)
            finally:
                self._loading = False
        return self.status()

    def signature(self) -> str:
        mode = self.mode
        if mode == "excel":
            return self.excel.signature()
        base = f"jira:{self.jira_source.stats.loaded_at}:{len(self.registry.enabled())}"
        return base + (":" + self.excel.signature() if mode == "both" else "")

    def needs_refresh(self) -> bool:
        """Excel folder changed (excel/both) or the Jira refresh interval elapsed (jira/both)."""
        info = self.store.load_info
        mode = self.mode
        if mode != "jira" and self.excel.needs_refresh():
            return True
        if mode != "excel" and info.loaded_at:
            return (datetime.now() - info.loaded_at).total_seconds() > self.refresh_minutes * 60
        return info.source != mode

    def refresh_if_needed(self) -> bool:
        if self.needs_refresh() or not self.store.is_loaded:
            self.load_all(force=True, reason="scheduled refresh" if self.store.is_loaded else "initial load")
            return True
        return False

    # ------------------------------------------------------------------ status
    def _finish(self, status: Dict[str, Any]) -> Dict[str, Any]:
        return self.status()

    def status(self) -> Dict[str, Any]:
        base = self.excel.status()
        info = self.store.load_info
        mode = self.mode
        jira_stats = info.details.get("jira") if info.details else None
        base.update({
            "source": mode,
            "configured_mode": self.configured_mode,
            "jira_available": self.jira_available,
            "source_dir": info.source_dir or base.get("source_dir"),
            "needs_refresh": self.needs_refresh() if self.store.is_loaded else False,
            "loading": self._loading or base.get("loading", False),
            "lookback_days": int(self._config.get("lookback_days") or self.settings.jira_lookback_days),
            "refresh_minutes": self.refresh_minutes,
            "jira": {
                "boards": [b.label for b in self.registry.enabled()],
                "issues": jira_stats.get("issues") if jira_stats else 0,
                "activities": jira_stats.get("activities") if jira_stats else 0,
                "errors": jira_stats.get("errors") if jira_stats else [],
                "fields_resolved": jira_stats.get("fields_resolved") if jira_stats else {},
                "loaded_at": jira_stats.get("loaded_at") if jira_stats else None,
            } if mode != "excel" else None,
            "modes": list(MODES),
        })
        if mode != "excel":
            base["file_count"] = info.file_count
        return base
