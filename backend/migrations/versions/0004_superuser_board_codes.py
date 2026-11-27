"""superuser flag and board auth codes

Revision ID: 0004_superuser_board_codes
Revises: 0003_excel_uploads
Create Date: 2026-11-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_superuser_board_codes"
down_revision = "0003_excel_uploads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("is_superuser", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("auth_codes") as b:
        b.add_column(sa.Column("kind", sa.String(16), nullable=False, server_default="role"))
    # every existing admin was created by create-superuser or approved as admin: keep their full access
    op.execute("UPDATE users SET is_superuser = 1 WHERE role = 'admin'")


def downgrade() -> None:
    with op.batch_alter_table("auth_codes") as b:
        b.drop_column("kind")
    with op.batch_alter_table("users") as b:
        b.drop_column("is_superuser")
