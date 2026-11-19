"""Minimal in-process, synchronous event bus for module decoupling."""
from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, DefaultDict, Dict, List, Optional

from app.core.logging import get_logger

log = get_logger("events")


@dataclass
class Event:
    name: str
    payload: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)


Handler = Callable[[Event], None]


class EventBus:
    def __init__(self) -> None:
        self._handlers: DefaultDict[str, List[Handler]] = defaultdict(list)
        self._lock = threading.Lock()

    def subscribe(self, event_name: str, handler: Handler) -> None:
        with self._lock:
            if handler not in self._handlers[event_name]:
                self._handlers[event_name].append(handler)

    def unsubscribe(self, event_name: str, handler: Handler) -> None:
        with self._lock:
            if handler in self._handlers.get(event_name, []):
                self._handlers[event_name].remove(handler)

    def clear(self, owner: Optional[str] = None) -> None:
        """Remove all handlers (or only those registered under ``owner``)."""
        with self._lock:
            if owner is None:
                self._handlers.clear()
                return
            for name, handlers in self._handlers.items():
                self._handlers[name] = [h for h in handlers if getattr(h, "_owner", None) != owner]

    def subscribe_owned(self, owner: str, event_name: str, handler: Handler) -> None:
        setattr(handler, "_owner", owner)
        self.subscribe(event_name, handler)

    def publish(self, event_name: str, **payload: Any) -> Event:
        event = Event(name=event_name, payload=payload)
        with self._lock:
            handlers = list(self._handlers.get(event_name, [])) + list(self._handlers.get("*", []))
        for handler in handlers:
            try:
                handler(event)
            except Exception:  # handlers must never break publishers
                log.exception("Event handler failed for %s", event_name)
        return event


class Events:
    DATA_LOADING = "data.loading"
    DATA_LOADED = "data.loaded"
    DATA_LOAD_FAILED = "data.load_failed"
    FILE_UPLOADED = "file.uploaded"
    FILE_REMOVED = "file.removed"
    STATUS_CONFIG_CHANGED = "config.status_changed"
    REPORT_GENERATED = "report.generated"
    CACHE_INVALIDATED = "cache.invalidated"
    JIRA_SYNCED = "jira.synced"
    JIRA_BOARDS_CHANGED = "jira.boards_changed"


event_bus = EventBus()
