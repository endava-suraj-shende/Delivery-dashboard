"""auth codes, board access grants, guest expiry

Revision ID: 0002_auth_codes_guest
Revises: 0001_initial
Create Date: 2026-11-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_auth_codes_guest"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("access_expires_at", sa.DateTime(), nullable=True))
        b.add_column(sa.Column("auth_code_id", sa.String(32), nullable=True))

    op.create_table(
        "auth_codes",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("board_id", sa.String(32), sa.ForeignKey("jira_boards.id", ondelete="SET NULL"), nullable=True),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_auth_codes_code", "auth_codes", ["code"], unique=True)

    op.create_table(
        "user_board_access",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("board_id", sa.String(32), sa.ForeignKey("jira_boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("granted_via", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_user_board_access_user_id", "user_board_access", ["user_id"])
    op.create_index("ix_user_board_access_board_id", "user_board_access", ["board_id"])
    op.create_index("ix_user_board_access_pair", "user_board_access", ["user_id", "board_id"], unique=True)


def downgrade() -> None:
    op.drop_table("user_board_access")
    op.drop_table("auth_codes")
    with op.batch_alter_table("users") as b:
        b.drop_column("auth_code_id")
        b.drop_column("access_expires_at")
