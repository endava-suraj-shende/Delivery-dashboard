"""Single sign-on with any OpenID Connect provider (Microsoft Entra ID by default).

Authorization-code flow with PKCE for a confidential client. Identity is matched to local accounts by e-mail; new
users are created in the configured default role when their domain is allow-listed. Local passwords stay available
for guests, demo accounts and break-glass admins.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.services.auth_service import AuthError, ForbiddenError
from app.core.security import create_session_token
from app.db.models import (ROLE_GUEST, STATUS_ACTIVE, STATUS_DISABLED, STATUS_PENDING_APPROVAL, STATUS_REJECTED, User, utcnow)

SSO_PASSWORD_MARKER = "!sso"  # never verifies as a password; marks accounts created through single sign-on
STATE_TTL_SECONDS = 600


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class SsoService:
    def __init__(self, settings: Settings, auth, secret: str, transport: Optional[httpx.BaseTransport] = None) -> None:
        self.s = settings
        self.auth = auth
        self._secret = secret
        self._transport = transport
        self._discovery: Optional[Dict[str, Any]] = None
        self._discovery_at = 0.0
        self._jwks: Optional[jwt.PyJWKClient] = None

    # ------------------------------------------------------------------ config
    @property
    def enabled(self) -> bool:
        return bool(self.s.sso_issuer and self.s.sso_client_id and self.s.sso_client_secret)

    def public_info(self) -> Dict[str, Any]:
        return {"enabled": self.enabled, "label": self.s.sso_label, "login_url": "/api/v1/auth/sso/login" if self.enabled else None,
                "local_login": self.s.sso_allow_local_login or not self.enabled}

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=15, transport=self._transport) if self._transport else httpx.Client(timeout=15)

    def discovery(self) -> Dict[str, Any]:
        if self._discovery and time.time() - self._discovery_at < 3600:
            return self._discovery
        url = self.s.sso_issuer.rstrip("/") + "/.well-known/openid-configuration"
        with self._client() as c:
            r = c.get(url)
            r.raise_for_status()
            self._discovery = r.json()
        self._discovery_at = time.time()
        self._jwks = None
        return self._discovery

    def _jwk_client(self) -> jwt.PyJWKClient:
        if self._jwks is None:
            uri = self.discovery()["jwks_uri"]
            if self._transport is not None:
                # tests: fetch through the injected transport, then feed PyJWKClient a static key set
                with self._client() as c:
                    keys = c.get(uri).json()
                self._jwks = _StaticJwkClient(keys)
            else:
                self._jwks = jwt.PyJWKClient(uri, cache_keys=True, lifespan=3600)
        return self._jwks

    # ------------------------------------------------------------------ flow
    def redirect_uri(self) -> str:
        return self.s.sso_redirect_uri or (self.s.public_url.rstrip("/") + "/api/v1/auth/sso/callback")

    def begin(self, next_path: str = "/") -> Dict[str, str]:
        """Returns the provider URL to redirect the browser to, plus a signed state cookie value."""
        if not self.enabled:
            raise ForbiddenError("Single sign-on is not configured")
        verifier = _b64url(secrets.token_bytes(48))
        challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
        state = secrets.token_urlsafe(24)
        nonce = secrets.token_urlsafe(24)
        cookie = jwt.encode({"st": state, "n": nonce, "v": verifier, "next": next_path if next_path.startswith("/") else "/",
                             "exp": int(time.time()) + STATE_TTL_SECONDS}, self._secret, algorithm="HS256")
        params = {"client_id": self.s.sso_client_id, "response_type": "code", "redirect_uri": self.redirect_uri(),
                  "scope": self.s.sso_scopes, "state": state, "nonce": nonce, "code_challenge": challenge,
                  "code_challenge_method": "S256", "response_mode": "query"}
        if self.s.sso_domain_hint:
            params["domain_hint"] = self.s.sso_domain_hint
        return {"url": self.discovery()["authorization_endpoint"] + "?" + urlencode(params), "cookie": cookie}

    def complete(self, db: Session, code: str, state: str, cookie: Optional[str]) -> Dict[str, Any]:
        """Exchanges the code, validates the id_token and signs the matching local user in."""
        if not cookie:
            raise AuthError("Sign-in session expired. Please try again.")
        try:
            st = jwt.decode(cookie, self._secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise AuthError("Sign-in session expired. Please try again.")
        if not secrets.compare_digest(st.get("st", ""), state or ""):
            raise AuthError("Sign-in state mismatch. Please try again.")
        disc = self.discovery()
        with self._client() as c:
            r = c.post(disc["token_endpoint"], data={"grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri(),
                                                   "client_id": self.s.sso_client_id, "client_secret": self.s.sso_client_secret,
                                                   "code_verifier": st["v"]}, headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise AuthError("The identity provider rejected the sign-in. Please try again.")
        id_token = r.json().get("id_token")
        if not id_token:
            raise AuthError("No identity token returned by the provider")
        key = self._jwk_client().get_signing_key_from_jwt(id_token).key
        try:
            claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=self.s.sso_client_id, issuer=disc["issuer"],
                                options={"require": ["exp", "iat", "iss", "aud"]}, leeway=60)
        except jwt.PyJWTError as e:
            raise AuthError(f"Identity token rejected: {e.__class__.__name__}")
        if claims.get("nonce") != st.get("n"):
            raise AuthError("Identity token nonce mismatch")
        email = (claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip().lower()
        if "@" not in email:
            raise AuthError("The identity provider did not return an e-mail address")
        name = claims.get("name") or email.split("@")[0].replace(".", " ").title()
        user = self.sign_in(db, email, name, subject=claims.get("sub") or claims.get("oid"))
        token = create_session_token(self._secret, user.id, user.token_version, self.s.session_hours)
        return {"token": token, "user": user, "next": st.get("next") or "/"}

    # ------------------------------------------------------------------ account mapping
    def sign_in(self, db: Session, email: str, name: str, subject: Optional[str] = None) -> User:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            if not self.auth.is_email_allowed(db, email):
                raise ForbiddenError("Your account is not allowed to use this application. Ask an administrator to allow your domain.")
            role = self.s.sso_default_role
            user = User(email=email, name=name, password_hash=SSO_PASSWORD_MARKER, role=role, requested_role=role,
                        status=STATUS_ACTIVE if self.s.sso_auto_activate else STATUS_PENDING_APPROVAL,
                        email_verified_at=utcnow(), approved_at=utcnow() if self.s.sso_auto_activate else None)
            db.add(user)
            db.flush()
            self.auth._audit(db, user.id, "auth.sso_signup", email, provider=self.s.sso_label, subject=subject)
            if not self.s.sso_auto_activate:
                self.auth._notify_admins(db, "New access request", f"{name} ({email}) signed in with {self.s.sso_label} and is waiting for approval.")
        if user.status == STATUS_REJECTED:
            raise ForbiddenError("Your access request was not approved. Contact your administrator.")
        if user.status == STATUS_DISABLED:
            raise ForbiddenError("This account is disabled. Contact your administrator.")
        if user.status == STATUS_PENDING_APPROVAL:
            raise ForbiddenError("Your access request is waiting for approval.")
        if user.status != STATUS_ACTIVE:
            # e-mail verification is implied by the identity provider
            user.status = STATUS_ACTIVE
            user.email_verified_at = user.email_verified_at or utcnow()
        if user.role == ROLE_GUEST and user.access_expired:
            user.status = STATUS_PENDING_APPROVAL
            raise ForbiddenError("Your guest access has ended. Ask a superuser to extend it.")
        if user.demo_only:
            raise ForbiddenError("Demo accounts cannot use single sign-on")
        user.email_verified_at = user.email_verified_at or utcnow()
        user.failed_logins, user.locked_until, user.last_login_at = 0, None, utcnow()
        self.auth._audit(db, user.id, "auth.sso_login", email, provider=self.s.sso_label)
        return user


class _StaticJwkClient:
    """Minimal stand-in for PyJWKClient when the key set was fetched through a custom transport (tests)."""

    def __init__(self, jwks: Dict[str, Any]) -> None:
        self._keys = {k.get("kid"): jwt.PyJWK(k) for k in jwks.get("keys", [])}

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        kid = jwt.get_unverified_header(token).get("kid")
        if kid not in self._keys:
            raise AuthError("Unknown signing key")
        return self._keys[kid]
