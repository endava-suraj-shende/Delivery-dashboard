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

    # ------------------------------------------------------------------ database / auth / e-mail
    # SQLite by default. Run `python manage.py migrate` to create / upgrade the schema.
    database_url: str = f"sqlite:///{(PROJECT_ROOT / 'storage' / 'app.db').as_posix()}"
    auto_migrate: bool = True
    # Public URL of the frontend, used in verification / reset links
    public_url: str = "http://localhost:5173"
    # Session JWT (HS256). When blank a key is derived from the secret key file.
    auth_secret: str = ""
    session_hours: int = 8
    cookie_name: str = "edd_session"
    # None = secure automatically outside the "local" environment
    cookie_secure: bool | None = None
    # Serve the built frontend (frontend/dist) from the API process - used by the Docker image. Blank = disabled.
    static_dir: Path | None = None
    # Single sign-on (OpenID Connect; Microsoft Entra ID by default). Enabled when issuer + client id + secret are set.
    # Entra: EDD_SSO_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
    sso_issuer: str = ""
    sso_client_id: str = ""
    sso_client_secret: str = ""
    sso_label: str = "Microsoft"
    sso_scopes: str = "openid profile email"
    sso_redirect_uri: str = ""            # default: <EDD_PUBLIC_URL>/api/v1/auth/sso/callback
    sso_domain_hint: str = ""             # e.g. endava.com - skips the account picker
    sso_default_role: str = "employee"    # role for first-time SSO users (superuser can change it later)
    sso_auto_activate: bool = True        # False = new SSO users wait for superuser approval
    sso_allow_local_login: bool = True    # False = hide e-mail/password form (guests/demo/admins can still POST /auth/login)
    # Intelligence layer (root package ./intelligence). The optional language model is used for language only.
    # EDD_LLM_PROVIDER = "" (off) | "azure_openai" | "openai_compatible"
    llm_provider: str = ""
    llm_endpoint: str = ""            # Azure: https://<resource>.openai.azure.com ; compatible: https://host/v1
    llm_api_key: str = ""
    llm_model: str = ""               # Azure deployment name or model id
    llm_api_version: str = "2024-10-21"
    llm_timeout_seconds: int = 30
    llm_send_details: bool = False    # allow ticket summaries/comments to be sent to the model (default: facts only)
    # Perimeter hardening
    csrf_protection: bool = True
    rate_limit_auth_per_minute: int = 30      # per client IP (login: per IP+account) on /auth/login, /auth/signup, /auth/forgot-password
    rate_limit_upload_per_minute: int = 6
    security_headers: bool = True
    # Persist the parsed data snapshot so restarts do not wait for Jira
    snapshot_dir: Path = PROJECT_ROOT / "storage" / "snapshot"
    backup_dir: Path = PROJECT_ROOT / "storage" / "backups"
    backup_keep: int = 14
    backup_hour_utc: int = 1
    verify_token_hours: int = 24
    reset_token_minutes: int = 60
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    # Sign-up policy defaults (editable by the superuser in the UI)
    default_allowed_domains: List[str] = Field(default_factory=lambda: ["endava.com"])
    # Self-healing accounts: the demo-only logins are (re)created on every start so a lost / fresh database
    # never breaks demos; a bootstrap superuser is created when both values are set (e.g. first deployment).
    demo_accounts: bool = True
    warm_up: bool = True  # pre-build demo workspace + default views at start-up (off in tests)
    bootstrap_superuser_email: str = ""
    bootstrap_superuser_password: str = ""
    # Resend (https://resend.com). Without an API key links are written to the log (and returned in local env).
    resend_api_key: str = ""
    email_from: str = "Delivery Dashboard <onboarding@resend.dev>"

    @property
    def cookie_secure_effective(self) -> bool:
        return self.cookie_secure if self.cookie_secure is not None else self.environment != "local"

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
