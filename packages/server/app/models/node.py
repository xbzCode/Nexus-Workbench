"""NodeDefinition + NodeValidation + NodeFile 模型"""

import uuid

from sqlalchemy import ForeignKey, String, Integer, LargeBinary, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class NodeDefinition(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "node_definitions"

    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(50))
    adapter_type: Mapped[str] = mapped_column(String(30), default="codebuddy")
    config_schema: Mapped[dict | None] = mapped_column(JSONB)
    input_schema: Mapped[dict | None] = mapped_column(JSONB)
    output_schema: Mapped[dict | None] = mapped_column(JSONB)
    default_config: Mapped[dict | None] = mapped_column(JSONB)
    skill_md: Mapped[str | None] = mapped_column(Text)  # 完整 SKILL.md 内容
    resources: Mapped[dict | None] = mapped_column(JSONB)  # {"skill_entry": "SKILL.md", "pip_requirements": "requirements.txt"}
    source_dir: Mapped[str | None] = mapped_column(Text)  # 扩展源码目录绝对路径（skill 节点执行时需要）
    version: Mapped[str] = mapped_column(String(20), default="1.0.0")
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | published | deprecated


class NodeValidation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "node_validations"

    node_definition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("node_definitions.id"), unique=True)
    commands: Mapped[list] = mapped_column(JSONB)  # ["npm run lint", "npm test"]
    auto_rollback: Mapped[bool] = mapped_column(default=True)
    max_retries: Mapped[int] = mapped_column(Integer, default=2)
    retry_backoff: Mapped[str] = mapped_column(String(20), default="exponential")


class NodeFile(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "node_files"

    node_definition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("node_definitions.id"), index=True)
    path: Mapped[str] = mapped_column(String(500))  # 相对路径
    file_type: Mapped[str] = mapped_column(String(30))  # agent | skill | plugin | config | prompt | script
    content: Mapped[bytes] = mapped_column(LargeBinary)
