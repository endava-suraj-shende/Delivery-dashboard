"""Symmetric encryption for secrets stored on disk (Jira API tokens).

The key lives in ``backend/config/.secret.key`` (created on first use, never committed) or in
``EDD_SECRET_KEY`` when set. Encrypted values are Fernet tokens prefixed with ``enc:``.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

PREFIX = "enc:"


class SecretBox:
    def __init__(self, key_path: Path) -> None:
        self._key_path = key_path
        self._fernet = Fernet(self._load_or_create_key())

    def _load_or_create_key(self) -> bytes:
        env_key = os.environ.get("EDD_SECRET_KEY")
        if env_key:
            return env_key.encode()
        if self._key_path.exists():
            return self._key_path.read_bytes().strip()
        key = Fernet.generate_key()
        self._key_path.parent.mkdir(parents=True, exist_ok=True)
        self._key_path.write_bytes(key)
        try:
            os.chmod(self._key_path, 0o600)
        except OSError:
            pass
        return key

    def encrypt(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        if value.startswith(PREFIX):
            return value
        return PREFIX + self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        if not value.startswith(PREFIX):
            return value  # legacy plain value
        try:
            return self._fernet.decrypt(value[len(PREFIX):].encode()).decode()
        except InvalidToken:
            return None

    @staticmethod
    def mask(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        return f"••••{value[-4:]}" if len(value) > 8 else "••••"
