"""SQLite backup / restore using the online backup API (safe while the app is running, WAL-aware)."""
from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List

from app.core.config import Settings


def _sqlite_path(settings: Settings) -> Path:
    url = settings.database_url
    if not url.startswith("sqlite"):
        raise RuntimeError("Built-in backup supports SQLite only; use your database's native tooling for " + url.split(":")[0])
    return Path(url.split("///", 1)[1])


def backup_database(settings: Settings, label: str = "") -> Path:
    src = _sqlite_path(settings)
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = settings.backup_dir / f"app_{stamp}{('_' + label) if label else ''}.db"
    with sqlite3.connect(src) as s, sqlite3.connect(dest) as d:
        s.backup(d)
    prune_backups(settings)
    return dest


def list_backups(settings: Settings) -> List[Path]:
    if not settings.backup_dir.exists():
        return []
    return sorted(settings.backup_dir.glob("app_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)


def prune_backups(settings: Settings) -> int:
    removed = 0
    for p in list_backups(settings)[max(settings.backup_keep, 1):]:
        p.unlink(missing_ok=True)
        removed += 1
    return removed


def restore_database(settings: Settings, backup: Path) -> Path:
    """Replaces the live database with the backup; the app must be stopped. A safety copy of the current DB is kept."""
    dst = _sqlite_path(settings)
    if not backup.exists():
        raise FileNotFoundError(backup)
    with sqlite3.connect(backup) as b:  # validate before touching the live file
        if b.execute("pragma integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Backup failed integrity check")
    if dst.exists():
        safety = dst.with_name(dst.stem + f".pre-restore-{datetime.now():%Y%m%d_%H%M%S}.db")
        shutil.copy2(dst, safety)
    for suffix in ("-wal", "-shm"):
        Path(str(dst) + suffix).unlink(missing_ok=True)
    shutil.copy2(backup, dst)
    return dst
