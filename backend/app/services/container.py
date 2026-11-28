"""Composition root: builds and wires singleton services."""
from __future__ import annotations

from functools import lru_cache

import hashlib
import logging

from app.core.config import Settings, get_settings
from app.core.secrets import SecretBox
from app.db.base import init_engine, session_factory
from app.db.repos import BoardRepo, DbJsonStore
from app.events.event_bus import EventBus, event_bus
from app.processors.status_normalizer import StatusNormalizer
from app.services.analytics_service import AnalyticsEngine
from app.services.auth_service import AuthService
from app.services.email_service import EmailService
from app.services.data_source_service import DataSourceService
from app.services.data_store import InMemoryDataStore
from app.services.excel_service import ExcelService
from app.services.jira_board_registry import JiraBoardRegistry
from app.services.jira_client import JiraClientPool
from app.services.jira_data_source import JiraDataSource
from app.services.jira_reconcile_service import JiraReconcileService
from app.services.report_service import ReportService

logger = logging.getLogger(__name__)


class Container:
    def __init__(self, settings: Settings, bus: EventBus) -> None:
        self.settings = settings
        self.bus = bus
        # ---- database (schema is managed by Alembic; see manage.py migrate)
        init_engine(settings.database_url)
        if settings.auto_migrate:
            from app.db.migrate import upgrade_to_head
            upgrade_to_head(settings)
        self.db = session_factory()
        store = lambda key, legacy: DbJsonStore(self.db, key, legacy)  # noqa: E731

        self.secrets = SecretBox(settings.secret_key_path)
        self.email = EmailService(settings)
        self.auth = AuthService(settings, self.email, settings.auth_secret or self._derived_auth_secret(), box=self.secrets)
        from app.services.sso_service import SsoService
        self.sso = SsoService(settings, self.auth, settings.auth_secret or self._derived_auth_secret())

        self.normalizer = StatusNormalizer(settings.status_config_path, store=store("status_mapping", settings.status_config_path))
        self.store = InMemoryDataStore(self.normalizer)
        self.excel = ExcelService(settings, self.store, bus)
        self.analytics = AnalyticsEngine(self.store, self.normalizer, settings.default_period_days)
        self.reports = ReportService(settings, self.analytics, bus, db_factory=self.db)
        from app.services.narrative_service import NarrativeService
        self.narrative = NarrativeService(self.analytics)
        from app.services.forecast_service import ForecastService
        self.forecast = ForecastService(self.analytics)
        self.reports.narrative, self.reports.forecast = self.narrative, self.forecast
        from app.services.reconciliation_workflow import ReconciliationWorkflow
        self.recon_workflow = ReconciliationWorkflow(self, workspace="real")
        from app.services.schedule_service import ScheduleService
        self.schedules = ScheduleService(self)
        self.jira_pool = JiraClientPool(settings.jira_email, settings.jira_api_token, settings.jira_timeout_seconds,
                                        settings.jira_cache_minutes)
        self.jira_boards = JiraBoardRegistry(settings.jira_boards_path, self.jira_pool, self.secrets,
                                             settings.jira_credentials_path,
                                             repo=BoardRepo(self.db, settings.jira_boards_path),
                                             credentials_store=store("jira_default_credentials", settings.jira_credentials_path))
        self.jira = JiraReconcileService(self.store, self.normalizer, self.jira_boards, self.jira_pool, bus,
                                         settings.jira_user_map_path, settings.jira_auto_sync,
                                         user_map_store=store("jira_user_map", settings.jira_user_map_path))
        self.jira_source = JiraDataSource(self.jira_boards, self.normalizer, settings.jira_lookback_days,
                                          settings.jira_max_issues_per_board)
        self.data = DataSourceService(settings, self.store, self.excel, self.jira_source, self.jira_boards,
                                      self.jira_pool, bus, config_store=store("data_source", settings.data_source_config_path))
        self.upload_owners = DbJsonStore(self.db, "excel_upload_owners")  # uploaded file name -> user id
        with self.db() as s:
            self.auth.ensure_default_policy(s)
            for b in self.jira_boards.list():  # every linked board has a shareable BOARD code
                self.auth.ensure_board_code(s, b.id, b.owner_id)
            if settings.demo_accounts:
                for email in self.auth.ensure_demo_accounts(s):
                    logger.info("demo account (re)created: %s", email)
            if self.auth.ensure_bootstrap_superuser(s, settings.bootstrap_superuser_email, settings.bootstrap_superuser_password):
                logger.warning("bootstrap superuser created from EDD_BOOTSTRAP_SUPERUSER_*: %s", settings.bootstrap_superuser_email)
            s.commit()
            from sqlalchemy import func, select as _select
            from app.db.models import User as _User
            if s.execute(_select(func.count()).select_from(_User).where(_User.demo_only.is_(False))).scalar() == 0:
                logger.warning("No real accounts in %s - run `python manage.py create-superuser` or set EDD_BOOTSTRAP_SUPERUSER_EMAIL/PASSWORD",
                               settings.database_url)
        self.analytics.source_mode = lambda: self.data.mode
        self.jira.source_mode = lambda: self.data.mode
        self.analytics.board_members = self.data.board_members
        import threading
        self._demo_lock = threading.Lock()
        from app.events.event_handlers import register_handlers
        register_handlers(self)

    def demo(self):
        """Lazily built synthetic workspace used for guest sessions and demo mode (never touches real data)."""
        if getattr(self, "_demo", None) is None:
            import threading
            if not hasattr(self, "_demo_lock"):
                self._demo_lock = threading.Lock()
            with self._demo_lock:  # concurrent first requests must not build (and reset) the demo DB twice
                if getattr(self, "_demo", None) is None:
                    from app.services.demo_data import DemoWorkspace
                    self._demo = DemoWorkspace(self.settings, self.secrets, self.settings.auth_secret or self._derived_auth_secret())
        return self._demo

    def _derived_auth_secret(self) -> str:
        """Stable per-installation JWT key derived from the Fernet key file when EDD_AUTH_SECRET is not set."""
        key = self.settings.secret_key_path.read_bytes().strip() if self.settings.secret_key_path.exists() else b""
        return hashlib.sha256(b"edd-session:" + key).hexdigest()


@lru_cache
def get_container() -> Container:
    return Container(get_settings(), event_bus)
