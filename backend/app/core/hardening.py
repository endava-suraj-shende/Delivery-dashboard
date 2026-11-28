"""Perimeter hardening: security headers, request ids, CSRF origin checks and a small in-process rate limiter.

Deliberately dependency-free. For multi-node deployments put the rate limiter at the reverse proxy instead
(this one is per process).
"""
from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from typing import Deque, Dict, Iterable, Optional
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import Settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
# The API serves JSON only; the frontend is a separate origin (Vite) or static files behind the proxy,
# so a strict CSP on API responses is safe. /docs needs inline scripts/styles from the CDN bundle.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
SPA_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
           "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
DOCS_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
            "frame-ancestors 'none'")


def _origin_of(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}".lower() if p.scheme and p.netloc else ""


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self.hsts = settings.cookie_secure_effective

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        path = request.url.path
        if path in ("/docs", "/redoc") or path.startswith("/docs/"):
            csp = DOCS_CSP
        elif path.startswith("/api/") or path in ("/health", "/openapi.json"):
            csp = API_CSP
        else:
            csp = SPA_CSP  # built frontend served by this process
        response.headers.setdefault("Content-Security-Policy", csp)
        if self.hsts:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        response.headers["X-Request-ID"] = rid
        return response


class CsrfOriginMiddleware(BaseHTTPMiddleware):
    """Cookie sessions + SameSite=Lax still allow top-level cross-site POST navigations; require that every
    state-changing request carries an Origin/Referer matching an allowed origin (or the API host itself)."""

    def __init__(self, app, settings: Settings, allowed: Iterable[str]) -> None:
        super().__init__(app)
        self.enabled = settings.csrf_protection
        self.allowed = {o.lower().rstrip("/") for o in allowed}

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if not self.enabled or request.method in SAFE_METHODS or not request.url.path.startswith("/api/"):
            return await call_next(request)
        if not request.cookies and "authorization" in request.headers:
            return await call_next(request)  # token clients are not CSRF-able
        origin = request.headers.get("origin") or _origin_of(request.headers.get("referer", ""))
        if not origin:
            # Same-origin fetch() always sends Origin on POST; its absence means a non-browser client
            # without a cookie session, or a very old browser. Allow only when no session cookie is present.
            if request.cookies:
                return JSONResponse({"error": "forbidden", "message": "Missing Origin header on state-changing request"}, status_code=403)
            return await call_next(request)
        host_origin = f"{request.url.scheme}://{request.headers.get('host', '')}".lower()
        fwd = request.headers.get("x-forwarded-host")
        fwd_origin = f"{request.headers.get('x-forwarded-proto', request.url.scheme)}://{fwd}".lower() if fwd else ""
        if origin.lower().rstrip("/") in self.allowed or origin.lower() in (host_origin, fwd_origin):
            return await call_next(request)
        return JSONResponse({"error": "forbidden", "message": "Cross-site request blocked"}, status_code=403)


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_s: float = 60.0) -> Optional[int]:
        """Returns None when allowed, otherwise the number of seconds until the next slot."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return max(1, int(window_s - (now - q[0])) + 1)
            q.append(now)
            if len(self._hits) > 10_000:  # cheap cap on memory
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > window_s]:
                    self._hits.pop(k, None)
        return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    AUTH_PATHS = ("/api/v1/auth/login", "/api/v1/auth/signup", "/api/v1/auth/forgot-password",
                  "/api/v1/auth/reset-password", "/api/v1/jira/connections/redeem-code")
    UPLOAD_PATHS = ("/api/v1/excel/upload", "/api/v1/excel/validate")

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self.auth_limit = settings.rate_limit_auth_per_minute
        self.upload_limit = settings.rate_limit_upload_per_minute
        self.limiter = SlidingWindowLimiter()

    @staticmethod
    def _client(request: Request) -> str:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method == "POST":
            path = request.url.path
            limit = self.auth_limit if path in self.AUTH_PATHS else self.upload_limit if path in self.UPLOAD_PATHS else 0
            if limit > 0:
                retry = self.limiter.allow(f"{path}|{self._client(request)}", limit)
                if retry is not None:
                    return JSONResponse({"error": "rate_limited", "message": "Too many requests, try again shortly"},
                                        status_code=429, headers={"Retry-After": str(retry)})
        return await call_next(request)
