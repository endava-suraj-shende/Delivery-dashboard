"""Authentication, approval workflow and role-based access."""
from __future__ import annotations

from fastapi.testclient import TestClient

PW = "Strong-Pass-123!"


def _signup(c: TestClient, email: str, role: str, name: str = "Test User", code: str | None = None) -> dict:
    r = c.post("/api/v1/auth/signup", json={"name": name, "email": email, "password": PW, "confirm_password": PW, "requested_role": role, "auth_code": code})
    assert r.status_code == 200, r.text
    return r.json()


def _code(client: TestClient, role: str, **kw) -> dict:
    r = client.post("/api/v1/admin/codes", json={"role": role, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _employee(client: TestClient, anon: TestClient, email: str) -> None:
    """Register + activate an employee through an auth code and sign the anon client in."""
    code = _code(client, "employee")
    _signup(anon, email, "employee", code=code["code"])
    assert _login(anon, email).status_code == 200


def _verify(c: TestClient, link: str) -> dict:
    token = link.split("token=")[1]
    r = c.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    return r.json()


def _login(c: TestClient, email: str, password: str = PW):
    return c.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_unauthenticated_requests_are_rejected(anon: TestClient):
    assert anon.get("/api/v1/dashboard/executive").status_code == 401
    assert anon.get("/api/v1/excel/status").status_code == 401
    assert anon.get("/health").status_code == 200  # public


def test_signup_requires_allowed_domain_strong_password_and_code(client: TestClient, anon: TestClient):
    code = _code(client, "employee")["code"]
    r = anon.post("/api/v1/auth/signup", json={"name": "X Y", "email": "x@gmail.com", "password": PW, "confirm_password": PW, "requested_role": "employee", "auth_code": code})
    assert r.status_code == 400 and "not allowed" in r.json()["message"]
    r = anon.post("/api/v1/auth/signup", json={"name": "X Y", "email": "x@endava.com", "password": "weak", "confirm_password": "weak", "requested_role": "employee", "auth_code": code})
    assert r.status_code == 400 and "Password must contain" in r.json()["message"]
    r = anon.post("/api/v1/auth/signup", json={"name": "X Y", "email": "x@endava.com", "password": PW, "confirm_password": PW, "requested_role": "employee"})
    assert r.status_code == 400 and r.json()["message"] == "Auth code is required"


def test_employee_sees_only_own_uploads(client: TestClient, anon: TestClient, tmp_path):
    _employee(client, anon, "emp@endava.com")
    # the admin's workbooks exist, but an employee without uploads sees nothing
    assert len(client.get("/api/v1/excel/files").json()["items"]) > 0
    assert anon.get("/api/v1/excel/files").json()["items"] == []
    st = anon.get("/api/v1/excel/status").json()
    assert st["scoped"] is True and st["file_count"] == 0
    # upload one workbook -> only that one is visible, with detail / preview access
    from tests.conftest import write_template
    from datetime import datetime
    path = write_template(tmp_path / "Emp_Upload-01-11-2026.xlsx", "Emp User", "Project Z", "AppZ", datetime(2026, 11, 1),
                          work=[["AppZ", "Z-1", None, "Own work", "Development", "In Progress", "No", "Pending", None]])
    with open(path, "rb") as fh:
        r = anon.post("/api/v1/excel/upload", files={"file": (path.name, fh, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    fid = r.json()["file_id"]
    mine = anon.get("/api/v1/excel/files").json()["items"]
    assert [f["file_id"] for f in mine] == [fid] and mine[0]["own"] is True
    assert anon.get(f"/api/v1/excel/files/{fid}").status_code == 200
    other = next(f["file_id"] for f in client.get("/api/v1/excel/files").json()["items"] if f["file_id"] != fid)
    assert anon.get(f"/api/v1/excel/files/{other}").status_code == 404
    assert anon.get("/api/v1/excel/preview", params={"file_id": other}).status_code == 404
    # admins see who uploaded it
    assert next(f for f in client.get("/api/v1/excel/files").json()["items"] if f["file_id"] == fid)["uploaded_by"] == "Test User"
    # the workbook and its ticket rows are stored in the database for the uploader
    my = anon.get("/api/v1/excel/my").json()
    assert len(my["uploads"]) == 1 and my["uploads"][0]["file_id"] == fid and my["uploads"][0]["work_items"] == 1
    assert len(my["tickets"]) == 1 and my["tickets"][0]["ticket_id"] == "Z-1" and my["tickets"][0]["work_status"] == "in_progress"
    assert client.get("/api/v1/excel/my").json()["uploads"] == []  # admin has uploaded nothing
    st = anon.get("/api/v1/excel/status").json()
    assert st["file_count"] == 1 and st["activity_count"] == 1 and st["scoped"] is True
    # employee: upload/status allowed, dashboards and management actions forbidden
    assert anon.get("/api/v1/excel/status").status_code == 200
    assert anon.post("/api/v1/excel/refresh").status_code == 403
    assert anon.delete("/api/v1/excel/uploads").status_code == 403
    assert anon.get("/api/v1/dashboard/executive").status_code == 403
    assert anon.get("/api/v1/jira/connections/boards").status_code == 403
    assert anon.get("/api/v1/admin/users").status_code == 403


def test_admin_request_needs_approval_and_dm_sees_only_own_boards(client: TestClient, anon: TestClient):
    out = _signup(anon, "dm@endava.com", "admin")  # admins have no code: verify + approval
    assert _verify(anon, out["debug_link"])["status"] == "pending_approval"
    r = _login(anon, "dm@endava.com")
    assert r.status_code == 200 and r.json()["user"]["status"] == "pending_approval"
    # logged in but not approved -> no data access yet
    assert anon.get("/api/v1/dashboard/executive").status_code == 403
    assert anon.get("/api/v1/auth/me").json()["user"]["status"] == "pending_approval"

    # superuser approves, but grants delivery manager instead of admin
    users = client.get("/api/v1/admin/users", params={"status": "pending_approval"}).json()["items"]
    uid = next(u["id"] for u in users if u["email"] == "dm@endava.com")
    r = client.post(f"/api/v1/admin/users/{uid}/approve", json={"role": "dm"})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["role"] == "dm"

    assert anon.get("/api/v1/dashboard/executive", params={"preset": "all"}).status_code == 200
    # settings / configuration are admin only
    assert anon.get("/api/v1/data/source").status_code == 403
    assert anon.put("/api/v1/config/status", json={}).status_code == 403
    assert anon.get("/api/v1/jira/connections/credentials").status_code == 403
    # no boards configured by this manager -> empty list and no data through scoping
    assert anon.get("/api/v1/jira/connections/boards").json()["items"] == []
    dims = anon.get("/api/v1/meta/dimensions").json()
    assert dims["jira_boards"] == []


def test_password_reset_and_temporary_password(client: TestClient, anon: TestClient):
    _employee(client, anon, "reset@endava.com")
    anon.post("/api/v1/auth/logout")
    # forgot -> reset link -> new password works, old does not
    r = anon.post("/api/v1/auth/forgot-password", json={"email": "reset@endava.com"})
    link = r.json()["debug_link"]
    r = anon.post("/api/v1/auth/reset-password", json={"token": link.split("token=")[1], "password": "Another-Pass-456!", "confirm_password": "Another-Pass-456!"})
    assert r.status_code == 200
    assert _login(anon, "reset@endava.com", PW).status_code == 401
    assert _login(anon, "reset@endava.com", "Another-Pass-456!").status_code == 200
    # reset link cannot be reused
    r = anon.post("/api/v1/auth/reset-password", json={"token": link.split("token=")[1], "password": "Third-Pass-789!", "confirm_password": "Third-Pass-789!"})
    assert r.status_code == 400

    # admin issues a temporary password; the user must change it before using the app
    uid = next(u["id"] for u in client.get("/api/v1/admin/users").json()["items"] if u["email"] == "reset@endava.com")
    r = client.post(f"/api/v1/admin/users/{uid}/temporary-password")
    temp = r.json()["temporary_password"]
    fresh = TestClient(client.app)
    assert _login(fresh, "reset@endava.com", temp).status_code == 200
    assert fresh.get("/api/v1/excel/status").status_code == 403  # must change password first
    r = fresh.post("/api/v1/auth/change-password", json={"current_password": temp, "password": "Final-Pass-000!", "confirm_password": "Final-Pass-000!"})
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is False
    assert fresh.get("/api/v1/excel/status").status_code == 200


def test_lockout_after_failed_logins(client: TestClient, anon: TestClient):
    _employee(client, anon, "lock@endava.com")
    anon.post("/api/v1/auth/logout")
    for _ in range(5):
        assert _login(anon, "lock@endava.com", "wrong-pass").status_code == 401
    r = _login(anon, "lock@endava.com", PW)
    assert r.status_code == 401 and "Too many" in r.json()["message"]


def test_access_policy_allowlist(client: TestClient, anon: TestClient):
    r = client.post("/api/v1/admin/access-policy", json={"kind": "email", "value": "partner@external.com"})
    assert r.status_code == 200
    code = _code(client, "employee")["code"]
    out = _signup(anon, "partner@external.com", "employee", code=code)
    assert out["status"] == "active"


def test_auth_code_skips_verification_and_wrong_code_is_rejected(client: TestClient, anon: TestClient):
    code = _code(client, "employee", label="Team onboarding")
    assert code["code"].startswith("EMP-") and code["usable"]
    r = anon.post("/api/v1/auth/signup", json={"name": "Coded Emp", "email": "coded@endava.com", "password": PW, "confirm_password": PW,
                                              "requested_role": "employee", "auth_code": "EMP-NOPE-0000"})
    assert r.status_code == 400 and r.json()["message"] == "Auth code is wrong"
    # a DM code cannot be used for an employee sign-up
    dm_code = _code(client, "dm")
    r = anon.post("/api/v1/auth/signup", json={"name": "Coded Emp", "email": "coded@endava.com", "password": PW, "confirm_password": PW,
                                              "requested_role": "employee", "auth_code": dm_code["code"]})
    assert r.status_code == 400 and r.json()["message"] == "Auth code is wrong"
    r = anon.post("/api/v1/auth/signup", json={"name": "Coded Emp", "email": "coded@endava.com", "password": PW, "confirm_password": PW,
                                              "requested_role": "employee", "auth_code": code["code"]})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json().get("activated") is True
    assert _login(anon, "coded@endava.com").status_code == 200
    assert anon.get("/api/v1/excel/status").status_code == 200
    # usage is counted; revoked codes stop working
    assert next(c for c in client.get("/api/v1/admin/codes").json()["items"] if c["id"] == code["id"])["uses"] == 1
    client.post(f"/api/v1/admin/codes/{code['id']}/revoke")
    r = TestClient(client.app).post("/api/v1/auth/signup", json={"name": "Late", "email": "late@endava.com", "password": PW, "confirm_password": PW,
                                                                  "requested_role": "employee", "auth_code": code["code"]})
    assert r.status_code == 400 and r.json()["message"] == "Auth code is wrong"


def test_dm_code_grants_board_without_approval(client: TestClient, anon: TestClient, monkeypatch):
    # configure a board as admin (no live test) so a code can be tied to it
    import app.services.container as container_mod
    cont = container_mod.get_container()
    board = cont.jira_boards.add("https://fake.atlassian.net/jira/software/c/projects/A/boards/921", label="Board A", test=False,
                                 email="me@x.com", token="t")
    code = _code(client, "dm", board_id=board.id, label="Board A managers")
    assert code["code"].startswith("DM-") and code["board_label"] == "Board A"
    r = anon.post("/api/v1/auth/signup", json={"name": "Coded DM", "email": "coded.dm@endava.com", "password": PW, "confirm_password": PW,
                                              "requested_role": "dm", "auth_code": code["code"]})
    assert r.status_code == 200 and r.json()["status"] == "active"
    assert _login(anon, "coded.dm@endava.com").status_code == 200
    items = anon.get("/api/v1/jira/connections/boards").json()["items"]
    assert [b["label"] for b in items] == ["Board A"] and items[0]["can_edit"] is False
    me = anon.get("/api/v1/auth/me").json()["user"]
    assert me["board_ids"] == [board.id]
    # DM cannot modify a granted (not owned) board
    assert anon.delete(f"/api/v1/jira/connections/boards/{board.id}").status_code == 404


def test_guest_flow_demo_data_and_expiry(client: TestClient, anon: TestClient):
    # guests need a code; the domain restriction does not apply to them
    r = anon.post("/api/v1/auth/signup", json={"name": "Visitor", "email": "visitor@partner.com", "password": PW, "confirm_password": PW,
                                              "requested_role": "guest"})
    assert r.status_code == 400 and r.json()["message"] == "Auth code is required"
    code = _code(client, "guest", max_uses=5)
    assert code["code"].startswith("GUEST-")
    out = anon.post("/api/v1/auth/signup", json={"name": "Visitor", "email": "visitor@partner.com", "password": PW, "confirm_password": PW,
                                                "requested_role": "guest", "auth_code": code["code"]}).json()
    assert out["status"] == "pending_verification"  # e-mail verification still required for guests
    v = _verify(anon, out["debug_link"])
    assert v["status"] == "active"
    r = _login(anon, "visitor@partner.com")
    me = r.json()["user"]
    assert me["role"] == "guest" and me["access_expires_at"] and me["access_expired"] is False
    # guest dashboards come from the synthetic demo workspace
    st = anon.get("/api/v1/excel/status").json()
    assert st.get("demo") is True and st["employee_count"] >= 10
    k = anon.get("/api/v1/dashboard/executive", params={"preset": "all"}).json()["kpis"]
    assert k["total_tickets"] > 100
    dims = anon.get("/api/v1/meta/dimensions").json()
    assert "Phoenix Scrum Board" in dims["jira_boards"] and "Alice A" not in dims["employees"]
    # no reports / uploads / config for guests
    assert anon.get("/api/v1/reports").status_code == 403
    assert anon.get("/api/v1/excel/files").status_code == 403
    assert anon.get("/api/v1/jira/connections/boards").status_code == 403

    # expire the window -> account is parked until a superuser extends it
    import app.services.container as container_mod
    from datetime import datetime, timedelta
    from sqlalchemy import select
    from app.db.models import User
    cont = container_mod.get_container()
    with cont.db() as db:
        u = db.execute(select(User).where(User.email == "visitor@partner.com")).scalar_one()
        u.access_expires_at = datetime.utcnow() - timedelta(days=1)
        uid = u.id
        db.commit()
    assert anon.get("/api/v1/dashboard/executive").status_code == 403
    r = _login(anon, "visitor@partner.com")
    assert r.status_code == 200 and r.json()["user"]["status"] == "pending_approval"
    r = client.post(f"/api/v1/admin/users/{uid}/extend", json={"days": 10})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["access_expired"] is False
    assert _login(anon, "visitor@partner.com").json()["user"]["status"] == "active"
    assert anon.get("/api/v1/dashboard/executive", params={"preset": "all"}).status_code == 200


def test_superuser_can_approve_guest_without_email_verification(client: TestClient, anon: TestClient):
    code = _code(client, "guest")
    out = _signup(anon, "quick.guest@partner.com", "guest", code=code["code"])
    assert out["status"] == "pending_verification"
    uid = next(u["id"] for u in client.get("/api/v1/admin/users", params={"status": "pending_verification"}).json()["items"] if u["email"] == "quick.guest@partner.com")
    r = client.post(f"/api/v1/admin/users/{uid}/approve", json={})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["access_expires_at"]
    r = _login(anon, "quick.guest@partner.com")
    assert r.status_code == 200 and r.json()["user"]["role"] == "guest"
    assert anon.get("/api/v1/dashboard/executive", params={"preset": "all"}).status_code == 200


def test_admin_code_gives_read_only_admin_and_superuser_toggle(client: TestClient, anon: TestClient):
    code = _code(client, "admin")
    assert code["code"].startswith("ADMIN-")
    _signup(anon, "plain.admin@endava.com", "admin", code=code["code"])
    r = _login(anon, "plain.admin@endava.com")
    me = r.json()["user"]
    assert me["status"] == "active" and me["role"] == "admin" and me["is_superuser"] is False
    # admin: reads everything, including every board; cannot manage users / settings / boards
    assert anon.get("/api/v1/dashboard/executive", params={"preset": "all"}).status_code == 200
    assert anon.get("/api/v1/jira/connections/boards").status_code == 200
    assert anon.get("/api/v1/admin/users").status_code == 403
    assert anon.get("/api/v1/data/source").status_code == 403
    assert anon.get("/api/v1/jira/connections/credentials").status_code == 403
    r = anon.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921", "test": False, "email": "a@x", "token": "t"})
    assert r.status_code == 400
    # superuser grants user-management access
    uid = me["id"]
    r = client.post(f"/api/v1/admin/users/{uid}/superuser", json={"enabled": True})
    assert r.status_code == 200 and r.json()["is_superuser"] is True
    assert _login(anon, "plain.admin@endava.com").status_code == 200  # token version bumped -> re-login
    assert anon.get("/api/v1/admin/users").status_code == 200
    # superusers cannot demote themselves
    assert client.post(f"/api/v1/admin/users/{client.get('/api/v1/auth/me').json()['user']['id']}/superuser", json={"enabled": False}).status_code == 400


def test_board_code_created_on_link_and_redeemable(client: TestClient, anon: TestClient):
    # DM A links a board -> a BOARD code appears for the superuser
    code_a = _code(client, "dm")
    _signup(anon, "dm.a@endava.com", "dm", code=code_a["code"])
    _login(anon, "dm.a@endava.com")
    r = anon.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921", "test": False, "email": "a@x.com", "token": "t"})
    assert r.status_code == 200, r.text
    bcode = r.json()["board_code"]
    assert bcode.startswith("BOARD-")
    listed = [c for c in client.get("/api/v1/admin/codes").json()["items"] if c["kind"] == "board"]
    assert listed and listed[0]["code"] == bcode and listed[0]["board_owner"] == "Test User"
    # DM B redeems it on Jira Connections and now sees the board (read-only)
    dm_b = TestClient(client.app)
    _signup(dm_b, "dm.b@endava.com", "dm", code=_code(client, "dm")["code"])
    _login(dm_b, "dm.b@endava.com")
    assert dm_b.get("/api/v1/jira/connections/boards").json()["items"] == []
    assert dm_b.post("/api/v1/jira/connections/redeem-code", json={"code": "BOARD-NOPE-0000"}).status_code == 400
    r = dm_b.post("/api/v1/jira/connections/redeem-code", json={"code": bcode})
    assert r.status_code == 200
    items = dm_b.get("/api/v1/jira/connections/boards").json()["items"]
    assert len(items) == 1 and items[0]["can_edit"] is False
    # a role code cannot be used as a board code
    assert dm_b.post("/api/v1/jira/connections/redeem-code", json={"code": code_a["code"]}).status_code == 400


def test_superuser_grants_and_revokes_boards_and_regenerates_code(client: TestClient, anon: TestClient):
    _signup(anon, "dm.owner@endava.com", "dm", code=_code(client, "dm")["code"])
    _login(anon, "dm.owner@endava.com")
    assert anon.get("/api/v1/auth/me").json()["user"]["board_count"] == 0  # -> onboarding screen
    r = anon.post("/api/v1/jira/connections/boards", json={"url": "https://fake.atlassian.net/jira/software/c/projects/A/boards/921", "test": False, "email": "a@x.com", "token": "t"})
    bid, old_code = r.json()["id"], r.json()["board_code"]
    assert anon.get("/api/v1/auth/me").json()["user"]["board_count"] == 1

    other = TestClient(client.app)
    _signup(other, "dm.other@endava.com", "dm", code=_code(client, "dm")["code"])
    _login(other, "dm.other@endava.com")
    uid = other.get("/api/v1/auth/me").json()["user"]["id"]
    ov = client.get("/api/v1/admin/delivery-managers").json()["items"]
    me_row = next(x for x in ov if x["user"]["id"] == uid)
    assert me_row["owned"] == [] and me_row["granted"] == [] and [b["id"] for b in me_row["available"]] == [bid]
    # grant -> visible; revoke -> gone
    assert client.post(f"/api/v1/admin/users/{uid}/boards/{bid}").status_code == 200
    assert [b["id"] for b in other.get("/api/v1/jira/connections/boards").json()["items"]] == [bid]
    assert other.get("/api/v1/auth/me").json()["user"]["board_count"] == 1
    assert client.delete(f"/api/v1/admin/users/{uid}/boards/{bid}").status_code == 200
    assert other.get("/api/v1/jira/connections/boards").json()["items"] == []
    # regenerate: old code dead, new code works
    new_code = client.post(f"/api/v1/admin/boards/{bid}/regenerate-code").json()["code"]
    assert new_code != old_code
    assert other.post("/api/v1/jira/connections/redeem-code", json={"code": old_code}).status_code == 400
    assert other.post("/api/v1/jira/connections/redeem-code", json={"code": new_code}).status_code == 200
