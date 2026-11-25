"""Live Jira integration endpoints: connections (boards), sync, reconciliation, user mapping."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.auth_deps import admin_only, managers
from app.api.deps import container, filters, loaded_container
from app.core.exceptions import AppError, NotFoundError
from app.db.models import ROLE_ADMIN, User
from app.events.event_bus import Events
from app.services.container import Container
from app.services.filter_service import Filters

router = APIRouter(prefix="/jira", tags=["Jira Live"], dependencies=[Depends(managers)])


def _visible(c: Container, user: User):
    """Admins see every board; delivery managers the boards they configured or were granted by auth code."""
    from app.api.auth_deps import visible_board_ids
    boards = c.jira_boards.list()
    ids = visible_board_ids(c, user)
    return boards if ids is None else [b for b in boards if b.id in ids]


def _owned(c: Container, user: User, board_id: str):
    cfg = c.jira_boards.get(board_id)
    if user.role != ROLE_ADMIN and cfg.owner_id != user.id:
        raise NotFoundError(f"Board '{board_id}' not configured")
    return cfg


class BoardCreate(BaseModel):
    url: str = Field(..., description="Board link, e.g. https://site.atlassian.net/jira/software/c/projects/OCS/boards/921")
    label: Optional[str] = None
    enabled: bool = True
    email_env: Optional[str] = Field(None, description="Env var with an alternative email for this site")
    token_env: Optional[str] = Field(None, description="Env var with an alternative API token for this site")
    email: Optional[str] = Field(None, description="Atlassian account email for this board (stored with the board)")
    token: Optional[str] = Field(None, description="API token for this board (stored encrypted, never returned)")
    excel_board_names: Optional[List[str]] = None
    people: Optional[List[str]] = Field(None, description="Assignee names to include; empty = everyone on the board")
    test: bool = True


class BoardUpdate(BaseModel):
    url: Optional[str] = None
    label: Optional[str] = None
    enabled: Optional[bool] = None
    email_env: Optional[str] = None
    token_env: Optional[str] = None
    email: Optional[str] = None
    token: Optional[str] = None
    clear_credentials: Optional[bool] = None
    excel_board_names: Optional[List[str]] = None
    people: Optional[List[str]] = None
    project_key: Optional[str] = None
    owner_id: Optional[str] = Field(None, description="Admin only: reassign the board to another user")


class BoardTest(BaseModel):
    url: str
    email_env: Optional[str] = None
    token_env: Optional[str] = None
    email: Optional[str] = None
    token: Optional[str] = None


class DefaultCredentials(BaseModel):
    email: str
    token: str


class UserMapping(BaseModel):
    employee: str
    account_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None


# ---------------------------------------------------------------- connections
@router.get("/connections")
def connections(user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    st = c.jira.status()
    visible = {b.id for b in _visible(c, user)}
    owners: Dict[str, str] = {}
    if user.role == ROLE_ADMIN:
        from sqlalchemy import select
        with c.db() as db:
            owners = {u.id: u.name for u in db.execute(select(User)).scalars().all()}
    st["boards"] = [{**b, "owner_name": owners.get(b.get("owner_id") or "")} for b in st["boards"] if b.get("id") in visible]
    st["is_admin"] = user.role == ROLE_ADMIN
    return st


@router.get("/connections/boards")
def list_boards(user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    from sqlalchemy import select
    owners: Dict[str, str] = {}
    if user.role == ROLE_ADMIN:
        with c.db() as db:
            owners = {u.id: u.name for u in db.execute(select(User)).scalars().all()}
    items = []
    for b in _visible(c, user):
        d = b.to_dict()
        d["owner_name"] = owners.get(b.owner_id) if b.owner_id else None
        d["can_edit"] = user.role == ROLE_ADMIN or b.owner_id == user.id
        items.append(d)
    return {"items": items, "can_manage_credentials": user.role == ROLE_ADMIN}


@router.post("/connections/boards")
def add_board(body: BoardCreate, user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    email, token = (body.email or "").strip(), (body.token or "").strip()
    if not (body.email_env and body.token_env) and not (email and token) and not c.jira_boards.default_credentials_info()["configured"]:
        raise AppError("Atlassian email and API token are required to add a board")
    cfg = c.jira_boards.add(body.url, body.label, body.enabled, body.email_env, body.token_env, body.excel_board_names,
                            test=body.test, email=email or None, token=token or None, people=body.people,
                            owner_id=user.id)
    # Remember the credentials used so the next board can be added without typing them again â€”
    # but never overwrite a default that is already configured (other boards depend on it).
    if email and token and not c.jira_boards.default_credentials_info()["configured"]:
        c.jira_boards.set_default_credentials(email, token)
    c.bus.publish(Events.JIRA_BOARDS_CHANGED, board=cfg.label)
    return cfg.to_dict()


@router.put("/connections/boards/{board_id}")
def update_board(board_id: str, body: BoardUpdate, user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    _owned(c, user, board_id)
    changes = body.model_dump(exclude_none=True)
    if user.role != ROLE_ADMIN:
        changes.pop("owner_id", None)
    cfg = c.jira_boards.update(board_id, **changes)
    c.bus.publish(Events.JIRA_BOARDS_CHANGED, board=cfg.label)
    return cfg.to_dict()


@router.get("/connections/boards/{board_id}/assignees")
def board_assignees(board_id: str, user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    cfg = _owned(c, user, board_id)
    names = c.jira_source.assignees(board_id)
    if not names:
        # not loaded yet (e.g. Excel mode) -> peek at the board
        try:
            client = c.jira_boards.client_for(cfg)
            from app.services.jira_data_source import clean_person
            issues = client.board_issues_raw(cfg.board_id, f"updated >= -{c.data.status()['lookback_days']}d", ["assignee"], expand="", max_results=1000)
            names = sorted({clean_person(((i.get("fields") or {}).get("assignee") or {}).get("displayName")) or "Unassigned" for i in issues})
        except Exception as exc:  # noqa: BLE001
            return {"board_id": board_id, "assignees": [], "selected": cfg.people, "error": getattr(exc, "message", str(exc))}
    return {"board_id": board_id, "assignees": names, "selected": cfg.people}


@router.get("/connections/credentials", dependencies=[Depends(admin_only)])
def get_credentials(c: Container = Depends(container)) -> Dict[str, Any]:
    return c.jira_boards.default_credentials_info()


@router.put("/connections/credentials", dependencies=[Depends(admin_only)])
def put_credentials(body: DefaultCredentials, c: Container = Depends(container)) -> Dict[str, Any]:
    c.jira_boards.set_default_credentials(body.email.strip(), body.token.strip())
    c.bus.publish(Events.JIRA_BOARDS_CHANGED, board="credentials")
    return c.jira_boards.default_credentials_info()


@router.delete("/connections/credentials", dependencies=[Depends(admin_only)])
def delete_credentials(c: Container = Depends(container)) -> Dict[str, Any]:
    c.jira_boards.clear_default_credentials()
    c.bus.publish(Events.JIRA_BOARDS_CHANGED, board="credentials")
    return c.jira_boards.default_credentials_info()


@router.delete("/connections/boards/{board_id}")
def delete_board(board_id: str, user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    _owned(c, user, board_id)
    c.jira_boards.remove(board_id)
    c.bus.publish(Events.JIRA_BOARDS_CHANGED, board=board_id)
    return {"removed": board_id}


@router.post("/connections/boards/{board_id}/test")
def test_board(board_id: str, user: User = Depends(managers), c: Container = Depends(container)) -> Dict[str, Any]:
    _owned(c, user, board_id)
    return c.jira_boards.test(board_id)


@router.post("/connections/test")
def test_url(body: BoardTest, c: Container = Depends(container)) -> Dict[str, Any]:
    return c.jira_boards.test_url(body.url, body.email_env, body.token_env, body.email, body.token)


@router.get("/connections/discover")
def discover(base_url: Optional[str] = Query(None), project: Optional[List[str]] = Query(None),
                   c: Container = Depends(container)) -> Dict[str, Any]:
    sites = [base_url] if base_url else (c.jira_boards.sites() or [])
    projects = project or sorted({k.split("-")[0] for ids in c.store.activities()["ticket_ids"] for k in (ids or [])})
    out: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    for site in sites:
        try:
            out.extend({**b, "base_url": site} for b in c.jira_boards.discover(site, projects))
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI per site
            errors.append({"site": site, "error": getattr(exc, "message", str(exc))})
    return {"items": out, "projects": projects, "sites": sites, "errors": errors}


@router.get("/connections/me")
def me(base_url: Optional[str] = Query(None), c: Container = Depends(container)) -> Dict[str, Any]:
    site = base_url or (c.jira_boards.sites()[0] if c.jira_boards.sites() else None)
    if not site:
        from app.core.exceptions import ValidationFailedError
        raise ValidationFailedError("No Jira site configured yet. Add a board link first or pass base_url.")
    data = c.jira_pool.for_site(site).myself()
    return {"site": site, "display_name": data.get("displayName"), "email": data.get("emailAddress"),
            "account_id": data.get("accountId"), "active": data.get("active")}


# ---------------------------------------------------------------- sync / reconciliation
@router.post("/live/sync")
def sync(force: bool = Query(False), board_id: Optional[str] = Query(None), user: User = Depends(managers),
         c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    if board_id:
        _owned(c, user, board_id)
    return c.jira.sync(force=force, board_id=board_id)


@router.get("/live/status")
def live_status(c: Container = Depends(container)) -> Dict[str, Any]:
    return c.jira.status()


@router.get("/live/reconciliation")
def reconciliation(include_missing: bool = Query(True), f: Filters = Depends(filters),
                         c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    rf = c.analytics.resolve_filters(f)
    return {"period": c.analytics.period_info(rf, c.analytics.scope(rf)[2]), "filters": rf.to_dict(),
            **c.jira.reconcile(rf, include_missing=include_missing)}


@router.get("/live/reconciliation/file/{file_id}")
def reconciliation_file(file_id: str, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.excel.file_detail(file_id)  # 404 if unknown
    return c.jira.reconcile(None, file_id=file_id, include_missing=False)


@router.get("/live/issues/{key}")
def live_issue(key: str, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.jira.ensure_synced()
    data = c.jira.issue(key)
    if data is None:
        from app.core.exceptions import NotFoundError
        raise NotFoundError(f"Issue {key} was not fetched from Jira (not found, not synced, or no access)")
    return data


@router.get("/live/lookup")
def lookup(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.jira.ensure_synced()
    return {"items": c.jira.ticket_lookup(), "last_sync": c.jira.status()["last_sync"]}


# ---------------------------------------------------------------- users
@router.get("/live/users")
def users(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.jira.ensure_synced()
    return {"jira_users": c.jira.all_jira_users(), "mapping": c.jira.user_map_summary()}


@router.put("/live/user-map", dependencies=[Depends(admin_only)])
def set_user_map(body: UserMapping, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.jira.set_user_mapping(body.employee, body.account_id, body.display_name, body.email)
    c.analytics.invalidate()
    return {"mapping": c.jira.user_map_summary()}
