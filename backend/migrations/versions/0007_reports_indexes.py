"""generated report registry + missing indexes

Revision ID: 0007_reports_indexes
Revises: 0006_demo_mode
Create Date: 2026-11-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_reports_indexes"
down_revision = "0006_demo_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "generated_reports",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("report_type", sa.String(40), nullable=False),
        sa.Column("format", sa.String(8), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("target", sa.String(255)),
        sa.Column("period", sa.String(120)),
        sa.Column("filters", sa.JSON()),
        sa.Column("created_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("workspace", sa.String(16), nullable=False, server_default="real"),
    )
    op.create_index("ix_generated_reports_created_by", "generated_reports", ["created_by"])
    op.create_index("ix_generated_reports_created_at", "generated_reports", ["created_at"])
    op.create_index("ix_generated_reports_workspace", "generated_reports", ["workspace"])
    # indexes for columns used in WHERE / ORDER BY by the auth service and upload views
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_auth_tokens_expires_at", "auth_tokens", ["expires_at"])
    op.create_index("ix_auth_codes_kind_board", "auth_codes", ["kind", "board_id"])
    op.create_index("ix_excel_upload_rows_report_date", "excel_upload_rows", ["report_date"])


def downgrade() -> None:
    for name, table in (("ix_excel_upload_rows_report_date", "excel_upload_rows"), ("ix_auth_codes_kind_board", "auth_codes"),
                        ("ix_auth_tokens_expires_at", "auth_tokens"), ("ix_users_role", "users")):
        op.drop_index(name, table_name=table)
    op.drop_table("generated_reports")
