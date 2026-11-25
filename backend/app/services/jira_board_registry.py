"""Registry of configured Jira boards (persisted in the ``jira_boards`` table; legacy JSON file is imported once).

A board is added by pasting its link; site, project key and board id are derived from it.
Each board may optionally use its own credential environment variables (for other Atlassian sites).
"""
from __future__ import annotations

import os
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.exceptions import AppError, NotFoundError
from app.core.secrets import SecretBox
from app.db.repos import FileBoardRepo, FileJsonStore, JsonStore
from app.services.jira_client import BoardRef, JiraClientPool, JiraError, parse_board_url
from app.utils.text import normalize_key


@dataclass
class BoardConfig:
    id: str
    url: str
    base_url: str
    board_id: int
    project_key: Optional[str]
    label: str
    enabled: bool = True
    email_env: Optional[str] = None   # env var holding an alternative email for this site
    token_env: Optional[str] = None   # env var holding an alternative token for this site
    email: Optional[str] = None       # credentials entered in the UI (token stored encrypted)
    token_enc: Optional[str] = None
    excel_board_names: List[str] = field(default_factory=list)  # Excel 'Jira Board:' cells mapped to this board
    people: List[str] = field(default_factory=list)  # assignee display names to include (empty = everyone)
    board_name: Optional[str] = None
    board_type: Optional[str] = None
    project_name: Optional[str] = None
    last_test: Optional[str] = None
    last_test_ok: Optional[bool] = None
    last_error: Optional[str] = None
    last_sync: Optional[str] = None
    last_sync_issues: int = 0
    owner_id: Optional[str] = None    # user who configured the board (delivery manager); None = global

    def credentials(self, box: Optional["SecretBox"] = None) -> Dict[str, Optional[str]]:
        if self.token_enc and box is not None:
            return {"email": self.email, "token": box.decrypt(self.token_enc)}
        return {"email": os.environ.get(self.email_env) if self.email_env else None,
                "token": os.environ.get(self.token_env) if self.token_env else None}

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("token_enc", None)
        d["has_custom_credentials"] = bool(self.token_enc or self.token_env)
        d["credential_source"] = "ui" if self.token_enc else ("env" if self.token_env else "default")
        return d


class JiraBoardRegistry:
    def __init__(self, path: Path, pool: JiraClientPool, box: Optional[SecretBox] = None,
                 credentials_path: Optional[Path] = None, repo: Any = None, credentials_store: Optional[JsonStore] = None) -> None:
        self._path = path
        self._repo = repo or FileBoardRepo(path)
        self._pool = pool
        self._box = box
        self._creds: Optional[JsonStore] = credentials_store or (FileJsonStore(credentials_path) if credentials_path else None)
        self._lock = threading.RLock()
        self._boards: List[BoardConfig] = []
        self._env_credentials = (pool.email or "", pool.token or "")  # fallback when UI credentials are removed
        self._load()
        self._load_default_credentials()

    # ------------------------------------------------------------------ default credentials (UI-managed, encrypted)
    def _load_default_credentials(self) -> None:
        if not (self._creds and self._box):
            return
        try:
            data = self._creds.read() or {}
            token = self._box.decrypt(data.get("token_enc"))
            if data.get("email") and token:
                self._pool.update_credentials(data["email"], token)
        except Exception:
            pass

    def set_default_credentials(self, email: str, token: str) -> None:
        if not (self._creds and self._box):
            raise AppError("Credential storage is not configured")
        if not email or not token:
            raise AppError("Email and API token are required")
        self._creds.write({"email": email, "token_enc": self._box.encrypt(token)})
        self._pool.update_credentials(email, token)

    def clear_default_credentials(self) -> None:
        if self._creds:
            self._creds.delete()
        self._pool.update_credentials(*self._env_credentials)

    def default_credentials_info(self) -> Dict[str, Any]:
        from_file = bool(self._creds and self._creds.exists())
        return {"email": self._pool.email or None, "configured": self._pool.configured,
                "source": "ui" if from_file else ("env" if self._pool.configured else "none"),
                "token_masked": SecretBox.mask(self._pool.token) if self._pool.configured else None}

    # ------------------------------------------------------------------ persistence
    def _load(self) -> None:
        try:
            self._boards = [BoardConfig(**{k: v for k, v in b.items() if k in BoardConfig.__dataclass_fields__})
                            for b in self._repo.load()]
        except Exception:
            self._boards = []

    def _save(self) -> None:
        self._repo.save_all([asdict(b) for b in self._boards])

    # ------------------------------------------------------------------ queries
    def list(self) -> List[BoardConfig]:
        with self._lock:
            return list(self._boards)

    def enabled(self) -> List[BoardConfig]:
        return [b for b in self.list() if b.enabled]

    def get(self, board_id: str) -> BoardConfig:
        with self._lock:
            for b in self._boards:
                if b.id == board_id:
                    return b
        raise NotFoundError(f"Board '{board_id}' not configured")

    def by_project(self, project_key: Optional[str]) -> Optional[BoardConfig]:
        if not project_key:
            return None
        for b in self.enabled():
            if (b.project_key or "").upper() == project_key.upper():
                return b
        return None

    def by_excel_name(self, name: Optional[str]) -> Optional[BoardConfig]:
        """Match the workbook's 'Jira Board:' cell against labels / board names / explicit aliases."""
        key = normalize_key(name)
        if not key:
            return None
        boards = self.enabled()
        for b in boards:
            if key in {normalize_key(x) for x in b.excel_board_names}:
                return b
        for b in boards:
            cands = {normalize_key(b.label), normalize_key(b.board_name), normalize_key(b.project_key), normalize_key(b.project_name)}
            cands.discard("")
            if key in cands or any(c and (c in key or key in c) and len(c) >= 3 for c in cands):
                return b
        return None

    def project_keys(self) -> List[str]:
        return sorted({b.project_key for b in self.enabled() if b.project_key})

    def sites(self) -> List[str]:
        return sorted({b.base_url for b in self.enabled()})

    # ------------------------------------------------------------------ mutations
    def _encrypt(self, token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        if not self._box:
            raise AppError("Credential storage is not configured")
        return self._box.encrypt(token)

    def add(self, url: str, label: Optional[str] = None, enabled: bool = True, email_env: Optional[str] = None,
            token_env: Optional[str] = None, excel_board_names: Optional[List[str]] = None, test: bool = True,
            email: Optional[str] = None, token: Optional[str] = None, people: Optional[List[str]] = None,
            owner_id: Optional[str] = None) -> BoardConfig:
        ref = parse_board_url(url)
        with self._lock:
            for b in self._boards:
                if b.base_url == ref.base_url and b.board_id == ref.board_id:
                    raise AppError(f"Board {ref.board_id} on {ref.base_url} is already configured as '{b.label}'")
            cfg = BoardConfig(id=uuid.uuid4().hex[:8], url=ref.url, base_url=ref.base_url, board_id=ref.board_id,
                              project_key=ref.project_key, label=label or (ref.project_key or f"Board {ref.board_id}"),
                              enabled=enabled, email_env=email_env or None, token_env=token_env or None,
                              email=email or None, token_enc=self._encrypt(token),
                              excel_board_names=excel_board_names or [], people=people or [], owner_id=owner_id)
            if test:
                self._test(cfg)
                if not label and cfg.board_name:
                    cfg.label = cfg.board_name
            self._boards.append(cfg)
            self._save()
            return cfg

    def update(self, board_id: str, **changes: Any) -> BoardConfig:
        with self._lock:
            cfg = self.get(board_id)
            if "url" in changes and changes["url"] and changes["url"] != cfg.url:
                ref = parse_board_url(changes["url"])
                cfg.url, cfg.base_url, cfg.board_id, cfg.project_key = ref.url, ref.base_url, ref.board_id, ref.project_key or cfg.project_key
            for key in ("label", "enabled", "email_env", "token_env", "excel_board_names", "project_key", "people", "email"):
                if key in changes and changes[key] is not None:
                    setattr(cfg, key, changes[key])
            if "owner_id" in changes:
                cfg.owner_id = changes["owner_id"] or None
            if changes.get("token"):
                cfg.token_enc = self._encrypt(changes["token"])
            if changes.get("clear_credentials"):
                cfg.email, cfg.token_enc, cfg.email_env, cfg.token_env = None, None, None, None
            self._save()
            return cfg

    def remove(self, board_id: str) -> None:
        with self._lock:
            cfg = self.get(board_id)
            self._boards.remove(cfg)
            self._save()

    def record_sync(self, board_id: str, issues: int, error: Optional[str] = None) -> None:
        with self._lock:
            try:
                cfg = self.get(board_id)
            except NotFoundError:
                return
            cfg.last_sync = datetime.now().isoformat(timespec="seconds")
            cfg.last_sync_issues = issues
            cfg.last_error = error
            self._save()

    # ------------------------------------------------------------------ testing / discovery
    def client_for(self, cfg: BoardConfig):
        creds = cfg.credentials(self._box)
        return self._pool.for_site(cfg.base_url, creds["email"], creds["token"])

    def _test(self, cfg: BoardConfig) -> Dict[str, Any]:
        cfg.last_test = datetime.now().isoformat(timespec="seconds")
        try:
            client = self.client_for(cfg)
            board = client.board(cfg.board_id)
            if board is None:
                raise JiraError(f"Board {cfg.board_id} not found on {cfg.base_url} (or no permission to view it)")
            cfg.board_name = board.get("name")
            cfg.board_type = board.get("type")
            loc = board.get("location") or {}
            if loc.get("projectKey"):
                cfg.project_key = loc["projectKey"]
            cfg.project_name = loc.get("projectName") or loc.get("displayName")
            cfg.last_test_ok, cfg.last_error = True, None
            return {"ok": True, "board": board}
        except AppError as exc:
            cfg.last_test_ok, cfg.last_error = False, exc.message
            raise

    def test(self, board_id: str) -> Dict[str, Any]:
        with self._lock:
            cfg = self.get(board_id)
            try:
                result = self._test(cfg)
            finally:
                self._save()
            return {"board": cfg.to_dict(), **{k: v for k, v in result.items() if k != "board"}}

    def test_url(self, url: str, email_env: Optional[str] = None, token_env: Optional[str] = None,
                 email: Optional[str] = None, token: Optional[str] = None) -> Dict[str, Any]:
        """Validate a link (and optional inline credentials) before saving it."""
        ref = parse_board_url(url)
        cfg = BoardConfig(id="preview", url=ref.url, base_url=ref.base_url, board_id=ref.board_id,
                          project_key=ref.project_key, label=ref.project_key or f"Board {ref.board_id}",
                          email_env=email_env or None, token_env=token_env or None,
                          email=email or None, token_enc=self._encrypt(token) if token else None)
        try:
            self._test(cfg)
            sprints = self.client_for(cfg).board_sprints(cfg.board_id, state="active")
            return {"ok": True, "board": cfg.to_dict(), "active_sprints": [s.get("name") for s in sprints]}
        except AppError as exc:
            return {"ok": False, "board": cfg.to_dict(), "error": exc.message}

    def discover(self, base_url: str, project_keys: List[str]) -> List[Dict[str, Any]]:
        client = self._pool.for_site(base_url)
        configured = {(b.base_url, b.board_id) for b in self.list()}
        out: List[Dict[str, Any]] = []
        seen: set = set()
        for pk in project_keys or [None]:
            try:
                boards = client.boards(pk)
            except JiraError:
                continue
            for b in boards:
                if b.get("id") in seen:
                    continue
                seen.add(b.get("id"))
                loc = b.get("location") or {}
                out.append({
                    "board_id": b.get("id"), "name": b.get("name"), "type": b.get("type"),
                    "project_key": loc.get("projectKey"), "project_name": loc.get("projectName"),
                    "url": BoardRef(base_url, b.get("id"), loc.get("projectKey")).url,
                    "configured": (base_url.rstrip("/"), b.get("id")) in configured,
                })
        return out
