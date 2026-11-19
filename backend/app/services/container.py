"""Composition root: builds and wires singleton services."""
from __future__ import annotations

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.core.secrets import SecretBox
from app.events.event_bus import EventBus, event_bus
from app.processors.status_normalizer import StatusNormalizer
from app.services.analytics_service import AnalyticsEngine
from app.services.data_source_service import DataSourceService
from app.services.data_store import InMemoryDataStore
from app.services.excel_service import ExcelService
from app.services.jira_board_registry import JiraBoardRegistry
from app.services.jira_client import JiraClientPool
from app.services.jira_data_source import JiraDataSource
from app.services.jira_reconcile_service import JiraReconcileService
from app.services.report_service import ReportService


class Container:
    def __init__(self, settings: Settings, bus: EventBus) -> None:
        self.settings = settings
        self.bus = bus
        self.normalizer = StatusNormalizer(settings.status_config_path)
        self.store = InMemoryDataStore(self.normalizer)
        self.excel = ExcelService(settings, self.store, bus)
        self.analytics = AnalyticsEngine(self.store, self.normalizer, settings.default_period_days)
        self.reports = ReportService(settings, self.analytics, bus)
        self.jira_pool = JiraClientPool(settings.jira_email, settings.jira_api_token, settings.jira_timeout_seconds,
                                        settings.jira_cache_minutes)
        self.secrets = SecretBox(settings.secret_key_path)
        self.jira_boards = JiraBoardRegistry(settings.jira_boards_path, self.jira_pool, self.secrets,
                                             settings.jira_credentials_path)
        self.jira = JiraReconcileService(self.store, self.normalizer, self.jira_boards, self.jira_pool, bus,
                                         settings.jira_user_map_path, settings.jira_auto_sync)
        self.jira_source = JiraDataSource(self.jira_boards, self.normalizer, settings.jira_lookback_days,
                                          settings.jira_max_issues_per_board)
        self.data = DataSourceService(settings, self.store, self.excel, self.jira_source, self.jira_boards,
                                      self.jira_pool, bus)
        self.analytics.source_mode = lambda: self.data.mode
        self.jira.source_mode = lambda: self.data.mode
        self.analytics.board_members = self.data.board_members
        from app.events.event_handlers import register_handlers
        register_handlers(self)


@lru_cache
def get_container() -> Container:
    return Container(get_settings(), event_bus)
