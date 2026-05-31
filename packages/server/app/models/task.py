"""Task + TaskStep 模型"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import DateTime

from app.models.base import Base, TimestampMixin, UUIDMixin


class Task(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tasks"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(Text)
    intent: Mapped[str | None] = mapped_column(Text)
    matched_workflow_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workflows.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending | running | paused | completed | failed | cancelled
    execution_mode: Mapped[str] = mapped_column(String(20), default="workflow")
    # workflow | dynamic_assembly | bare_agent
    context: Mapped[dict | None] = mapped_column(JSONB)  # ExecutionContext
    input_data: Mapped[dict | None] = mapped_column(JSONB)
    output_data: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskStep(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "task_steps"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    node_id: Mapped[str] = mapped_column(String(100))  # DAG 中的节点实例 ID
    node_definition_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("node_definitions.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending | running | waiting_approval | completed | failed | skipped | rolled_back
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("snapshots.id"))
    input_data: Mapped[dict | None] = mapped_column(JSONB)
    output_data: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[dict | None] = mapped_column(JSONB)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    round_count: Mapped[int] = mapped_column(Integer, default=0)
    approval_count: Mapped[int] = mapped_column(Integer, default=0)
    debug_info: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
