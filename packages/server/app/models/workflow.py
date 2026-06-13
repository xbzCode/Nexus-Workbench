"""Workflow 模型 — 含 DAG JSONB"""

import uuid

from sqlalchemy import ForeignKey, String, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Workflow(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workflows"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(50))
    dag: Mapped[dict | None] = mapped_column(JSONB)
    input_schema: Mapped[dict | None] = mapped_column(JSONB)
    output_schema: Mapped[dict | None] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | published
    precipitated_from: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("execution_paths.id", use_alter=True, name="fk_workflows_precipitated_from"))
