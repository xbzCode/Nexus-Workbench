"""init_tables

Revision ID: 0001
Revises: None
Create Date: 2026-05-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("username", sa.String(100), unique=True, nullable=False),
        sa.Column("email", sa.String(255), unique=True, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Workflows
    op.create_table(
        "workflows",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("dag", postgresql.JSONB, nullable=True),
        sa.Column("input_schema", postgresql.JSONB, nullable=True),
        sa.Column("output_schema", postgresql.JSONB, nullable=True),
        sa.Column("version", sa.Integer, server_default="1"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # NodeDefinitions
    op.create_table(
        "node_definitions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("author_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(100), unique=True, nullable=False, index=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("adapter_type", sa.String(30), server_default="codebuddy"),
        sa.Column("config_schema", postgresql.JSONB, nullable=True),
        sa.Column("input_schema", postgresql.JSONB, nullable=True),
        sa.Column("output_schema", postgresql.JSONB, nullable=True),
        sa.Column("default_config", postgresql.JSONB, nullable=True),
        sa.Column("skill_md", sa.Text, nullable=True),
        sa.Column("version", sa.String(20), server_default="1.0.0"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # NodeValidations
    op.create_table(
        "node_validations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("node_definition_id", sa.UUID(), sa.ForeignKey("node_definitions.id"), unique=True, nullable=False),
        sa.Column("commands", postgresql.JSONB, nullable=False),
        sa.Column("auto_rollback", sa.Boolean, server_default="true"),
        sa.Column("max_retries", sa.Integer, server_default="2"),
        sa.Column("retry_backoff", sa.String(20), server_default="exponential"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # NodeFiles
    op.create_table(
        "node_files",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("node_definition_id", sa.UUID(), sa.ForeignKey("node_definitions.id"), nullable=False, index=True),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("file_type", sa.String(30), nullable=False),
        sa.Column("content", sa.LargeBinary, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Tasks
    op.create_table(
        "tasks",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("intent", sa.Text, nullable=True),
        sa.Column("matched_workflow_id", sa.UUID(), sa.ForeignKey("workflows.id"), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", index=True),
        sa.Column("execution_mode", sa.String(20), server_default="workflow"),
        sa.Column("context", postgresql.JSONB, nullable=True),
        sa.Column("input_data", postgresql.JSONB, nullable=True),
        sa.Column("output_data", postgresql.JSONB, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # TaskSteps（先建，不引用 snapshots）
    op.create_table(
        "task_steps",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("task_id", sa.UUID(), sa.ForeignKey("tasks.id"), nullable=False, index=True),
        sa.Column("node_id", sa.String(100), nullable=False),
        sa.Column("node_definition_id", sa.UUID(), sa.ForeignKey("node_definitions.id"), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending"),
        # snapshot_id 外键在 snapshots 建好后添加
        sa.Column("input_data", postgresql.JSONB, nullable=True),
        sa.Column("output_data", postgresql.JSONB, nullable=True),
        sa.Column("error", postgresql.JSONB, nullable=True),
        sa.Column("retry_count", sa.Integer, server_default="0"),
        sa.Column("round_count", sa.Integer, server_default="0"),
        sa.Column("approval_count", sa.Integer, server_default="0"),
        sa.Column("debug_info", postgresql.JSONB, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Snapshots（引用 task_steps，此时 task_steps 已存在）
    op.create_table(
        "snapshots",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("task_id", sa.UUID(), sa.ForeignKey("tasks.id"), nullable=False, index=True),
        sa.Column("step_id", sa.UUID(), sa.ForeignKey("task_steps.id"), nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("git_commit_hash", sa.String(40), nullable=False),
        sa.Column("git_diff", sa.Text, nullable=True),
        sa.Column("untracked_files", postgresql.JSONB, nullable=True),
        sa.Column("environment", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # 循环外键：task_steps.snapshot_id → snapshots.id
    op.add_column("task_steps", sa.Column("snapshot_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_task_steps_snapshot_id", "task_steps", "snapshots", ["snapshot_id"], ["id"])

    # Approvals
    op.create_table(
        "approvals",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("task_id", sa.UUID(), sa.ForeignKey("tasks.id"), nullable=False, index=True),
        sa.Column("step_id", sa.UUID(), sa.ForeignKey("task_steps.id"), nullable=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("urgency", sa.String(20), server_default="auto_decidable"),
        sa.Column("type", sa.String(20), server_default="confirm"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("options", postgresql.JSONB, nullable=True),
        sa.Column("input_schema", postgresql.JSONB, nullable=True),
        sa.Column("context_data", postgresql.JSONB, nullable=True),
        sa.Column("validation_result", postgresql.JSONB, nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", index=True),
        sa.Column("result", postgresql.JSONB, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # ExecutionPaths
    op.create_table(
        "execution_paths",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("task_id", sa.UUID(), sa.ForeignKey("tasks.id"), nullable=False, index=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("steps", postgresql.JSONB, nullable=True),
        sa.Column("total_duration", sa.Float, nullable=True),
        sa.Column("total_approvals", sa.Integer, server_default="0"),
        sa.Column("success", sa.Boolean, server_default="false"),
        sa.Column("user_rating", sa.Integer, nullable=True),
        sa.Column("precipitated_to", sa.UUID(), sa.ForeignKey("workflows.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # 循环外键：workflows.precipitated_from → execution_paths.id
    op.add_column("workflows", sa.Column("precipitated_from", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_workflows_precipitated_from", "workflows", "execution_paths", ["precipitated_from"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_workflows_precipitated_from", "workflows", type_="foreignkey")
    op.drop_column("workflows", "precipitated_from")
    op.drop_constraint("fk_task_steps_snapshot_id", "task_steps", type_="foreignkey")
    op.drop_column("task_steps", "snapshot_id")
    op.drop_table("execution_paths")
    op.drop_table("approvals")
    op.drop_table("snapshots")
    op.drop_table("task_steps")
    op.drop_table("tasks")
    op.drop_table("node_files")
    op.drop_table("node_validations")
    op.drop_table("node_definitions")
    op.drop_table("workflows")
    op.drop_table("users")
