"""scheduled e-mail digests

Revision ID: 0008_report_schedules
Revises: 0007_reports_indexes
Create Date: 2026-11-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0008_report_schedules"
down_revision = "0007_reports_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_schedules",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("owner_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("report_type", sa.String(40), nullable=False, server_default="management"),
        sa.Column("format", sa.String(8), nullable=False, server_default="pdf"),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("preset", sa.String(24), nullable=False, server_default="last_15_days"),
        sa.Column("cadence", sa.String(16), nullable=False, server_default="weekly"),
        sa.Column("weekday", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hour_utc", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("recipients", sa.JSON(), nullable=False),
        sa.Column("include_narrative", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_run_at", sa.DateTime()),
        sa.Column("last_status", sa.String(255)),
        sa.Column("next_run_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_report_schedules_owner_id", "report_schedules", ["owner_id"])
    op.create_index("ix_report_schedules_next_run_at", "report_schedules", ["next_run_at"])


def downgrade() -> None:
    op.drop_index("ix_report_schedules_next_run_at", table_name="report_schedules")
    op.drop_index("ix_report_schedules_owner_id", table_name="report_schedules")
    op.drop_table("report_schedules")
