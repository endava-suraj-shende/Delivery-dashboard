"""Authentication / account management.

Rules
* Sign-up requires an allowed e-mail (domain list or individual allow-list) and a strong password.
* E-mail must be verified first. Employees are active immediately after verification;
  delivery managers and admins wait for superuser approval.
* Passwords are Argon2id hashes; nobody (including admins) can read them. Admins may issue a
  temporary password which must be changed at first sign-in.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import AppError, NotFoundError
from app.core.security import (constant_time_equals, create_session_token, decode_session_token, generate_temp_password,
                               hash_password, needs_rehash, new_token, password_problems, token_hash, verify_password)
import secrets

from app.db.models import (CODE_KIND_BOARD, CODE_KIND_ROLE, CODE_ROLES, GUEST_ACCESS_DAYS, ROLE_ADMIN, ROLE_DM, ROLE_EMPLOYEE, ROLE_GUEST, ROLE_LABELS, ROLES,
                           STATUS_ACTIVE, STATUS_DISABLED, STATUS_PENDING_APPROVAL, STATUS_PENDING_VERIFICATION,
                           STATUS_REJECTED, AccessRule, AuditLog, AuthCode, AuthToken, JiraBoard, User, UserBoardAccess,
                           utcnow)
from app.services.email_service import EmailService


class AuthError(AppError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


class AuthService:
    def __init__(self, settings: Settings, email: EmailService, secret: str, box: Any = None) -> None:
        self.s = settings
        self.email = email
        self._secret = secret
        self._box = box  # SecretBox: auth codes are stored encrypted, looked up by sha256

    def _code_plain(self, row: AuthCode) -> Optional[str]:
        try:
            return self._box.decrypt(row.code_enc) if self._box else None
        except Exception:  # noqa: BLE001 - key rotated: code can no longer be shown
            return None

    def _new_code_row(self, value: str, **kw: Any) -> AuthCode:
        if not self._box:
            raise AppError("Secret storage is not configured")
        return AuthCode(code_hash=token_hash(value), code_enc=self._box.encrypt(value), **kw)

    # ------------------------------------------------------------------ helpers
    def _audit(self, db: Session, actor: Optional[str], action: str, target: Optional[str] = None, **detail: Any) -> None:
        db.add(AuditLog(actor_id=actor, action=action, target=target, detail=detail or None))

    def _link(self, path: str, token: str) -> str:
        return f"{self.s.public_url.rstrip('/')}/{path.lstrip('/')}?token={token}"

    def _issue_token(self, db: Session, user: User, kind: str, lifetime: timedelta) -> str:
        for t in db.execute(select(AuthToken).where(AuthToken.user_id == user.id, AuthToken.kind == kind,
                                                    AuthToken.used_at.is_(None))).scalars():
            t.used_at = utcnow()  # invalidate earlier links of the same kind
        raw = new_token()
        db.add(AuthToken(user_id=user.id, kind=kind, token_hash=token_hash(raw), expires_at=utcnow() + lifetime))
        return raw

    def _consume_token(self, db: Session, raw: str, kind: str) -> User:
        row = db.execute(select(AuthToken).where(AuthToken.token_hash == token_hash(raw or ""),
                                                 AuthToken.kind == kind)).scalar_one_or_none()
        if row is None or row.used_at is not None:
            raise AppError("This link is invalid or has already been used.")
        if row.expires_at < utcnow():
            raise AppError("This link has expired. Please request a new one.")
        row.used_at = utcnow()
        return row.user

    def _debug_payload(self, link: str, result: Dict[str, Any]) -> Dict[str, Any]:
        out = {"email_sent": bool(result.get("sent"))}
        if not result.get("sent") and self.s.environment in ("local", "dev", "test"):
            out["debug_link"] = link  # local development only: lets the flow complete without e-mail
        return out

    # ------------------------------------------------------------------ sign-up policy
    def access_policy(self, db: Session) -> Dict[str, Any]:
        rules = db.execute(select(AccessRule).order_by(AccessRule.kind, AccessRule.value)).scalars().all()
        domains = [r for r in rules if r.kind == "domain"]
        emails = [r for r in rules if r.kind == "email"]
        return {"domains": [r.to_dict() for r in domains], "emails": [r.to_dict() for r in emails],
                "defaults": self.s.default_allowed_domains}

    def ensure_default_policy(self, db: Session) -> None:
        if db.execute(select(func.count()).select_from(AccessRule).where(AccessRule.kind == "domain")).scalar() == 0:
            for d in self.s.default_allowed_domains:
                db.add(AccessRule(kind="domain", value=d.lower().lstrip("@"), note="default"))

    def is_email_allowed(self, db: Session, email: str) -> bool:
        email = normalize_email(email)
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        rules = db.execute(select(AccessRule)).scalars().all()
        for r in rules:
            if r.kind == "email" and r.value.lower() == email:
                return True
            if r.kind == "domain" and r.value.lower() == domain:
                return True
        return False

    def add_rule(self, db: Session, actor: str, kind: str, value: str, note: Optional[str] = None) -> AccessRule:
        if kind not in ("domain", "email"):
            raise AppError("kind must be 'domain' or 'email'")
        value = normalize_email(value).lstrip("@")
        if not value or (kind == "email" and "@" not in value) or (kind == "domain" and "." not in value):
            raise AppError("Enter a valid value")
        exists = db.execute(select(AccessRule).where(AccessRule.kind == kind, AccessRule.value == value)).scalar_one_or_none()
        if exists:
            return exists
        rule = AccessRule(kind=kind, value=value, note=note, created_by=actor)
        db.add(rule)
        self._audit(db, actor, "access_rule.add", value, kind=kind)
        db.flush()
        return rule

    def remove_rule(self, db: Session, actor: str, rule_id: str) -> None:
        rule = db.get(AccessRule, rule_id)
        if rule is None:
            raise NotFoundError("Rule not found")
        if rule.kind == "domain" and db.execute(select(func.count()).select_from(AccessRule).where(AccessRule.kind == "domain")).scalar() <= 1:
            raise AppError("At least one allowed domain is required")
        self._audit(db, actor, "access_rule.remove", rule.value, kind=rule.kind)
        db.delete(rule)

    # ------------------------------------------------------------------ sign-up / verification
    # ------------------------------------------------------------------ auth codes
    def _find_code(self, db: Session, code: str) -> Optional[AuthCode]:
        code = (code or "").strip().upper()
        if not code:
            return None
        return db.execute(select(AuthCode).where(AuthCode.code_hash == token_hash(code))).scalar_one_or_none()

    def _consume_code(self, db: Session, user: User, code: AuthCode) -> None:
        code.uses += 1
        user.auth_code_id = code.id
        if code.role == ROLE_DM and code.board_id:
            exists = db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == user.id,
                                                              UserBoardAccess.board_id == code.board_id)).scalar_one_or_none()
            if exists is None:
                db.add(UserBoardAccess(user_id=user.id, board_id=code.board_id, granted_via=code.id))

    def sign_up(self, db: Session, name: str, email: str, password: str, confirm: str, requested_role: str,
                auth_code: Optional[str] = None) -> Dict[str, Any]:
        email = normalize_email(email)
        name = (name or "").strip()
        if len(name) < 2:
            raise AppError("Enter your full name")
        if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
            raise AppError("Enter a valid e-mail address")
        if requested_role not in ROLES:
            raise AppError("Choose a role")
        if password != confirm:
            raise AppError("Passwords do not match")
        probs = password_problems(password)
        if probs:
            raise AppError("Password must contain " + ", ".join(probs))
        # auth code: optional for employee / delivery manager (fast path), mandatory for guests, not used by admins
        code: Optional[AuthCode] = None
        if requested_role in CODE_ROLES:
            if not (auth_code or "").strip():
                if requested_role != ROLE_ADMIN:
                    raise AppError("Auth code is required")
            if (auth_code or "").strip():
                code = self._find_code(db, auth_code or "")
                if code is None or not code.usable or code.kind != CODE_KIND_ROLE or code.role != requested_role:
                    raise AppError("Auth code is wrong")
        # employees, delivery managers and admins must use a company address; guests are vouched for by their code
        if requested_role != ROLE_GUEST and not self.is_email_allowed(db, email):
            raise AppError("This e-mail address is not allowed to register. Use your company e-mail or ask an administrator to allow-list your address.")
        existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing is not None:
            if existing.status == STATUS_PENDING_VERIFICATION:
                # let the person restart the flow (e.g. lost e-mail) without leaking account state to others
                existing.name, existing.password_hash, existing.requested_role, existing.role = name, hash_password(password), requested_role, requested_role
                user = existing
            else:
                raise AppError("An account with this e-mail already exists. Try signing in or resetting your password.")
        else:
            user = User(email=email, name=name, password_hash=hash_password(password), role=requested_role,
                        requested_role=requested_role, status=STATUS_PENDING_VERIFICATION)
            db.add(user)
            db.flush()
        if code is not None:
            self._consume_code(db, user, code)
        if code is not None and requested_role in (ROLE_EMPLOYEE, ROLE_DM, ROLE_ADMIN):
            # valid code: no e-mail verification and no approval needed
            user.status, user.approved_at = STATUS_ACTIVE, utcnow()
            self._audit(db, user.id, "auth.signup_code", user.email, role=requested_role, code=code.label or code.id)
            return {"status": user.status, "email": user.email, "email_sent": False, "activated": True}
        raw = self._issue_token(db, user, "verify", timedelta(hours=self.s.verify_token_hours))
        link = self._link("/verify-email", raw)
        result = self.email.send_verification(user.email, user.name, link)
        self._audit(db, user.id, "auth.signup", user.email, role=requested_role)
        return {"status": user.status, "email": user.email, **self._debug_payload(link, result)}

    def resend_verification(self, db: Session, email: str) -> Dict[str, Any]:
        user = db.execute(select(User).where(User.email == normalize_email(email))).scalar_one_or_none()
        if user is None or user.status != STATUS_PENDING_VERIFICATION:
            return {"email_sent": False}
        raw = self._issue_token(db, user, "verify", timedelta(hours=self.s.verify_token_hours))
        link = self._link("/verify-email", raw)
        return self._debug_payload(link, self.email.send_verification(user.email, user.name, link))

    def verify_email(self, db: Session, token: str) -> Dict[str, Any]:
        user = self._consume_token(db, token, "verify")
        if user.status == STATUS_PENDING_VERIFICATION:
            user.email_verified_at = utcnow()
            if user.requested_role in (ROLE_EMPLOYEE, ROLE_GUEST):
                user.status = STATUS_ACTIVE
                if user.requested_role == ROLE_GUEST:
                    user.access_expires_at = utcnow() + timedelta(days=GUEST_ACCESS_DAYS)
            else:
                user.status = STATUS_PENDING_APPROVAL
                self._notify_admins(db, f"New {ROLE_LABELS[user.requested_role]} access request",
                                    f"{user.name} ({user.email}) verified their e-mail and is waiting for approval.")
            self._audit(db, user.id, "auth.verified", user.email, status=user.status)
        return {"status": user.status, "email": user.email, "role": user.role}

    def _notify_admins(self, db: Session, subject: str, text: str) -> None:
        admins = db.execute(select(User).where(User.role == ROLE_ADMIN, User.status == STATUS_ACTIVE)).scalars().all()
        for a in admins:
            try:
                self.email.send_admin_notice(a.email, a.name, subject, text, self.s.public_url.rstrip("/") + "/admin/users")
            except Exception:  # noqa: BLE001 - notifications must never break the flow
                pass

    # ------------------------------------------------------------------ login / session
    def login(self, db: Session, email: str, password: str) -> Dict[str, Any]:
        user = db.execute(select(User).where(User.email == normalize_email(email))).scalar_one_or_none()
        generic = AuthError("Incorrect e-mail or password")
        if user is None:
            verify_password(password, hash_password("dummy-timing-equaliser"))
            raise generic
        if user.locked_until and user.locked_until > utcnow():
            mins = max(1, int((user.locked_until - utcnow()).total_seconds() // 60) + 1)
            raise AuthError(f"Too many failed attempts. Try again in {mins} minute(s).")
        if not verify_password(password, user.password_hash):
            user.failed_logins += 1
            if user.failed_logins >= self.s.max_failed_logins:
                user.locked_until = utcnow() + timedelta(minutes=self.s.lockout_minutes)
                user.failed_logins = 0
            self._audit(db, user.id, "auth.login_failed", user.email)
            db.commit()  # the request fails, but the attempt counter must persist
            raise generic
        if user.status == STATUS_PENDING_VERIFICATION:
            raise ForbiddenError("Please verify your e-mail address first. Check your inbox for the verification link.")
        if user.status == STATUS_REJECTED:
            raise ForbiddenError("Your access request was not approved. Contact your administrator.")
        if user.status == STATUS_DISABLED:
            raise ForbiddenError("This account is disabled. Contact your administrator.")
        if user.role == ROLE_GUEST and user.status == STATUS_ACTIVE and user.access_expired:
            # the 5-day window ended: park the account until a superuser extends it
            user.status = STATUS_PENDING_APPROVAL
            self._audit(db, user.id, "auth.guest_expired", user.email)
            self._notify_admins(db, "Guest access expired", f"{user.name} ({user.email}) guest access ended; extend it from User Management if needed.")
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        user.failed_logins, user.locked_until, user.last_login_at = 0, None, utcnow()
        self._audit(db, user.id, "auth.login", user.email)
        token = create_session_token(self._secret, user.id, user.token_version, self.s.session_hours)
        return {"token": token, "user": user.to_dict()}

    def user_from_token(self, db: Session, token: Optional[str]) -> Optional[User]:
        if not token:
            return None
        payload = decode_session_token(self._secret, token)
        if not payload:
            return None
        user = db.get(User, payload.get("sub"))
        if user is None or user.token_version != payload.get("ver"):
            return None
        if user.status in (STATUS_DISABLED, STATUS_REJECTED):
            return None
        return user

    def logout_everywhere(self, db: Session, user: User) -> None:
        user.token_version += 1

    # ------------------------------------------------------------------ passwords
    def forgot_password(self, db: Session, email: str) -> Dict[str, Any]:
        user = db.execute(select(User).where(User.email == normalize_email(email))).scalar_one_or_none()
        if user is None or user.status in (STATUS_PENDING_VERIFICATION, STATUS_REJECTED, STATUS_DISABLED):
            return {"email_sent": False}  # do not reveal whether the account exists
        raw = self._issue_token(db, user, "reset", timedelta(minutes=self.s.reset_token_minutes))
        link = self._link("/reset-password", raw)
        self._audit(db, user.id, "auth.reset_requested", user.email)
        return self._debug_payload(link, self.email.send_reset(user.email, user.name, link))

    def reset_password(self, db: Session, token: str, password: str, confirm: str) -> Dict[str, Any]:
        if password != confirm:
            raise AppError("Passwords do not match")
        probs = password_problems(password)
        if probs:
            raise AppError("Password must contain " + ", ".join(probs))
        user = self._consume_token(db, token, "reset")
        user.password_hash = hash_password(password)
        user.must_change_password = False
        user.failed_logins, user.locked_until = 0, None
        user.token_version += 1  # sign out other sessions
        self._audit(db, user.id, "auth.reset_done", user.email)
        return {"email": user.email}

    def change_password(self, db: Session, user: User, current: str, password: str, confirm: str) -> None:
        if not verify_password(current, user.password_hash):
            raise AppError("Current password is incorrect")
        if password != confirm:
            raise AppError("Passwords do not match")
        if constant_time_equals(current, password):
            raise AppError("Choose a different password")
        probs = password_problems(password)
        if probs:
            raise AppError("Password must contain " + ", ".join(probs))
        user.password_hash = hash_password(password)
        user.must_change_password = False
        user.token_version += 1
        self._audit(db, user.id, "auth.password_changed", user.email)

    # ------------------------------------------------------------------ admin
    def list_users(self, db: Session, status: Optional[str] = None, q: Optional[str] = None) -> List[Dict[str, Any]]:
        stmt = select(User).order_by(User.created_at.desc())
        if status:
            stmt = stmt.where(User.status == status)
        if q:
            like = f"%{q.strip().lower()}%"
            stmt = stmt.where(func.lower(User.email).like(like) | func.lower(User.name).like(like))
        return [u.to_dict() for u in db.execute(stmt).scalars().all()]

    def counts(self, db: Session) -> Dict[str, int]:
        rows = db.execute(select(User.status, func.count()).group_by(User.status)).all()
        return {s: int(n) for s, n in rows}

    def _get(self, db: Session, user_id: str) -> User:
        user = db.get(User, user_id)
        if user is None:
            raise NotFoundError("User not found")
        return user

    def approve(self, db: Session, actor: User, user_id: str, role: Optional[str] = None) -> Dict[str, Any]:
        user = self._get(db, user_id)
        if user.status not in (STATUS_PENDING_APPROVAL, STATUS_REJECTED, STATUS_PENDING_VERIFICATION):
            raise AppError("This account is not waiting for approval")
        if user.status == STATUS_PENDING_VERIFICATION:
            # superuser vouches for the address: e-mail verification is skipped
            user.email_verified_at = utcnow()
        role = role or user.requested_role
        if role not in ROLES:
            raise AppError("Unknown role")
        user.role, user.status, user.approved_at, user.approved_by, user.rejection_reason = role, STATUS_ACTIVE, utcnow(), actor.id, None
        if role == ROLE_GUEST:
            user.access_expires_at = utcnow() + timedelta(days=GUEST_ACCESS_DAYS)
        else:
            user.access_expires_at = None
        self._audit(db, actor.id, "user.approve", user.email, role=role)
        self.email.send_approved(user.email, user.name, ROLE_LABELS[role], self.s.public_url)
        return user.to_dict()

    def reject(self, db: Session, actor: User, user_id: str, reason: Optional[str]) -> Dict[str, Any]:
        user = self._get(db, user_id)
        if user.id == actor.id:
            raise AppError("You cannot reject your own account")
        user.status, user.rejection_reason, user.token_version = STATUS_REJECTED, (reason or None), user.token_version + 1
        self._audit(db, actor.id, "user.reject", user.email, reason=reason)
        self.email.send_rejected(user.email, user.name, reason)
        return user.to_dict()

    def set_role(self, db: Session, actor: User, user_id: str, role: str) -> Dict[str, Any]:
        if role not in ROLES:
            raise AppError("Unknown role")
        user = self._get(db, user_id)
        if user.id == actor.id and role != ROLE_ADMIN:
            raise AppError("You cannot remove your own admin role")
        user.role = role
        if role != ROLE_ADMIN:
            user.is_superuser = False
        user.token_version += 1
        self._audit(db, actor.id, "user.role", user.email, role=role)
        return user.to_dict()

    def set_enabled(self, db: Session, actor: User, user_id: str, enabled: bool) -> Dict[str, Any]:
        user = self._get(db, user_id)
        if user.id == actor.id:
            raise AppError("You cannot disable your own account")
        if enabled:
            if user.status != STATUS_DISABLED:
                raise AppError("Account is not disabled")
            user.status = STATUS_ACTIVE
        else:
            if user.status != STATUS_ACTIVE:
                raise AppError("Only active accounts can be disabled")
            user.status = STATUS_DISABLED
            user.token_version += 1
        self._audit(db, actor.id, "user.enable" if enabled else "user.disable", user.email)
        return user.to_dict()

    def admin_reset_password(self, db: Session, actor: User, user_id: str) -> Dict[str, Any]:
        """Issue a temporary password. It is shown once to the admin and e-mailed to the user; the old hash is discarded."""
        user = self._get(db, user_id)
        if user.status not in (STATUS_ACTIVE, STATUS_PENDING_APPROVAL):
            raise AppError("Only verified accounts can receive a temporary password")
        temp = generate_temp_password()
        user.password_hash = hash_password(temp)
        user.must_change_password = True
        user.failed_logins, user.locked_until = 0, None
        user.token_version += 1
        self._audit(db, actor.id, "user.temp_password", user.email)
        result = self.email.send_temp_password(user.email, user.name, temp, self.s.public_url)
        return {"temporary_password": temp, "email_sent": bool(result.get("sent")), "user": user.to_dict()}

    def extend_access(self, db: Session, actor: User, user_id: str, until: Optional[str], days: Optional[int]) -> Dict[str, Any]:
        """Set a new expiry for a guest (absolute date or +days from now) and re-activate the account."""
        user = self._get(db, user_id)
        if user.role != ROLE_GUEST:
            raise AppError("Only guest accounts have an expiry date")
        if until:
            try:
                new_until = datetime.fromisoformat(until.replace("Z", ""))
            except ValueError as exc:
                raise AppError("Invalid date") from exc
        else:
            new_until = utcnow() + timedelta(days=max(1, int(days or GUEST_ACCESS_DAYS)))
        if new_until <= utcnow():
            raise AppError("The new expiry must be in the future")
        user.access_expires_at = new_until
        if user.status in (STATUS_PENDING_APPROVAL, STATUS_REJECTED) and user.email_verified_at:
            user.status, user.rejection_reason = STATUS_ACTIVE, None
        self._audit(db, actor.id, "user.extend", user.email, until=new_until.isoformat())
        self.email.send_approved(user.email, user.name, f"Guest (until {new_until:%d %b %Y})", self.s.public_url)
        return user.to_dict()

    def list_codes(self, db: Session) -> List[Dict[str, Any]]:
        boards = {b.id: b for b in db.execute(select(JiraBoard)).scalars().all()}
        users = {u.id: u.name for u in db.execute(select(User)).scalars().all()}
        out = []
        for c in db.execute(select(AuthCode).order_by(AuthCode.created_at.desc())).scalars().all():
            d = c.to_dict(self._code_plain(c))
            b = boards.get(c.board_id) if c.board_id else None
            d["board_label"] = b.label if b else None
            d["board_owner"] = users.get(b.owner_id) if b and b.owner_id else None
            d["created_by_name"] = users.get(c.created_by) if c.created_by else None
            out.append(d)
        return out

    def create_code(self, db: Session, actor: User, role: str, label: Optional[str], board_id: Optional[str],
                    expires_days: Optional[int], max_uses: Optional[int], code: Optional[str] = None) -> Dict[str, Any]:
        if role not in CODE_ROLES:
            raise AppError("Codes can grant Employee, Delivery manager, Admin or Guest access")
        if board_id:
            if role != ROLE_DM:
                raise AppError("Only delivery manager codes can be tied to a board")
            if db.get(JiraBoard, board_id) is None:
                raise NotFoundError("Board not found")
        value = (code or "").strip().upper() or self._generate_code(role)
        if self._find_code(db, value) is not None:
            raise AppError("This code already exists")
        row = self._new_code_row(value, role=role, board_id=board_id or None, label=(label or "").strip() or None,
                                 expires_at=(utcnow() + timedelta(days=int(expires_days))) if expires_days else None,
                                 max_uses=int(max_uses) if max_uses else None, created_by=actor.id)
        db.add(row)
        db.flush()
        self._audit(db, actor.id, "code.create", row.id, role=role, board_id=board_id)
        return {**row.to_dict(value), "board_label": db.get(JiraBoard, board_id).label if board_id else None}

    @staticmethod
    def _generate_code(role: str) -> str:
        prefix = {ROLE_EMPLOYEE: "EMP", ROLE_DM: "DM", ROLE_ADMIN: "ADMIN", ROLE_GUEST: "GUEST", "board": "BOARD"}[role]
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return f"{prefix}-" + "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))

    def ensure_board_code(self, db: Session, board_id: str, owner_id: Optional[str]) -> AuthCode:
        """Every linked board gets one reusable BOARD-xxxx code; the superuser hands it to other delivery managers."""
        row = db.execute(select(AuthCode).where(AuthCode.kind == CODE_KIND_BOARD, AuthCode.board_id == board_id)).scalar_one_or_none()
        if row is None:
            board = db.get(JiraBoard, board_id)
            row = self._new_code_row(self._generate_code("board"), kind=CODE_KIND_BOARD, role=ROLE_DM, board_id=board_id,
                                     label=f"Board access: {board.label if board else board_id}", created_by=owner_id)
            db.add(row)
            db.flush()
            self._audit(db, owner_id, "code.board_created", row.id, board_id=board_id)
        return row

    def code_value(self, row: AuthCode) -> Optional[str]:
        return self._code_plain(row)

    def redeem_board_code(self, db: Session, user: User, code: str) -> Dict[str, Any]:
        """A signed-in delivery manager unlocks a board with its BOARD code."""
        if user.role != ROLE_DM:
            raise AppError("Only delivery managers link boards with a board code")
        row = self._find_code(db, code)
        if row is None or row.kind != CODE_KIND_BOARD or not row.usable or not row.board_id:
            raise AppError("Auth code is wrong")
        if db.get(JiraBoard, row.board_id) is None:
            raise AppError("This board no longer exists")
        exists = db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == user.id, UserBoardAccess.board_id == row.board_id)).scalar_one_or_none()
        if exists is None:
            db.add(UserBoardAccess(user_id=user.id, board_id=row.board_id, granted_via=row.id))
            row.uses += 1
        self._audit(db, user.id, "code.board_redeemed", row.id, board_id=row.board_id)
        db.flush()
        return {"board_id": row.board_id, "label": row.label}

    def set_superuser(self, db: Session, actor: User, user_id: str, enabled: bool) -> Dict[str, Any]:
        user = self._get(db, user_id)
        if user.id == actor.id and not enabled:
            raise AppError("You cannot remove your own superuser access")
        if enabled and user.role != ROLE_ADMIN:
            raise AppError("Only admins can be made superuser; change the role first")
        user.is_superuser = enabled
        user.token_version += 1
        self._audit(db, actor.id, "user.superuser" if enabled else "user.superuser_revoked", user.email)
        return user.to_dict()

    def set_code_active(self, db: Session, actor: User, code_id: str, active: bool) -> Dict[str, Any]:
        row = db.get(AuthCode, code_id)
        if row is None:
            raise NotFoundError("Code not found")
        row.active = active
        self._audit(db, actor.id, "code.enable" if active else "code.revoke", row.id)
        return row.to_dict(self._code_plain(row))

    def delete_code(self, db: Session, actor: User, code_id: str) -> None:
        row = db.get(AuthCode, code_id)
        if row is None:
            raise NotFoundError("Code not found")
        self._audit(db, actor.id, "code.delete", row.id)
        db.delete(row)

    def set_board_access(self, db: Session, actor: User, user_id: str, board_ids: List[str]) -> Dict[str, Any]:
        """Admin: replace the set of boards a delivery manager may see (in addition to boards they own)."""
        user = self._get(db, user_id)
        wanted = set(board_ids or [])
        for row in list(user.board_access):
            if row.board_id not in wanted:
                db.delete(row)
        have = {r.board_id for r in user.board_access}
        for bid in wanted - have:
            if db.get(JiraBoard, bid) is None:
                raise NotFoundError(f"Board {bid} not found")
            db.add(UserBoardAccess(user_id=user.id, board_id=bid, granted_via="admin"))
        db.flush()
        db.refresh(user)
        self._audit(db, actor.id, "user.board_access", user.email, boards=sorted(wanted))
        return user.to_dict()

    def dm_overview(self, db: Session, boards: List[Any]) -> List[Dict[str, Any]]:
        """One row per delivery manager: boards they own and boards granted to them."""
        by_id = {b.id: b for b in boards}
        grants = db.execute(select(UserBoardAccess)).scalars().all()
        granted: Dict[str, List[UserBoardAccess]] = {}
        for g in grants:
            granted.setdefault(g.user_id, []).append(g)
        out = []
        for u in db.execute(select(User).where(User.role == ROLE_DM).order_by(User.name)).scalars().all():
            owned = [{"id": b.id, "label": b.label} for b in boards if b.owner_id == u.id]
            gr = [{"id": g.board_id, "label": by_id[g.board_id].label if g.board_id in by_id else g.board_id, "via": g.granted_via,
                   "since": g.created_at.isoformat() if g.created_at else None} for g in granted.get(u.id, []) if g.board_id in by_id]
            out.append({"user": u.to_dict(), "owned": owned, "granted": gr,
                        "available": [{"id": b.id, "label": b.label} for b in boards if b.owner_id != u.id and b.id not in {x["id"] for x in gr}]})
        return out

    def grant_board(self, db: Session, actor: User, user_id: str, board_id: str) -> Dict[str, Any]:
        user = self._get(db, user_id)
        if user.role != ROLE_DM:
            raise AppError("Boards can only be granted to delivery managers")
        if db.get(JiraBoard, board_id) is None:
            raise NotFoundError("Board not found")
        exists = db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == user_id, UserBoardAccess.board_id == board_id)).scalar_one_or_none()
        if exists is None:
            code = self.ensure_board_code(db, board_id, actor.id)
            db.add(UserBoardAccess(user_id=user_id, board_id=board_id, granted_via=code.id))
            code.uses += 1
        self._audit(db, actor.id, "user.board_grant", user.email, board_id=board_id)
        db.flush()
        db.refresh(user)
        return user.to_dict()

    def revoke_board(self, db: Session, actor: User, user_id: str, board_id: str) -> Dict[str, Any]:
        user = self._get(db, user_id)
        row = db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == user_id, UserBoardAccess.board_id == board_id)).scalar_one_or_none()
        if row is not None:
            db.delete(row)
        self._audit(db, actor.id, "user.board_revoke", user.email, board_id=board_id)
        db.flush()
        db.refresh(user)
        return user.to_dict()

    def regenerate_board_code(self, db: Session, actor: User, board_id: str) -> Dict[str, Any]:
        """Issue a fresh BOARD code (old one stops working); existing grants are kept."""
        row = db.execute(select(AuthCode).where(AuthCode.kind == CODE_KIND_BOARD, AuthCode.board_id == board_id)).scalar_one_or_none()
        if row is None:
            row = self.ensure_board_code(db, board_id, actor.id)
        value = self._generate_code("board")
        row.code_hash, row.code_enc = token_hash(value), self._box.encrypt(value)
        row.active = True
        self._audit(db, actor.id, "code.board_regenerated", row.id, board_id=board_id)
        db.flush()
        return row.to_dict(value)

    def granted_board_ids(self, db: Session, user_id: str) -> List[str]:
        return [r.board_id for r in db.execute(select(UserBoardAccess).where(UserBoardAccess.user_id == user_id)).scalars().all()]

    def delete_user(self, db: Session, actor: User, user_id: str) -> None:
        user = self._get(db, user_id)
        if user.id == actor.id:
            raise AppError("You cannot delete your own account")
        self._audit(db, actor.id, "user.delete", user.email)
        db.delete(user)

    # ------------------------------------------------------------------ bootstrap
    def create_superuser(self, db: Session, email: str, name: str, password: str) -> User:
        email = normalize_email(email)
        probs = password_problems(password)
        if probs:
            raise AppError("Password must contain " + ", ".join(probs))
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(email=email, name=name or email.split("@")[0], password_hash=hash_password(password))
            db.add(user)
        else:
            user.password_hash = hash_password(password)
        user.role = user.requested_role = ROLE_ADMIN
        user.is_superuser = True
        user.status = STATUS_ACTIVE
        user.email_verified_at = user.email_verified_at or utcnow()
        user.approved_at = utcnow()
        user.must_change_password = False
        self._audit(db, None, "user.create_superuser", email)
        db.flush()
        return user

    # ------------------------------------------------------------------ self-healing accounts
    DEMO_ACCOUNTS = (
        ("demo.admin@example.com", "Demo Superuser", "Demo-Admin-2026!", ROLE_ADMIN, True),
        ("demo.manager@example.com", "Demo Delivery Manager", "Demo-Manager-2026!", ROLE_DM, False),
    )

    def upsert_demo_account(self, db: Session, email: str, name: str, password: str, role: str, superuser: bool) -> User:
        """Create or reset a demo-only login (always lands in the synthetic workspace, never sees real data)."""
        email = normalize_email(email)
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(email=email, name=name)
            db.add(user)
        user.name = user.name or name
        user.password_hash = hash_password(password)
        user.role = user.requested_role = role
        user.is_superuser = superuser
        user.status = STATUS_ACTIVE
        user.email_verified_at = user.email_verified_at or utcnow()
        user.approved_at = user.approved_at or utcnow()
        user.demo_only = user.demo_mode = True
        user.must_change_password = False
        user.failed_logins = 0
        user.locked_until = None
        db.flush()
        return user

    def ensure_demo_accounts(self, db: Session) -> List[str]:
        """Idempotent: makes sure both demo logins exist and are usable. Returns the e-mails that were (re)created."""
        created: List[str] = []
        for email, name, password, role, su in self.DEMO_ACCOUNTS:
            existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if existing is None or not existing.demo_only or existing.status != STATUS_ACTIVE or existing.role != role:
                self.upsert_demo_account(db, email, name, password, role, su)
                created.append(email)
        return created

    def ensure_bootstrap_superuser(self, db: Session, email: str, password: str) -> Optional[User]:
        """Creates the configured superuser when the database has no superuser yet (fresh or lost database)."""
        if not email or not password:
            return None
        has_super = db.execute(select(User).where(User.is_superuser.is_(True), User.demo_only.is_(False))).first()
        if has_super:
            return None
        return self.create_superuser(db, email, email.split("@")[0].replace(".", " ").title(), password)
