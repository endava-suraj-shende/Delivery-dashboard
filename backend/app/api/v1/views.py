"""Saved views: a named page + filter query that can be reopened or shared with other viewers."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.auth_deps import active_user
from app.core.exceptions import NotFoundError, ValidationFailedError
from app.db.base import get_db
from app.db.models import SavedView, User

router = APIRouter(prefix="/views", tags=["Saved views"], dependencies=[Depends(active_user)])
MAX_VIEWS = 50
_PATH = re.compile(r"^/[A-Za-z0-9_\-/%.]*$")


class ViewBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    path: str = Field(..., max_length=255)
    query: str = Field("", max_length=2000)
    shared: bool = False


class ViewPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    shared: Optional[bool] = None
    query: Optional[str] = Field(None, max_length=2000)


def _dto(v: SavedView, user: User, owners: Dict[str, User]) -> Dict[str, Any]:
    d = v.to_dict()
    o = owners.get(v.owner_id)
    d["owner"] = {"name": o.name, "email": o.email} if o else None
    d["mine"] = v.owner_id == user.id
    d["url"] = v.path + ("?" + v.query if v.query else "")
    return d


@router.get("")
def list_views(user: User = Depends(active_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    rows: List[SavedView] = db.execute(select(SavedView).where(or_(SavedView.owner_id == user.id, SavedView.shared.is_(True)))
                                       .order_by(SavedView.updated_at.desc())).scalars().all()
    owners = {u.id: u for u in db.execute(select(User).where(User.id.in_({r.owner_id for r in rows}))).scalars().all()} if rows else {}
    return {"items": [_dto(r, user, owners) for r in rows]}


@router.post("")
def create_view(body: ViewBody, user: User = Depends(active_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    if not _PATH.match(body.path) or ".." in body.path:
        raise ValidationFailedError("Invalid path")
    count = db.execute(select(SavedView).where(SavedView.owner_id == user.id)).scalars().all()
    if len(count) >= MAX_VIEWS:
        raise ValidationFailedError(f"You already have {MAX_VIEWS} saved views; delete one first")
    row = SavedView(owner_id=user.id, name=body.name.strip(), path=body.path, query=body.query.lstrip("?"), shared=body.shared and user.role != "guest")
    db.add(row)
    db.commit()
    return _dto(row, user, {user.id: user})


@router.patch("/{view_id}")
def update_view(view_id: str, body: ViewPatch, user: User = Depends(active_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = db.get(SavedView, view_id)
    if row is None or (row.owner_id != user.id and not (user.role == "admin" and user.is_superuser)):
        raise NotFoundError("View not found")
    if body.name is not None:
        row.name = body.name.strip()
    if body.shared is not None:
        row.shared = body.shared and user.role != "guest"
    if body.query is not None:
        row.query = body.query.lstrip("?")
    db.commit()
    return _dto(row, user, {row.owner_id: db.get(User, row.owner_id)})


@router.delete("/{view_id}")
def delete_view(view_id: str, user: User = Depends(active_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = db.get(SavedView, view_id)
    if row is None or (row.owner_id != user.id and not (user.role == "admin" and user.is_superuser)):
        raise NotFoundError("View not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
