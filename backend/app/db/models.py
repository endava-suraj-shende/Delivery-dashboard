"""ORM models. Passwords are stored as Argon2 hashes only - never reversible."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

ROLE_EMPLOYEE = "employee"
ROLE_DM = "dm"
ROLE_ADMIN = "admin"
ROLE_GUEST = "guest"
ROLES = (ROLE_EMPLOYEE, ROLE_DM, ROLE_ADMIN, ROLE_GUEST)
ROLE_LABELS = {ROLE_EMPLOYEE: "Employee", ROLE_DM: "Delivery manager", ROLE_ADMIN: "Admin", ROLE_GUEST: "Guest"}
CODE_ROLES = (ROLE_EMPLOYEE, ROLE_DM, ROLE_GUEST)  # roles that can be granted through an auth code
GUEST_ACCESS_DAYS = 5

STATUS_PENDING_VERIFICATION = "pending_verification"
STATUS_PENDING_APPROVAL = "pending_approval"
STATUS_ACTIVE = "active"
STATUS_REJECTED = "rejected"
STATUS_DISABLED = "disabled"
STATUSES = (STATUS_PENDING_VERIFICATION, STATUS_PENDING_APPROVAL, STATUS_ACTIVE, STATUS_REJECTED, STATUS_DISABLED)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return uuid.uuid4().hex


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=ROLE_EMPLOYEE)
    requested_role: Mapped[str] = mapped_column(String(16), nullable=False, default=ROLE_EMPLOYEE)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=STATUS_PENDING_VERIFICATION, index=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    access_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # guests only
    auth_code_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # code used at sign-up
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    tokens: Mapped[list["AuthToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    board_access: Mapped[list["UserBoardAccess"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def is_active(self) -> bool:
        return self.status == STATUS_ACTIVE

    @property
    def access_expired(self) -> bool:
        return bool(self.access_expires_at and self.access_expires_at < utcnow())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "email": self.email, "name": self.name, "role": self.role,
            "requested_role": self.requested_role, "status": self.status,
            "must_change_password": self.must_change_password,
            "email_verified_at": self.email_verified_at.isoformat() if self.email_verified_at else None,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "rejection_reason": self.rejection_reason,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "access_expires_at": self.access_expires_at.isoformat() if self.access_expires_at else None,
            "access_expired": self.access_expired,
            "board_ids": [b.board_id for b in self.board_access] if self.role == ROLE_DM else [],
        }


class AuthToken(Base):
    """One-time tokens for e-mail verification and password reset. Only the SHA-256 hash is stored."""
    __tablename__ = "auth_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # verify | reset
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    user: Mapped[User] = relationship(back_populates="tokens")


class AccessRule(Base):
    """Sign-up policy: allowed e-mail domains and individually allow-listed addresses."""
    __tablename__ = "access_rules"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # domain | email
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (Index("ix_access_rules_kind_value", "kind", "value", unique=True),)

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "value": self.value, "note": self.note,
                "created_at": self.created_at.isoformat() if self.created_at else None}


class AppSetting(Base):
    """Key -> JSON document. Holds status mapping, data-source config, default Jira credentials, user map."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class JiraBoard(Base):
    """Configured Jira board. ``owner_id`` is the delivery manager who added it (null = global / admin)."""
    __tablename__ = "jira_boards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_id: Mapped[Optional[str]] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    base_url: Mapped[str] = mapped_column(String(255), nullable=False)
    board_id: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config: Mapped[Any] = mapped_column(JSON, nullable=False)  # full BoardConfig document (token encrypted)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_jira_boards_site_board", "base_url", "board_id", unique=True),)


class AuthCode(Base):
    """Reusable access code handed out by the superuser. Grants a role (and optionally one board) at sign-up."""
    __tablename__ = "auth_codes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    board_id: Mapped[Optional[str]] = mapped_column(String(32), ForeignKey("jira_boards.id", ondelete="SET NULL"), nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    @property
    def usable(self) -> bool:
        if not self.active:
            return False
        if self.expires_at and self.expires_at < utcnow():
            return False
        if self.max_uses is not None and self.uses >= self.max_uses:
            return False
        return True

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "code": self.code, "role": self.role, "board_id": self.board_id, "label": self.label,
                "active": self.active, "max_uses": self.max_uses, "uses": self.uses, "usable": self.usable,
                "expires_at": self.expires_at.isoformat() if self.expires_at else None,
                "created_at": self.created_at.isoformat() if self.created_at else None}


class UserBoardAccess(Base):
    """Board visibility granted to a delivery manager through an auth code (in addition to boards they own)."""
    __tablename__ = "user_board_access"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    board_id: Mapped[str] = mapped_column(String(32), ForeignKey("jira_boards.id", ondelete="CASCADE"), nullable=False, index=True)
    granted_via: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # auth code id
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    user: Mapped[User] = relationship(back_populates="board_access")
    __table_args__ = (Index("ix_user_board_access_pair", "user_id", "board_id", unique=True),)


class ExcelUpload(Base):
    """A workbook uploaded through the portal, with its parsed summary. Rows live in ``excel_upload_rows``."""
    __tablename__ = "excel_uploads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)  # id in the in-memory store
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    employee: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    project: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    application: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    jira_board: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    report_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    layout: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    work_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    releases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    issues: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    rows: Mapped[list["ExcelUploadRow"]] = relationship(back_populates="upload", cascade="all, delete-orphan")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "user_id": self.user_id, "file_id": self.file_id, "file_name": self.file_name,
                "size_bytes": self.size_bytes, "employee": self.employee, "project": self.project,
                "application": self.application, "jira_board": self.jira_board, "report_date": self.report_date,
                "layout": self.layout, "work_items": self.work_items, "releases": self.releases, "issues": self.issues,
                "ok": self.ok, "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None}


class ExcelUploadRow(Base):
    """One work-item (ticket) row from an uploaded workbook, with raw and normalised values."""
    __tablename__ = "excel_upload_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    upload_id: Mapped[str] = mapped_column(String(32), ForeignKey("excel_uploads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_row: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ticket_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    ticket_link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    application: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    work_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    work_type_raw: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    work_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    work_status_raw: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    work_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prod_required: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    dev_deployment_raw: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    dev_deployment: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prod_deployment: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    comments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    upload: Mapped[ExcelUpload] = relationship(back_populates="rows")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "upload_id": self.upload_id, "source_row": self.source_row, "ticket_id": self.ticket_id,
                "ticket_link": self.ticket_link, "application": self.application, "work_details": self.work_details,
                "work_type_raw": self.work_type_raw, "work_type": self.work_type, "work_status_raw": self.work_status_raw,
                "work_status": self.work_status, "prod_required": self.prod_required,
                "dev_deployment_raw": self.dev_deployment_raw, "dev_deployment": self.dev_deployment,
                "prod_deployment": self.prod_deployment, "comments": self.comments, "report_date": self.report_date}


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    detail: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)
