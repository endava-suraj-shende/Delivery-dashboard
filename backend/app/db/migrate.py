"""Programmatic Alembic helpers (used by `manage.py migrate` and optional auto-migrate on startup)."""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import BACKEND_DIR, Settings
from app.core.logging import get_logger

log = get_logger("db")


def alembic_config(settings: Settings) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    return cfg


def _ensure_sqlite_dir(settings: Settings) -> None:
    url = settings.database_url
    if url.startswith("sqlite:///") and ":memory:" not in url:
        Path(url.replace("sqlite:///", "", 1)).expanduser().parent.mkdir(parents=True, exist_ok=True)


def upgrade_to_head(settings: Settings) -> None:
    _ensure_sqlite_dir(settings)
    command.upgrade(alembic_config(settings), "head")


def current_revision(settings: Settings) -> str | None:
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import create_engine
    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def make_revision(settings: Settings, message: str) -> None:
    command.revision(alembic_config(settings), message=message, autogenerate=True)
