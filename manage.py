#!/usr/bin/env python
"""Management commands for the Employee Delivery Dashboard.

    python manage.py migrate                   # create / upgrade the database schema and import legacy JSON config
    python manage.py create-superuser          # interactive: first admin account
    python manage.py create-superuser --email a@b.com --name "Admin" --password '...'
    python manage.py create-demo-superuser     # superuser locked to synthetic demo data (stakeholder demos)
    python manage.py create-demo-dm            # delivery manager locked to synthetic demo data
    python manage.py makemigrations -m "add x" # generate a new Alembic revision from model changes
    python manage.py db-status                 # show database URL and current revision
    python manage.py allow-domain example.com  # add an allowed sign-up domain
    python manage.py allow-email someone@x.com # allow-list a single address

Moving to another environment: copy the project, set EDD_DATABASE_URL (optional; default storage/app.db),
run `python manage.py migrate`, then `python manage.py create-superuser`.
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))


def _settings():
    from app.core.config import get_settings
    return get_settings()


def cmd_migrate(_: argparse.Namespace) -> int:
    from app.db.migrate import current_revision, upgrade_to_head
    s = _settings()
    print(f"Database: {s.database_url}")
    upgrade_to_head(s)
    print(f"Schema at revision: {current_revision(s)}")
    # Import legacy JSON configuration (boards, credentials, status mapping, data source, user map) once.
    from app.services.container import get_container
    c = get_container()
    with c.db() as db:
        c.auth.ensure_default_policy(db)
        db.commit()
    print(f"Jira boards in database: {len(c.jira_boards.list())}")
    print("Migration complete.")
    return 0


def cmd_create_superuser(args: argparse.Namespace) -> int:
    from app.services.container import get_container
    email = args.email or input("E-mail: ").strip()
    name = args.name or input("Full name: ").strip() or email.split("@")[0]
    password = args.password
    if not password:
        while True:
            password = getpass.getpass("Password (10+ chars, upper/lower/digit/symbol): ")
            if password == getpass.getpass("Confirm password: "):
                break
            print("Passwords do not match, try again.")
    c = get_container()
    with c.db() as db:
        user = c.auth.create_superuser(db, email, name, password)
        db.commit()
        print(f"Superuser ready: {user.email} ({user.name})")
    return 0


def cmd_create_demo_superuser(args: argparse.Namespace) -> int:
    """A superuser that only ever sees synthetic demo data (safe to hand to stakeholders)."""
    from app.db.models import ROLE_ADMIN
    from app.services.container import get_container
    email = args.email or "demo.admin@example.com"
    password = args.password or "Demo-Admin-2026!"
    c = get_container()
    with c.db() as db:
        user = c.auth.upsert_demo_account(db, email, args.name or "Demo Superuser", password, ROLE_ADMIN, True)
        db.commit()
        print(f"Demo superuser ready: {user.email} / {password} (demo data only)")
    return 0


def cmd_create_demo_dm(args: argparse.Namespace) -> int:
    """A delivery manager locked to synthetic demo data (sees the demo Phoenix boards)."""
    from app.db.models import ROLE_DM
    from app.services.container import get_container
    email = args.email or "demo.manager@example.com"
    password = args.password or "Demo-Manager-2026!"
    c = get_container()
    with c.db() as db:
        u = c.auth.upsert_demo_account(db, email, args.name or "Demo Delivery Manager", password, ROLE_DM, False)
        db.commit()
        print(f"Demo delivery manager ready: {u.email} / {password} (demo data only)")
    return 0


def cmd_makemigrations(args: argparse.Namespace) -> int:
    from app.db.migrate import make_revision
    make_revision(_settings(), args.message)
    return 0


def cmd_db_status(_: argparse.Namespace) -> int:
    from app.db.migrate import current_revision
    s = _settings()
    print(f"Database URL : {s.database_url}")
    try:
        print(f"Revision     : {current_revision(s) or '(empty - run migrate)'}")
    except Exception as exc:
        print(f"Revision     : unavailable ({exc})")
    return 0


def _add_rule(kind: str, value: str) -> int:
    from app.services.container import get_container
    c = get_container()
    with c.db() as db:
        rule = c.auth.add_rule(db, None, kind, value, note="manage.py")
        db.commit()
        print(f"Allowed {kind}: {rule.value}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Employee Delivery Dashboard management commands")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="create / upgrade the database schema").set_defaults(fn=cmd_migrate)
    su = sub.add_parser("create-superuser", help="create or reset the admin account")
    su.add_argument("--email"); su.add_argument("--name"); su.add_argument("--password")
    su.set_defaults(fn=cmd_create_superuser)
    ds = sub.add_parser("create-demo-superuser", help="superuser account locked to synthetic demo data")
    ds.add_argument("--email"); ds.add_argument("--name"); ds.add_argument("--password")
    ds.set_defaults(fn=cmd_create_demo_superuser)
    dd = sub.add_parser("create-demo-dm", help="delivery manager account locked to synthetic demo data")
    dd.add_argument("--email"); dd.add_argument("--name"); dd.add_argument("--password")
    dd.set_defaults(fn=cmd_create_demo_dm)
    mk = sub.add_parser("makemigrations", help="autogenerate an Alembic revision")
    mk.add_argument("-m", "--message", required=True)
    mk.set_defaults(fn=cmd_makemigrations)
    sub.add_parser("db-status", help="show database and revision").set_defaults(fn=cmd_db_status)
    d = sub.add_parser("allow-domain"); d.add_argument("domain"); d.set_defaults(fn=lambda a: _add_rule("domain", a.domain))
    e = sub.add_parser("allow-email"); e.add_argument("email"); e.set_defaults(fn=lambda a: _add_rule("email", a.email))
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
