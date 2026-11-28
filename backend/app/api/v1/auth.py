"""Authentication endpoints (sign-up, verification, login, password management)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth_deps import current_user, optional_user
from app.api.deps import container
from app.db.base import get_db
from app.db.models import ROLE_LABELS, User
from app.services.container import Container
from app.schemas import responses as R

router = APIRouter(prefix="/auth", tags=["Auth"])


class SignUp(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: str
    password: str
    confirm_password: str
    requested_role: str = "employee"
    auth_code: Optional[str] = None


class Login(BaseModel):
    email: str
    password: str


class EmailOnly(BaseModel):
    email: str


class TokenOnly(BaseModel):
    token: str


class ResetPassword(BaseModel):
    token: str
    password: str
    confirm_password: str


class ChangePassword(BaseModel):
    current_password: str
    password: str
    confirm_password: str


def _set_cookie(resp: Response, c: Container, token: str) -> None:
    resp.set_cookie(c.settings.cookie_name, token, httponly=True, samesite="lax", secure=c.settings.cookie_secure_effective,
                    max_age=c.settings.session_hours * 3600, path="/")


def _clear_cookie(resp: Response, c: Container) -> None:
    resp.delete_cookie(c.settings.cookie_name, path="/")


@router.get("/options", response_model=R.AuthOptions)
def options(c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Public: roles that can be requested and whether e-mail delivery is configured."""
    pol = c.auth.access_policy(db)
    return {"roles": [{"key": k, "label": v} for k, v in ROLE_LABELS.items()],
            "allowed_domains": [d["value"] for d in pol["domains"]],
            "email_enabled": c.email.enabled,
            "password_rules": "At least 10 characters with upper and lower case letters, a digit and a symbol.",
            "code_roles": ["employee", "dm", "admin", "guest"], "guest_days": 5,
            "sso": c.sso.public_info()}


@router.post("/signup")
def signup(body: SignUp, c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.sign_up(db, body.name, body.email, body.password, body.confirm_password, body.requested_role, body.auth_code)
    db.commit()
    return out


@router.post("/resend-verification")
def resend_verification(body: EmailOnly, c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.resend_verification(db, body.email)
    db.commit()
    return out


@router.post("/verify-email")
def verify_email(body: TokenOnly, c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.verify_email(db, body.token)
    db.commit()
    return out


@router.post("/login", response_model=R.SessionOut)
def login(body: Login, response: Response, c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.login(db, body.email, body.password)
    db.commit()
    _set_cookie(response, c, out["token"])
    from app.db.models import User as U
    u = db.get(U, out["user"]["id"])
    return {"user": _with_boards(c, u) if u else out["user"]}


SSO_STATE_COOKIE = "edd_sso"


@router.get("/sso/login", include_in_schema=True, summary="Start single sign-on (redirects to the identity provider)")
def sso_login(next: str = Query("/", max_length=200), c: Container = Depends(container)) -> RedirectResponse:
    out = c.sso.begin(next)
    resp = RedirectResponse(out["url"], status_code=302)
    resp.set_cookie(SSO_STATE_COOKIE, out["cookie"], httponly=True, samesite="lax", secure=c.settings.cookie_secure_effective,
                    max_age=600, path="/api/v1/auth/sso")
    return resp


@router.get("/sso/callback", include_in_schema=False)
def sso_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None,
                 error_description: Optional[str] = None, c: Container = Depends(container), db: Session = Depends(get_db)) -> RedirectResponse:
    from urllib.parse import quote
    front = c.settings.public_url.rstrip("/")
    if error or not code:
        return RedirectResponse(f"{front}/welcome?sso_error={quote(error_description or error or 'cancelled')}", status_code=302)
    try:
        out = c.sso.complete(db, code, state or "", request.cookies.get(SSO_STATE_COOKIE))
        db.commit()
    except Exception as e:  # noqa: BLE001 - surface the reason on the welcome page instead of a bare JSON error
        db.rollback()
        msg = getattr(e, "message", None) or str(e) or "Sign-in failed"
        resp = RedirectResponse(f"{front}/welcome?sso_error={quote(msg)}", status_code=302)
        resp.delete_cookie(SSO_STATE_COOKIE, path="/api/v1/auth/sso")
        return resp
    resp = RedirectResponse(f"{front}{out['next']}", status_code=302)
    resp.delete_cookie(SSO_STATE_COOKIE, path="/api/v1/auth/sso")
    _set_cookie(resp, c, out["token"])
    return resp


@router.post("/logout")
def logout(response: Response, c: Container = Depends(container)) -> Dict[str, Any]:
    _clear_cookie(response, c)
    return {"ok": True}


@router.post("/logout-all")
def logout_all(response: Response, user: User = Depends(current_user), c: Container = Depends(container),
               db: Session = Depends(get_db)) -> Dict[str, Any]:
    c.auth.logout_everywhere(db, user)
    db.commit()
    _clear_cookie(response, c)
    return {"ok": True}


def _with_boards(c: Container, user: User) -> Dict[str, Any]:
    d = user.to_dict()
    if user.role == "dm":
        from app.api.auth_deps import in_demo, visible_board_ids
        ws = c.demo() if in_demo(user) else c
        ids = visible_board_ids(ws, user) or set()
        d["board_count"] = len(ids)
    return d


@router.get("/me", response_model=R.SessionOut)
def me(user: Optional[User] = Depends(optional_user), c: Container = Depends(container)) -> Dict[str, Any]:
    return {"user": _with_boards(c, user) if user else None}


@router.post("/forgot-password")
def forgot_password(body: EmailOnly, c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.forgot_password(db, body.email)
    db.commit()
    return {"ok": True, **out}


@router.post("/reset-password")
def reset_password(body: ResetPassword, c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.reset_password(db, body.token, body.password, body.confirm_password)
    db.commit()
    return {"ok": True, **out}


@router.post("/change-password")
def change_password(body: ChangePassword, response: Response, request: Request, user: User = Depends(current_user),
                    c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    c.auth.change_password(db, user, body.current_password, body.password, body.confirm_password)
    db.commit()
    # token_version changed: issue a fresh session so the current browser stays signed in
    from app.core.security import create_session_token
    _set_cookie(response, c, create_session_token(c.auth._secret, user.id, user.token_version, c.settings.session_hours))
    return {"ok": True, "user": user.to_dict()}
