"""ExecutionPath + PathStep 模型"""

import uuid

from sqlalchemy import ForeignKey, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ExecutionPath(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "execution_paths"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    source: Mapped[str] = mapped_column(String(20))  # bare_agent | dynamic_assembly
    steps: Mapped[list | None] = mapped_column(JSONB)
    total_duration: Mapped[float | None] = mapped_column(Float)
    total_approvals: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(default=False)
    user_rating: Mapped[int | None] = mapped_column(Integer)  # 1-5
    precipitated_to: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workflows.id"))
