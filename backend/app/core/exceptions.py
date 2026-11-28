"""Domain exceptions and FastAPI exception handlers."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_logger

log = get_logger("exceptions")


class AppError(Exception):
    status_code = 400
    code = "app_error"

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class NoDataLoadedError(AppError):
    status_code = 409
    code = "no_data_loaded"


class InvalidFileError(AppError):
    status_code = 422
    code = "invalid_file"


class ValidationFailedError(AppError):
    status_code = 422
    code = "validation_failed"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.code, "message": exc.message, "details": exc.details},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": "request_validation", "message": "Invalid request", "details": {"errors": exc.errors()}},
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
        import os
        if os.environ.get("EDD_DEBUG_ERRORS_FILE"):  # opt-in: append full tracebacks for load/debug sessions
            import traceback
            with open(os.environ["EDD_DEBUG_ERRORS_FILE"], "a", encoding="utf-8") as fh:
                fh.write(f"\n=== {request.method} {request.url.path}\n{traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "An unexpected error occurred", "details": {}},
        )
