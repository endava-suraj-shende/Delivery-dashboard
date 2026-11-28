"""saved views / shareable links

Revision ID: 0009_saved_views
Revises: 0008_report_schedules
Create Date: 2026-11-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0009_saved_views"
down_revision = "0008_report_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("owner_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("path", sa.String(255), nullable=False),
        sa.Column("query", sa.Text(), nullable=False, server_default=""),
        sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_saved_views_owner_id", "saved_views", ["owner_id"])
    op.create_index("ix_saved_views_shared", "saved_views", ["shared"])


def downgrade() -> None:
    op.drop_index("ix_saved_views_shared", table_name="saved_views")
    op.drop_index("ix_saved_views_owner_id", table_name="saved_views")
    op.drop_table("saved_views")
