"""Perimeter hardening: security headers, CSRF origin checks, rate limiting, backups, upload sniffing."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_security_headers_and_request_id(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'none'" in r.headers["Content-Security-Policy"]
    assert len(r.headers["X-Request-ID"]) >= 8
    assert "Strict-Transport-Security" not in r.headers  # cookie_secure=False in tests -> no HSTS
    body = r.json()
    assert body["status"] == "ok" and body["database"] is True


def test_csrf_blocks_cross_site_and_missing_origin(client: TestClient):
    cookies = client.cookies
    evil = TestClient(client.app, headers={"Origin": "https://evil.example"}, cookies=cookies)
    r = evil.post("/api/v1/auth/logout")
    assert r.status_code == 403 and r.json()["error"] == "forbidden"
    bare = TestClient(client.app, cookies=cookies)  # cookie session but no Origin/Referer
    assert bare.post("/api/v1/auth/logout").status_code == 403
    # Referer from an allowed origin is accepted; GET is never checked
    ref = TestClient(client.app, headers={"Referer": "http://testserver/some/page"}, cookies=cookies)
    assert ref.get("/api/v1/auth/me").status_code == 200
    assert client.get("/api/v1/auth/me").json()["user"] is not None  # still signed in


def test_login_rate_limit(client: TestClient, monkeypatch):
    from app.core import hardening
    app = client.app
    # find the rate-limit middleware instance and tighten it for this test
    limiter_mw = None
    stack = app.middleware_stack
    while stack is not None:
        if isinstance(stack, hardening.RateLimitMiddleware):
            limiter_mw = stack
            break
        stack = getattr(stack, "app", None)
    assert limiter_mw is not None
    limiter_mw.auth_limit = 3
    limiter_mw.limiter = hardening.SlidingWindowLimiter()
    anon = TestClient(app, headers={"Origin": "http://testserver"})
    codes = [anon.post("/api/v1/auth/login", json={"email": "x@endava.com", "password": "bad"}).status_code for _ in range(4)]
    assert codes[:3] == [401, 401, 401] and codes[3] == 429
    limiter_mw.auth_limit = 1000


def test_upload_rejects_wrong_content(client: TestClient):
    r = client.post("/api/v1/excel/upload", files={"file": ("fake.xlsx", b"this is not a zip", "application/octet-stream")})
    assert r.status_code == 422 and "does not match" in r.json()["message"]
    from tests.test_api import _workbook_bytes
    r = client.post("/api/v1/excel/upload", files={"file": ("Hardening_Person-01-11-2026.xlsx", _workbook_bytes("Hardening Person"), "application/octet-stream")})
    assert r.status_code == 200, r.text


def test_backup_and_restore_roundtrip(settings):
    from sqlalchemy import select
    from app.db.backup import backup_database, list_backups, restore_database
    from app.db.base import Base, init_engine, session_factory
    from app.db.models import AccessRule
    engine = init_engine(settings.database_url)
    Base.metadata.create_all(engine)
    factory = session_factory()
    with factory() as db:
        db.add(AccessRule(kind="domain", value="before.example", note="t"))
        db.commit()
    path = backup_database(settings, "unit")
    assert path.exists() and list_backups(settings)[0] == path
    with factory() as db:
        db.add(AccessRule(kind="domain", value="after.example", note="t"))
        db.commit()
    import app.db.base as base
    base._engine.dispose()
    restore_database(settings, path)
    init_engine(settings.database_url)
    with session_factory()() as db:
        values = {r.value for r in db.execute(select(AccessRule)).scalars()}
    assert "before.example" in values and "after.example" not in values
