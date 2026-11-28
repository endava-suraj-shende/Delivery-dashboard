"""reconciliation workflow items

Revision ID: 0010_reconciliation_items
Revises: 0009_saved_views
Create Date: 2026-11-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0010_reconciliation_items"
down_revision = "0009_saved_views"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reconciliation_items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("workspace", sa.String(16), nullable=False, server_default="real"),
        sa.Column("item_key", sa.String(300), nullable=False),
        sa.Column("ticket_id", sa.String(64), nullable=False),
        sa.Column("employee", sa.String(160)),
        sa.Column("state", sa.String(16), nullable=False, server_default="open"),
        sa.Column("note", sa.Text()),
        sa.Column("codes", sa.JSON(), nullable=False),
        sa.Column("updated_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("nudged_at", sa.DateTime()),
        sa.Column("nudge_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace", "item_key", name="uq_reconciliation_items_ws_key"),
    )
    op.create_index("ix_reconciliation_items_workspace", "reconciliation_items", ["workspace"])
    op.create_index("ix_reconciliation_items_item_key", "reconciliation_items", ["item_key"])
    op.create_index("ix_reconciliation_items_ticket_id", "reconciliation_items", ["ticket_id"])
    op.create_index("ix_reconciliation_items_employee", "reconciliation_items", ["employee"])


def downgrade() -> None:
    op.drop_table("reconciliation_items")
