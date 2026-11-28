"""Small persistence helpers shared by services.

``JsonStore`` lets a service keep its configuration either in a JSON file (legacy / tests) or in the
``app_settings`` table without knowing which. ``BoardRepo`` persists Jira board documents.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import AppSetting, JiraBoard


class JsonStore(Protocol):
    def read(self) -> Optional[Dict[str, Any]]: ...
    def write(self, data: Dict[str, Any]) -> None: ...
    def delete(self) -> None: ...
    def exists(self) -> bool: ...


class FileJsonStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def exists(self) -> bool:
        return self.path.exists()

    def read(self) -> Optional[Dict[str, Any]]:
        if not self.path.exists():
            return None
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def write(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def delete(self) -> None:
        if self.path.exists():
            self.path.unlink()


class DbJsonStore:
    """One row of ``app_settings``. Falls back to importing a legacy file once when the row is missing."""

    def __init__(self, factory: sessionmaker[Session], key: str, legacy_path: Optional[Path] = None) -> None:
        self._factory = factory
        self.key = key
        self._legacy = FileJsonStore(legacy_path) if legacy_path else None

    def exists(self) -> bool:
        with self._factory() as s:
            return s.get(AppSetting, self.key) is not None

    def read(self) -> Optional[Dict[str, Any]]:
        with self._factory() as s:
            row = s.get(AppSetting, self.key)
            if row is not None:
                return dict(row.value) if isinstance(row.value, dict) else row.value
        if self._legacy and self._legacy.exists():
            data = self._legacy.read()
            if data is not None:
                self.write(data)
            return data
        return None

    def write(self, data: Dict[str, Any]) -> None:
        with self._factory() as s:
            row = s.get(AppSetting, self.key)
            if row is None:
                s.add(AppSetting(key=self.key, value=data))
            else:
                row.value = data
            s.commit()

    def delete(self) -> None:
        with self._factory() as s:
            row = s.get(AppSetting, self.key)
            if row is not None:
                s.delete(row)
                s.commit()


class BoardRepo:
    """Persists the list of board documents (dicts produced by ``asdict(BoardConfig)``)."""

    def __init__(self, factory: sessionmaker[Session], legacy_path: Optional[Path] = None) -> None:
        self._factory = factory
        self._legacy = FileJsonStore(legacy_path) if legacy_path else None

    def load(self) -> List[Dict[str, Any]]:
        with self._factory() as s:
            rows = s.execute(select(JiraBoard).order_by(JiraBoard.position, JiraBoard.created_at)).scalars().all()
            if rows:
                out = []
                for r in rows:
                    doc = dict(r.config)
                    doc["id"], doc["owner_id"], doc["enabled"], doc["label"] = r.id, r.owner_id, r.enabled, r.label
                    out.append(doc)
                return out
        if self._legacy and self._legacy.exists():
            data = self._legacy.read() or {}
            docs = list(data.get("boards", []))
            if docs:
                self.save_all(docs)
            return docs
        return []

    def save_all(self, docs: List[Dict[str, Any]]) -> None:
        with self._factory() as s:
            existing = {r.id: r for r in s.execute(select(JiraBoard)).scalars().all()}
            keep = set()
            for pos, doc in enumerate(docs):
                keep.add(doc["id"])
                row = existing.get(doc["id"])
                payload = {k: v for k, v in doc.items() if k not in ("owner_id",)}
                if row is None:
                    s.add(JiraBoard(id=doc["id"], owner_id=doc.get("owner_id"), label=doc.get("label") or "",
                                    base_url=doc.get("base_url") or "", board_id=int(doc.get("board_id") or 0),
                                    enabled=bool(doc.get("enabled", True)), config=payload, position=pos))
                else:
                    # ownership is only ever changed explicitly; a stale in-memory document must not clear it
                    if doc.get("owner_id") is not None or doc.get("_clear_owner"):
                        row.owner_id = doc.get("owner_id")
                    row.label = doc.get("label") or ""
                    row.base_url = doc.get("base_url") or ""
                    row.board_id = int(doc.get("board_id") or 0)
                    row.enabled = bool(doc.get("enabled", True))
                    row.config = payload
                    row.position = pos
            for bid, row in existing.items():
                if bid not in keep:
                    s.delete(row)
            s.commit()


class FileBoardRepo:
    """Legacy file-backed board list (used by tests and when no database is configured)."""

    def __init__(self, path: Path) -> None:
        self._store = FileJsonStore(path)

    def load(self) -> List[Dict[str, Any]]:
        data = self._store.read() or {}
        return list(data.get("boards", []))

    def save_all(self, docs: List[Dict[str, Any]]) -> None:
        self._store.write({"boards": docs})
