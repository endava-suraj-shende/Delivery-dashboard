"""Application configuration loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        env_prefix="EDD_",
        extra="ignore",
    )

    app_name: str = "Employee Delivery Dashboard"
    app_version: str = "1.0.0"
    environment: str = "local"
    debug: bool = False
    log_level: str = "INFO"

    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # Folder containing the per-employee bi-weekly workbooks (read-only source of truth).
    data_dir: Path = PROJECT_ROOT / "Data"
    # Runtime storage (kept outside data_dir: on Windows "Data" and "data" are the same folder).
    upload_dir: Path = PROJECT_ROOT / "storage" / "uploads"
    report_dir: Path = PROJECT_ROOT / "storage" / "reports"
    # JSON file persisting status-normalization configuration.
    status_config_path: Path = BACKEND_DIR / "config" / "status_mapping.json"

    max_upload_mb: int = 25
    allowed_extensions: List[str] = Field(default_factory=lambda: [".xlsx", ".xlsm", ".xls"])
    default_period_days: int = 30
    report_retention: int = 50

    # Jira Cloud integration (optional; disabled when email/token are blank)
    jira_email: str = ""
    jira_api_token: str = ""
    jira_boards_path: Path = BACKEND_DIR / "config" / "jira_boards.json"
    jira_user_map_path: Path = BACKEND_DIR / "config" / "jira_user_map.json"
    jira_credentials_path: Path = BACKEND_DIR / "config" / "jira_credentials.json"
    secret_key_path: Path = BACKEND_DIR / "config" / ".secret.key"
    jira_cache_minutes: int = 10
    jira_timeout_seconds: int = 30
    jira_auto_sync: bool = True

    # Primary data source: "jira" | "excel" | "both" | "auto" (jira when credentials + boards exist, else excel)
    data_source: str = "auto"
    data_source_config_path: Path = BACKEND_DIR / "config" / "data_source.json"
    # Jira-as-source: how far back to pull issues (by 'updated') and how often to refresh
    jira_lookback_days: int = 180
    jira_refresh_minutes: int = 15
    jira_max_issues_per_board: int = 3000

    @property
    def jira_configured(self) -> bool:
        return bool(self.jira_email and self.jira_api_token)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    for folder in (settings.upload_dir, settings.report_dir, settings.status_config_path.parent):
        folder.mkdir(parents=True, exist_ok=True)
    return settings
