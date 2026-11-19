"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.v1 import analytics, excel, jira_live, reports
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    c = get_container()
    log.info("Starting %s v%s - data source: %s (data dir: %s)", settings.app_name, settings.app_version,
             c.data.mode, settings.data_dir)
    try:
        await asyncio.to_thread(c.data.load_all, True, "startup")
    except Exception:
        log.exception("Initial load failed; the API will retry on first request")
    task = asyncio.create_task(_watch_sources())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Excel-driven Employee Project & Delivery Performance Reporting API. "
                "No authentication — intended for a trusted local environment.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_exception_handlers(app)

API = "/api/v1"
app.include_router(excel.router, prefix=API)
app.include_router(excel.data_router, prefix=API)
for r in (analytics.employees, analytics.projects, analytics.jira, analytics.deployment, analytics.dashboard,
          analytics.search, analytics.config, analytics.meta, analytics.sprints):
    app.include_router(r, prefix=API)
app.include_router(reports.router, prefix=API)
app.include_router(jira_live.router, prefix=API)


@app.get("/", tags=["Health"])
async def root() -> Dict[str, Any]:
    return {"app": settings.app_name, "version": settings.app_version, "docs": "/docs", "api": API}


@app.get("/health", tags=["Health"])
async def health() -> Dict[str, Any]:
    c = get_container()
    return {"status": "ok", "loaded": c.store.is_loaded, "version": c.store.version}
