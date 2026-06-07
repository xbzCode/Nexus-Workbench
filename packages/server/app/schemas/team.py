"""Team Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── CRUD ──

class TeamCreate(BaseModel):
    name: str
    display_name: str
    description: str | None = None
    icon: str | None = None
    team_prompt: str | None = None
    default_adapter_type: str = "codebuddy"
    workflow_ids: list[str] = Field(default_factory=list)
    node_definition_ids: list[str] = Field(default_factory=list)


class TeamUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    icon: str | None = None
    team_prompt: str | None = None
    default_adapter_type: str | None = None
    workflow_ids: list[str] | None = None
    node_definition_ids: list[str] | None = None
    status: str | None = None  # active | archived


class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str
    description: str | None
    icon: str | None
    team_prompt: str | None
    default_adapter_type: str
    workflow_ids: list[str]
    node_definition_ids: list[str]
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TeamSummary(BaseModel):
    """轻量摘要，用于 LLM 匹配时传递"""
    id: str
    name: str
    display_name: str
    description: str

    class Config:
        from_attributes = True


# ── 关联管理 ──

class TeamMembershipUpdate(BaseModel):
    """批量管理 Team 内的资源归属"""
    workflow_ids: list[str] | None = None
    node_definition_ids: list[str] | None = None
