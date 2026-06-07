"""add_teams_table

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 创建 teams 表
    op.create_table(
        "teams",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False, index=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(10), nullable=True),
        sa.Column("team_prompt", sa.Text(), nullable=True),
        sa.Column("default_adapter_type", sa.String(30), nullable=False, server_default="codebuddy"),
        sa.Column("workflow_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("node_definition_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # 2. tasks 表添加 team_id 字段
    op.add_column("tasks", sa.Column("team_id", sa.UUID(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "team_id")
    op.drop_table("teams")
