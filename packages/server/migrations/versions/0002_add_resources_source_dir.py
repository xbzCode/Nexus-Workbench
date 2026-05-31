"""add_resources_source_dir_to_node_definitions

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("node_definitions", sa.Column("resources", postgresql.JSONB(), nullable=True))
    op.add_column("node_definitions", sa.Column("source_dir", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("node_definitions", "source_dir")
    op.drop_column("node_definitions", "resources")
