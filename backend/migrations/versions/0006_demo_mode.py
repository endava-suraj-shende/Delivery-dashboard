"""demo mode flags for superusers

Revision ID: 0006_demo_mode
Revises: 0005_encrypt_auth_codes
Create Date: 2026-11-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_demo_mode"
down_revision = "0005_encrypt_auth_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("demo_mode", sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column("demo_only", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_column("demo_only")
        b.drop_column("demo_mode")
