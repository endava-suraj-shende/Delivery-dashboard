"""excel uploads stored per user with ticket rows

Revision ID: 0003_excel_uploads
Revises: 0002_auth_codes_guest
Create Date: 2026-11-26
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_excel_uploads"
down_revision = "0002_auth_codes_guest"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "excel_uploads",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.String(64), nullable=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("stored_path", sa.String(500), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("employee", sa.String(120), nullable=True),
        sa.Column("project", sa.String(120), nullable=True),
        sa.Column("application", sa.String(120), nullable=True),
        sa.Column("jira_board", sa.String(120), nullable=True),
        sa.Column("report_date", sa.String(10), nullable=True),
        sa.Column("layout", sa.String(32), nullable=True),
        sa.Column("work_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("releases", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("issues", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_excel_uploads_user_id", "excel_uploads", ["user_id"])
    op.create_index("ix_excel_uploads_file_id", "excel_uploads", ["file_id"])

    op.create_table(
        "excel_upload_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("upload_id", sa.String(32), sa.ForeignKey("excel_uploads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=False),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("ticket_id", sa.String(64), nullable=True),
        sa.Column("ticket_link", sa.String(500), nullable=True),
        sa.Column("application", sa.String(120), nullable=True),
        sa.Column("work_details", sa.Text(), nullable=True),
        sa.Column("work_type_raw", sa.String(120), nullable=True),
        sa.Column("work_type", sa.String(64), nullable=True),
        sa.Column("work_status_raw", sa.String(120), nullable=True),
        sa.Column("work_status", sa.String(64), nullable=True),
        sa.Column("prod_required", sa.String(32), nullable=True),
        sa.Column("dev_deployment_raw", sa.String(120), nullable=True),
        sa.Column("dev_deployment", sa.String(64), nullable=True),
        sa.Column("prod_deployment", sa.String(64), nullable=True),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("report_date", sa.String(10), nullable=True),
    )
    op.create_index("ix_excel_upload_rows_upload_id", "excel_upload_rows", ["upload_id"])
    op.create_index("ix_excel_upload_rows_user_id", "excel_upload_rows", ["user_id"])
    op.create_index("ix_excel_upload_rows_ticket_id", "excel_upload_rows", ["ticket_id"])


def downgrade() -> None:
    op.drop_table("excel_upload_rows")
    op.drop_table("excel_uploads")
