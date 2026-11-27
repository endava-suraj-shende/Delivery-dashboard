"""Shared FastAPI dependencies (filters, container access)."""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import Depends, Query

from app.api.auth_deps import owned_board_labels, viewers, workspace
from app.core.exceptions import NoDataLoadedError
from app.db.models import User
from app.services.container import Container, get_container
from app.services.filter_service import Filters, preset_range


def container() -> Container:
    return get_container()


def loaded_container(c: Container = Depends(workspace)) -> Container:
    """Loaded data workspace: the real container, or the demo workspace for guest sessions."""
    if not c.store.is_loaded:
        c.data.load_all(force=True, reason="lazy-load")
    if not c.store.is_loaded:
        raise NoDataLoadedError("No data loaded. Configure a Jira board (Jira Connections) or place Excel files in the Data folder.")
    return c


def scope_filters(f: Filters, c: Container, user: User) -> Filters:
    """Delivery managers only ever see data from boards they configured."""
    allowed = owned_board_labels(c, user)
    if allowed is None:
        return f
    if not allowed:
        f.jira_board = ["__no_board_access__"]
        return f
    wanted = {b.lower() for b in f.jira_board}
    f.jira_board = [b for b in allowed if not wanted or b.lower() in wanted] or ["__no_board_access__"]
    return f


def filters(
    user: User = Depends(viewers),
    c: Container = Depends(container),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    preset: Optional[str] = Query(None, description="last_7_days | last_15_days | last_30_days | last_60_days | current_week | previous_week | current_month | previous_month | all"),
    employee: Optional[List[str]] = Query(None),
    project: Optional[List[str]] = Query(None),
    application: Optional[List[str]] = Query(None),
    jira_board: Optional[List[str]] = Query(None),
    status: Optional[List[str]] = Query(None),
    work_type: Optional[List[str]] = Query(None),
    dev_deployment: Optional[List[str]] = Query(None),
    prod_deployment: Optional[List[str]] = Query(None),
    prod_required: Optional[List[str]] = Query(None),
    sprint: Optional[List[str]] = Query(None),
    ticket: Optional[List[str]] = Query(None),
    search: Optional[str] = Query(None),
) -> Filters:
    if preset and preset != "custom" and not (start_date or end_date):
        if preset == "all":
            start_date, end_date = date(2000, 1, 1), date(2100, 1, 1)
        else:
            start_date, end_date = preset_range(preset)
    f = Filters.from_query(
        start_date=start_date, end_date=end_date, employee=employee, project=project, application=application,
        jira_board=jira_board, status=status, work_type=work_type, dev_deployment=dev_deployment,
        prod_deployment=prod_deployment, prod_required=prod_required, sprint=sprint, ticket=ticket, search=search,
    )
    return scope_filters(f, c, user)
