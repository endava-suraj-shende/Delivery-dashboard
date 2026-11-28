"""Password hashing (Argon2id) and session tokens (JWT, HS256)."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# EDD_FAST_HASH=1 lowers the Argon2 cost for automated tests only; never set it in a real deployment.
_ph = (PasswordHasher(time_cost=1, memory_cost=8 * 1024, parallelism=1) if os.environ.get("EDD_FAST_HASH") == "1"
       else PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1))  # OWASP 2023 Argon2id minimum; argon2-cffi holds the GIL, so cheaper = more concurrent logins


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _ph.check_needs_rehash(password_hash)
    except Exception:
        return False


def password_problems(password: str) -> list[str]:
    issues = []
    if len(password) < 10:
        issues.append("at least 10 characters")
    if not any(c.islower() for c in password):
        issues.append("a lowercase letter")
    if not any(c.isupper() for c in password):
        issues.append("an uppercase letter")
    if not any(c.isdigit() for c in password):
        issues.append("a digit")
    if not any(not c.isalnum() for c in password):
        issues.append("a symbol")
    return issues


def generate_temp_password(length: int = 14) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length - 2)) + "!" + secrets.choice("23456789")
        if not password_problems(pw):
            return pw


# ---------------------------------------------------------------- one-time tokens
def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


# ---------------------------------------------------------------- session JWT
def create_session_token(secret: str, user_id: str, token_version: int, hours: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "ver": token_version, "iat": int(now.timestamp()),
               "exp": int((now + timedelta(hours=hours)).timestamp()), "jti": secrets.token_hex(8)}
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_session_token(secret: str, token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
