"""Полнотекстовые индексы PostgreSQL

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("CREATE INDEX IF NOT EXISTS ix_fragments_fts ON source_fragments USING gin (to_tsvector('russian', text))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_legal_versions_fts ON legal_versions USING gin (to_tsvector('russian', coalesce(text, '')))")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_fragments_fts")
    op.execute("DROP INDEX IF EXISTS ix_legal_versions_fts")
