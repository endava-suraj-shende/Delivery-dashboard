"""Event subscribers that keep modules decoupled."""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.logging import get_logger
from app.events.event_bus import Event, Events

if TYPE_CHECKING:
    from app.services.container import Container

log = get_logger("event_handlers")


def register_handlers(c: "Container") -> None:
    def on_data_loaded(event: Event) -> None:
        c.analytics.invalidate()
        c.bus.publish(Events.CACHE_INVALIDATED, reason=event.name)
        log.info("Data loaded: %s", {k: v for k, v in event.payload.items() if k in ("source", "files", "parsed", "failed", "duration_ms")})
        if c.data.mode != "jira" and c.jira.configured and c.jira.auto_sync:
            import threading
            threading.Thread(target=_safe_sync, name="jira-auto-sync", daemon=True).start()

    def on_boards_changed(event: Event) -> None:
        c.analytics.invalidate()
        if c.data.mode != "excel" or c.data.configured_mode == "auto":
            import threading
            threading.Thread(target=_safe_reload, name="jira-reload", daemon=True).start()

    def _safe_reload() -> None:
        try:
            c.data.load_all(force=True, reason="jira boards changed")
        except Exception as exc:  # noqa: BLE001
            log.warning("Reload after board change failed: %s", getattr(exc, "message", exc))

    def _safe_sync() -> None:
        try:
            c.jira.sync()
        except Exception as exc:  # noqa: BLE001 - never break data loading because Jira is down
            log.warning("Jira auto-sync failed: %s", getattr(exc, "message", exc))

    def on_status_config_changed(event: Event) -> None:
        c.store.renormalize()
        c.analytics.invalidate()
        log.info("Status configuration changed; data renormalized")

    def on_report_generated(event: Event) -> None:
        log.info("Report generated: %s", event.payload)

    def on_jira_synced(event: Event) -> None:
        c.analytics.invalidate()
        log.info("Jira synced: %s", event.payload)

    def audit(event: Event) -> None:
        log.debug("event=%s payload=%s", event.name, event.payload)

    c.bus.clear(owner="container")
    c.bus.subscribe_owned("container", Events.DATA_LOADED, on_data_loaded)
    c.bus.subscribe_owned("container", Events.STATUS_CONFIG_CHANGED, on_status_config_changed)
    c.bus.subscribe_owned("container", Events.REPORT_GENERATED, on_report_generated)
    c.bus.subscribe_owned("container", Events.JIRA_SYNCED, on_jira_synced)
    c.bus.subscribe_owned("container", Events.JIRA_BOARDS_CHANGED, on_boards_changed)
    c.bus.subscribe_owned("container", "*", audit)
