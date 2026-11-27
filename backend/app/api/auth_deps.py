"""Authentication dependencies: current user, role guards, data scoping for delivery managers."""
from __future__ import annotations

from typing import Callable, List, Optional

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.db.models import ROLE_ADMIN, ROLE_DM, ROLE_EMPLOYEE, ROLE_GUEST, STATUS_ACTIVE, User, UserBoardAccess
from sqlalchemy import select
from app.services.auth_service import AuthError, ForbiddenError
from app.services.container import Container, get_container


def _token_from_request(request: Request, cookie_name: str) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(cookie_name)


def optional_user(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    c = get_container()
    return c.auth.user_from_token(db, _token_from_request(request, c.settings.cookie_name))


def current_user(user: Optional[User] = Depends(optional_user)) -> User:
    if user is None:
        raise AuthError("Sign in to continue")
    return user


def active_user(user: User = Depends(current_user)) -> User:
    if user.status != STATUS_ACTIVE:
        raise ForbiddenError("Your account is waiting for approval")
    if user.role == ROLE_GUEST and user.access_expired:
        raise ForbiddenError("Your guest access has expired. Ask a superuser to extend it.", {"access_expired": True})
    if user.must_change_password:
        raise ForbiddenError("You must change your temporary password before continuing", {"must_change_password": True})
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    def _dep(user: User = Depends(active_user)) -> User:
        if user.role not in roles:
            raise ForbiddenError("You do not have permission to access this resource")
        return user
    return _dep


def superuser_only(user: User = Depends(active_user)) -> User:
    if user.role != ROLE_ADMIN or not user.is_superuser:
        raise ForbiddenError("Superuser access is required")
    return user


admin_only = superuser_only  # configuration / user management: superuser only
admins = require_roles(ROLE_ADMIN)  # read everything, change nothing
managers = require_roles(ROLE_ADMIN, ROLE_DM)
viewers = require_roles(ROLE_ADMIN, ROLE_DM, ROLE_GUEST)  # dashboards (guests see demo data)
anyone_active = require_roles(ROLE_ADMIN, ROLE_DM, ROLE_EMPLOYEE, ROLE_GUEST)


def in_demo(user: Optional[User]) -> bool:
    return bool(user) and (user.role == ROLE_GUEST or user.demo_only)


def workspace(user: User = Depends(active_user)):
    """The data workspace for this user: the real container, or the synthetic demo workspace
    (guests, demo-only accounts and superusers who switched demo mode on)."""
    c = get_container()
    if in_demo(user):
        ws = c.demo()
        ws.ensure_loaded()
        return ws
    return c


def workspace_db(ws=Depends(workspace)):
    """Database session bound to the active workspace (real or demo)."""
    s = ws.db()
    try:
        yield s
    finally:
        s.close()


# Employees may only upload workbooks and check that the upload worked.
EMPLOYEE_EXCEL_ALLOWED = {("GET", "/status"), ("GET", "/files"), ("GET", "/history"), ("GET", "/sheets"), ("GET", "/my"),
                          ("GET", "/preview"), ("POST", "/upload"), ("POST", "/validate")}


def excel_access(request: Request, user: User = Depends(active_user)) -> User:
    if user.role == ROLE_DM or (user.role == ROLE_ADMIN and user.is_superuser):
        return user
    if user.role == ROLE_ADMIN:
        if request.method.upper() == "GET":
            return user
        raise ForbiddenError("Only superusers can change data")
    path = request.url.path.split("/api/v1/excel", 1)[-1] or "/"
    base = "/" + path.strip("/").split("/")[0] if path.strip("/") else "/"
    if user.role == ROLE_GUEST:
        if (request.method.upper(), base) == ("GET", "/status"):
            return user
        raise ForbiddenError("Guests can only view dashboards")
    if (request.method.upper(), base) in EMPLOYEE_EXCEL_ALLOWED:
        return user
    raise ForbiddenError("Employees can only upload workbooks and view upload status")


def visible_board_ids(c: Container, user: User) -> Optional[set]:
    """Boards a delivery manager may see (owned + granted via auth code / admin); None = unrestricted."""
    if user.role in (ROLE_ADMIN, ROLE_GUEST):
        return None
    uid = user.id
    with c.db() as db:
        if user.demo_only:
            # demo-only accounts live in the real DB; their board ownership is seeded in the demo DB under the same e-mail
            twin = db.execute(select(User).where(User.email == user.email)).scalar_one_or_none()
            uid = twin.id if twin else uid
        granted = {r.board_id for r in db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == uid)).scalars().all()}
    return granted | {b.id for b in c.jira_boards.list() if b.owner_id == uid}


def owned_board_labels(c: Container, user: User) -> Optional[List[str]]:
    """Board labels a delivery manager may see; None = unrestricted (admin, guest on demo data)."""
    ids = visible_board_ids(c, user)
    if ids is None:
        return None
    return [b.label or b.board_name or f"Board {b.board_id}" for b in c.jira_boards.list() if b.id in ids]
