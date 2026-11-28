"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.auth_deps import admin_only, excel_access, viewers
from app.api.v1 import admin, analytics, auth, excel, jira_live, reports, views
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.schemas.responses import HealthOut
from app.core.hardening import CsrfOriginMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from app.core.logging import get_logger, setup_logging
from app.services.container import get_container

settings = get_settings()
setup_logging(settings.log_level, json_logs=settings.environment not in ("local", "dev"))
log = get_logger("main")


async def _watch_sources(interval: int = 15) -> None:
    """Background task: reload when workbooks change on disk or the Jira refresh interval elapses."""
    c = get_container()
    while True:
        await asyncio.sleep(interval)
        try:
            if c.store.is_loaded and c.data.needs_refresh():
                await asyncio.to_thread(c.data.load_all, True, "source change / scheduled refresh")
        except Exception:
            log.exception("Source watch iteration failed")


async def _warm_up() -> None:
    """Pre-compute what the first users will ask for so a 9 a.m. login storm does not pay cold-start costs:
    the demo workspace (guests / demo accounts) and the default-period overview + narrative of the real data."""
    c = get_container()
    try:
        if settings.demo_accounts:
            await asyncio.to_thread(lambda: c.demo().ensure_loaded())
        from app.services.filter_service import Filters

        def _warm(ws) -> None:
            f = ws.analytics.resolve_filters(Filters())
            ws.analytics.overview(f)
            ws.narrative.summary(f)
            ws.analytics.tickets_view(f, compact=True)
        if c.store.is_loaded:
            await asyncio.to_thread(_warm, c)
        if settings.demo_accounts:
            await asyncio.to_thread(_warm, c.demo())
        log.info("Warm-up complete")
    except Exception:
        log.exception("Warm-up failed (non-fatal)")


async def _nightly_backup() -> None:
    """Background task: one SQLite backup per day at settings.backup_hour_utc, pruned to settings.backup_keep."""
    from datetime import datetime, timedelta, timezone
    from app.db.backup import backup_database
    while True:
        now = datetime.now(timezone.utc)
        nxt = now.replace(hour=settings.backup_hour_utc, minute=0, second=0, microsecond=0)
        if nxt <= now:
            nxt += timedelta(days=1)
        await asyncio.sleep((nxt - now).total_seconds())
        try:
            path = await asyncio.to_thread(backup_database, settings)
            log.info("Nightly database backup written: %s", path)
        except Exception:
            log.exception("Nightly backup failed")


async def _run_schedules(interval: int = 60) -> None:
    """Background task: send due e-mail digests (report_schedules.next_run_at <= now)."""
    c = get_container()
    while True:
        await asyncio.sleep(interval)
        try:
            def _tick() -> int:
                with c.db() as db:
                    return c.schedules.run_due(db)
            n = await asyncio.to_thread(_tick)
            if n:
                log.info("Sent %d scheduled digest(s)", n)
        except Exception:
            log.exception("Schedule tick failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    c = get_container()
    log.info("Starting %s v%s - data source: %s (data dir: %s)", settings.app_name, settings.app_version,
             c.data.mode, settings.data_dir)
    if await asyncio.to_thread(c.data.load_from_snapshot):
        # data is already being served; refresh from the live source without blocking start-up
        async def _refresh() -> None:
            try:
                await asyncio.to_thread(c.data.load_all, True, "startup refresh")
            except Exception:
                log.exception("Background refresh after snapshot failed; snapshot stays in use")
        asyncio.create_task(_refresh())
    else:
        try:
            await asyncio.to_thread(c.data.load_all, True, "startup")
        except Exception:
            log.exception("Initial load failed; the API will retry on first request")
    if settings.warm_up:
        asyncio.create_task(_warm_up())
    task = asyncio.create_task(_watch_sources())
    backup_task = asyncio.create_task(_nightly_backup())
    schedule_task = asyncio.create_task(_run_schedules())
    try:
        yield
    finally:
        for t in (task, backup_task, schedule_task):
            t.cancel()
        for t in (task, backup_task, schedule_task):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Excel-driven Employee Project & Delivery Performance Reporting API. "
                "No authentication — intended for a trusted local environment.",
    lifespan=lifespan,
)
# Middleware order (outermost first at request time): security headers -> CORS -> CSRF -> rate limit -> gzip
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(RateLimitMiddleware, settings=settings)
app.add_middleware(CsrfOriginMiddleware, settings=settings, allowed=[*settings.cors_origins, settings.public_url])
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Retry-After"],
)
if settings.security_headers:
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
register_exception_handlers(app)

API = "/api/v1"
app.include_router(auth.router, prefix=API)
app.include_router(admin.router, prefix=API)
# Employees: upload + status only. Managers / admins: full Excel management.
app.include_router(excel.router, prefix=API, dependencies=[Depends(excel_access)])
# Application configuration (data source, status mapping) is admin only.
app.include_router(excel.data_router, prefix=API, dependencies=[Depends(admin_only)])
app.include_router(analytics.config, prefix=API, dependencies=[Depends(admin_only)])
for r in (analytics.employees, analytics.projects, analytics.jira, analytics.deployment, analytics.dashboard,
          analytics.search, analytics.meta, analytics.sprints):
    app.include_router(r, prefix=API, dependencies=[Depends(viewers)])
app.include_router(reports.router, prefix=API)
app.include_router(jira_live.router, prefix=API)
app.include_router(views.router, prefix=API)


@app.get("/", tags=["Health"], include_in_schema=False)
async def root() -> Dict[str, Any]:
    return {"app": settings.app_name, "version": settings.app_version, "docs": "/docs", "api": API}


@app.get("/health", tags=["Health"], response_model=HealthOut)
async def health() -> Dict[str, Any]:
    """Liveness + readiness: process up, database reachable, data loaded."""
    from sqlalchemy import text
    c = get_container()
    db_ok = True
    try:
        with c.db() as s:
            s.execute(text("select 1"))
    except Exception:
        db_ok = False
    status = "ok" if db_ok and c.store.is_loaded else ("degraded" if db_ok else "error")
    return {"status": status, "database": db_ok, "loaded": c.store.is_loaded, "version": c.store.version,
            "app_version": settings.app_version}


# Registered last so /api, /docs and /health keep precedence over the SPA catch-all.
if settings.static_dir and settings.static_dir.exists():
    # Single-container deployment: API + built SPA from one origin (no CORS, cookies first-party).
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")
    _index = settings.static_dir / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = settings.static_dir / full_path
        if full_path and candidate.is_file() and candidate.resolve().is_relative_to(settings.static_dir.resolve()):
            return FileResponse(candidate)
        return FileResponse(_index, headers={"Cache-Control": "no-cache"})
