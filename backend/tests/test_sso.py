"""Single sign-on (OIDC authorization code + PKCE) against an in-process fake identity provider."""
from __future__ import annotations

import json
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

ISSUER = "https://login.fake-idp.test/tenant/v2.0"


class FakeIdp:
    """Serves discovery, JWKS and the token endpoint; records what the app sent."""

    def __init__(self, client_id: str, email: str, name: str = "Sso Person") -> None:
        self.client_id, self.email, self.name = client_id, email, name
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = "test-key-1"
        self.nonce = None
        self.token_requests = []
        self.bad_nonce = False

    def _jwks(self):
        pub = self.key.public_key()
        return {"keys": [json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(pub)) | {"kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def _id_token(self):
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": self.client_id, "sub": "oid-123", "iat": now, "exp": now + 600,
                  "nonce": "wrong" if self.bad_nonce else self.nonce, "email": self.email, "preferred_username": self.email, "name": self.name}
        pem = self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": self.kid})

    def handler(self, request: httpx.Request) -> httpx.Response:
        p = request.url.path
        if p.endswith("/.well-known/openid-configuration"):
            return httpx.Response(200, json={"issuer": ISSUER, "authorization_endpoint": "https://login.fake-idp.test/authorize",
                                             "token_endpoint": "https://login.fake-idp.test/token", "jwks_uri": "https://login.fake-idp.test/keys"})
        if p == "/keys":
            return httpx.Response(200, json=self._jwks())
        if p == "/token":
            form = parse_qs(request.content.decode())
            self.token_requests.append(form)
            if form.get("code") != ["good-code"] or not form.get("code_verifier"):
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"id_token": self._id_token(), "access_token": "x", "token_type": "Bearer"})
        return httpx.Response(404)


@pytest.fixture
def sso(client: TestClient):
    import app.services.container as cm
    cont = cm.get_container()
    s = cont.settings
    s.sso_issuer, s.sso_client_id, s.sso_client_secret = ISSUER, "app-client-id", "app-secret"
    s.public_url = "http://testserver"
    idp = FakeIdp("app-client-id", "sso.person@endava.com")
    from app.services.sso_service import SsoService
    cont.sso = SsoService(s, cont.auth, cont.sso._secret, transport=httpx.MockTransport(idp.handler))
    yield idp, cont
    s.sso_issuer = s.sso_client_id = s.sso_client_secret = ""


def _start(anon: TestClient, idp: FakeIdp, next_path="/employees"):
    r = anon.get("/api/v1/auth/sso/login", params={"next": next_path}, follow_redirects=False)
    assert r.status_code == 302
    q = parse_qs(urlsplit(r.headers["location"]).query)
    assert q["code_challenge_method"] == ["S256"] and q["client_id"] == ["app-client-id"]
    idp.nonce = q["nonce"][0]
    return q["state"][0]


def test_sso_options_and_full_login_creates_user(sso, anon: TestClient):
    idp, cont = sso
    opts = anon.get("/api/v1/auth/options").json()["sso"]
    assert opts["enabled"] is True and opts["login_url"] == "/api/v1/auth/sso/login"
    state = _start(anon, idp)
    r = anon.get("/api/v1/auth/sso/callback", params={"code": "good-code", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "http://testserver/employees", r.headers.get("location")
    assert idp.token_requests[-1]["code_verifier"]  # PKCE verifier was sent
    me = anon.get("/api/v1/auth/me").json()["user"]
    assert me["email"] == "sso.person@endava.com" and me["role"] == "employee" and me["status"] == "active"
    # the SSO account has no usable password
    assert anon.post("/api/v1/auth/login", json={"email": "sso.person@endava.com", "password": "!sso"}).status_code == 401


def test_sso_rejects_state_mismatch_bad_nonce_and_unknown_domain(sso, anon: TestClient):
    idp, cont = sso
    _start(anon, idp)
    r = anon.get("/api/v1/auth/sso/callback", params={"code": "good-code", "state": "forged"}, follow_redirects=False)
    assert r.status_code == 302 and "sso_error=" in r.headers["location"] and "state" in r.headers["location"].lower()
    state = _start(anon, idp)
    idp.bad_nonce = True
    r = anon.get("/api/v1/auth/sso/callback", params={"code": "good-code", "state": state}, follow_redirects=False)
    assert "nonce" in r.headers["location"].lower()
    idp.bad_nonce = False
    idp.email = "outsider@not-allowed.example"
    state = _start(anon, idp)
    r = anon.get("/api/v1/auth/sso/callback", params={"code": "good-code", "state": state}, follow_redirects=False)
    assert "not%20allowed" in r.headers["location"] or "not+allowed" in r.headers["location"]
    assert anon.get("/api/v1/auth/me").json()["user"] is None


def test_sso_existing_local_user_keeps_role_and_disabled_is_blocked(sso, anon: TestClient, client: TestClient):
    idp, cont = sso
    from app.db.models import User
    from sqlalchemy import select
    with cont.db() as db:
        u = cont.auth.create_superuser(db, "sso.person@endava.com", "Existing Admin", "Strong-Pass-123!")
        db.commit()
        uid = u.id
    state = _start(anon, idp)
    anon.get("/api/v1/auth/sso/callback", params={"code": "good-code", "state": state}, follow_redirects=False)
    me = anon.get("/api/v1/auth/me").json()["user"]
    assert me["id"] == uid and me["role"] == "admin" and me["is_superuser"] is True
    with cont.db() as db:
        db.execute(select(User).where(User.id == uid)).scalar_one().status = "disabled"
        db.commit()
    fresh = TestClient(client.app, headers={"Origin": "http://testserver"})
    state = _start(fresh, idp)
    r = fresh.get("/api/v1/auth/sso/callback", params={"code": "good-code", "state": state}, follow_redirects=False)
    assert "disabled" in r.headers["location"]
