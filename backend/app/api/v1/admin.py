"""Superuser endpoints: access requests, users, sign-up policy, audit trail."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth_deps import admin_only
from app.api.deps import container
from app.db.base import get_db
from app.db.models import AuditLog, User
from app.services.container import Container

router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(admin_only)])


class Approve(BaseModel):
    role: Optional[str] = None


class Reject(BaseModel):
    reason: Optional[str] = None


class SetRole(BaseModel):
    role: str


class Rule(BaseModel):
    kind: str
    value: str
    note: Optional[str] = None


class Extend(BaseModel):
    until: Optional[str] = None
    days: Optional[int] = None


class CodeCreate(BaseModel):
    role: str
    label: Optional[str] = None
    board_id: Optional[str] = None
    expires_days: Optional[int] = None
    max_uses: Optional[int] = None
    code: Optional[str] = None


class BoardAccess(BaseModel):
    board_ids: List[str]


@router.get("/users")
def list_users(status: Optional[str] = Query(None), q: Optional[str] = Query(None),
               c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    return {"items": c.auth.list_users(db, status, q), "counts": c.auth.counts(db)}


@router.post("/users/{user_id}/approve")
def approve(user_id: str, body: Approve, actor: User = Depends(admin_only), c: Container = Depends(container),
            db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.approve(db, actor, user_id, body.role)
    db.commit()
    return out


@router.post("/users/{user_id}/reject")
def reject(user_id: str, body: Reject, actor: User = Depends(admin_only), c: Container = Depends(container),
           db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.reject(db, actor, user_id, body.reason)
    db.commit()
    return out


@router.post("/users/{user_id}/role")
def set_role(user_id: str, body: SetRole, actor: User = Depends(admin_only), c: Container = Depends(container),
             db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_role(db, actor, user_id, body.role)
    db.commit()
    return out


@router.post("/users/{user_id}/disable")
def disable(user_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
            db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_enabled(db, actor, user_id, False)
    db.commit()
    return out


@router.post("/users/{user_id}/enable")
def enable(user_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
           db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_enabled(db, actor, user_id, True)
    db.commit()
    return out


@router.post("/users/{user_id}/temporary-password")
def temporary_password(user_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                       db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.admin_reset_password(db, actor, user_id)
    db.commit()
    return out


class Superuser(BaseModel):
    enabled: bool


@router.post("/users/{user_id}/superuser")
def set_superuser(user_id: str, body: Superuser, actor: User = Depends(admin_only), c: Container = Depends(container),
                  db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_superuser(db, actor, user_id, body.enabled)
    db.commit()
    return out


@router.post("/users/{user_id}/extend")
def extend(user_id: str, body: Extend, actor: User = Depends(admin_only), c: Container = Depends(container),
           db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.extend_access(db, actor, user_id, body.until, body.days)
    db.commit()
    return out


@router.put("/users/{user_id}/boards")
def set_boards(user_id: str, body: BoardAccess, actor: User = Depends(admin_only), c: Container = Depends(container),
               db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_board_access(db, actor, user_id, body.board_ids)
    db.commit()
    return out


@router.get("/delivery-managers")
def delivery_managers(c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    return {"items": c.auth.dm_overview(db, c.jira_boards.list()),
            "boards": [{"id": b.id, "label": b.label, "owner_id": b.owner_id} for b in c.jira_boards.list()]}


@router.post("/users/{user_id}/boards/{board_id}")
def grant_board(user_id: str, board_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.grant_board(db, actor, user_id, board_id)
    db.commit()
    return out


@router.delete("/users/{user_id}/boards/{board_id}")
def revoke_board(user_id: str, board_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                 db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.revoke_board(db, actor, user_id, board_id)
    db.commit()
    return out


@router.post("/boards/{board_id}/regenerate-code")
def regenerate_board_code(board_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                          db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.regenerate_board_code(db, actor, board_id)
    db.commit()
    return out


@router.get("/codes")
def list_codes(c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    return {"items": c.auth.list_codes(db),
            "boards": [{"id": b.id, "label": b.label} for b in c.jira_boards.list()]}


@router.post("/codes")
def create_code(body: CodeCreate, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.create_code(db, actor, body.role, body.label, body.board_id, body.expires_days, body.max_uses, body.code)
    db.commit()
    return out


@router.post("/codes/{code_id}/revoke")
def revoke_code(code_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_code_active(db, actor, code_id, False)
    db.commit()
    return out


@router.post("/codes/{code_id}/enable")
def enable_code(code_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    out = c.auth.set_code_active(db, actor, code_id, True)
    db.commit()
    return out


@router.delete("/codes/{code_id}")
def delete_code(code_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    c.auth.delete_code(db, actor, code_id)
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    c.auth.delete_user(db, actor, user_id)
    db.commit()
    return {"ok": True}


@router.get("/access-policy")
def access_policy(c: Container = Depends(container), db: Session = Depends(get_db)) -> Dict[str, Any]:
    return c.auth.access_policy(db)


@router.post("/access-policy")
def add_rule(body: Rule, actor: User = Depends(admin_only), c: Container = Depends(container),
             db: Session = Depends(get_db)) -> Dict[str, Any]:
    rule = c.auth.add_rule(db, actor.id, body.kind, body.value, body.note)
    db.commit()
    return rule.to_dict()


@router.delete("/access-policy/{rule_id}")
def remove_rule(rule_id: str, actor: User = Depends(admin_only), c: Container = Depends(container),
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    c.auth.remove_rule(db, actor.id, rule_id)
    db.commit()
    return {"ok": True}


@router.get("/audit")
def audit(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)) -> Dict[str, Any]:
    rows = db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)).scalars().all()
    users = {u.id: u for u in db.execute(select(User)).scalars().all()}
    return {"items": [{"id": r.id, "action": r.action, "target": r.target, "detail": r.detail,
                       "actor": users[r.actor_id].email if r.actor_id in users else r.actor_id,
                       "created_at": r.created_at.isoformat()} for r in rows]}
