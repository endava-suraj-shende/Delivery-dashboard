"""store auth codes encrypted (Fernet) with a sha256 lookup hash

Revision ID: 0005_encrypt_auth_codes
Revises: 0004_superuser_board_codes
Create Date: 2026-11-27
"""
from __future__ import annotations

import hashlib

from alembic import op
import sqlalchemy as sa

revision = "0005_encrypt_auth_codes"
down_revision = "0004_superuser_board_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.core.config import get_settings
    from app.core.secrets import SecretBox
    box = SecretBox(get_settings().secret_key_path)

    with op.batch_alter_table("auth_codes") as b:
        b.add_column(sa.Column("code_hash", sa.String(64), nullable=True))
        b.add_column(sa.Column("code_enc", sa.String(512), nullable=True))
    conn = op.get_bind()
    for cid, code in conn.execute(sa.text("SELECT id, code FROM auth_codes")).fetchall():
        conn.execute(sa.text("UPDATE auth_codes SET code_hash=:h, code_enc=:e WHERE id=:i"),
                     {"h": hashlib.sha256(code.encode()).hexdigest(), "e": box.encrypt(code), "i": cid})
    with op.batch_alter_table("auth_codes") as b:
        b.drop_index("ix_auth_codes_code")
        b.drop_column("code")
        b.alter_column("code_hash", nullable=False)
        b.alter_column("code_enc", nullable=False)
        b.create_index("ix_auth_codes_code_hash", ["code_hash"], unique=True)


def downgrade() -> None:
    raise RuntimeError("Auth codes cannot be decrypted back into plaintext columns by a downgrade")
