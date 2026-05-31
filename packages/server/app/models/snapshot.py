"""Snapshot 模型"""

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Snapshot(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "snapshots"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    step_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("task_steps.id"))
    type: Mapped[str] = mapped_column(String(20))  # pre_step | post_step | pre_validation | manual
    git_commit_hash: Mapped[str] = mapped_column(String(40))
    git_diff: Mapped[str | None] = mapped_column(Text)
    untracked_files: Mapped[list | None] = mapped_column(JSONB)
    environment: Mapped[dict | None] = mapped_column(JSONB)
