"""Team 模型 — AI 能力团队，将工作流和节点按领域分组

Team 是一个具有领域上下文、专属工具集和标准流程的 AI 执行单元。
用户选 Team 下达任务时，隐含了领域方法论、质量标准和执行约束。

关联：
- Team.workflow_ids (JSONB) → Workflow (M2M)
- Team.node_definition_ids (JSONB) → NodeDefinition (M2M)
"""

import uuid

from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Team(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "teams"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(10))

    # 领域知识注入：执行任务时注入到 Adapter 的 system prompt
    team_prompt: Mapped[str | None] = mapped_column(Text)
    default_adapter_type: Mapped[str] = mapped_column(String(30), default="codebuddy")

    # M2M 关联：一个 Team 包含多个 Workflow / NodeDefinition
    workflow_ids: Mapped[list] = mapped_column(JSONB, default=list)
    node_definition_ids: Mapped[list] = mapped_column(JSONB, default=list)

    status: Mapped[str] = mapped_column(String(20), default="active")  # active | archived
