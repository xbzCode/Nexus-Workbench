"""Approval 模型 — 双来源统一 + 分级决策"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Approval(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "approvals"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    step_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("task_steps.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(20))  # agent | workflow
    urgency: Mapped[str] = mapped_column(String(20), default="auto_decidable")
    # auto_decidable | normal | high | critical
    type: Mapped[str] = mapped_column(String(20), default="confirm")
    # confirm | choice | ranking | input | form
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSONB)
    input_schema: Mapped[dict | None] = mapped_column(JSONB)
    context_data: Mapped[dict | None] = mapped_column(JSONB)
    validation_result: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending | approved | rejected | expired | auto_approved
    result: Mapped[dict | None] = mapped_column(JSONB)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
