"""Workflow Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── DAG 子结构 ──

class NodeInstance(BaseModel):
    id: str
    definition_id: str
    position: dict = Field(default_factory=lambda: {"x": 0, "y": 0})
    config: dict = Field(default_factory=dict)
    hooks: list[dict] = Field(default_factory=list)


class EdgeDef(BaseModel):
    source_id: str
    target_id: str
    condition: str | None = None
    data_mapping: dict | None = None


class DAGDefinition(BaseModel):
    nodes: list[NodeInstance] = Field(default_factory=list)
    edges: list[EdgeDef] = Field(default_factory=list)


# ── CRUD ──

class WorkflowCreate(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None
    dag: DAGDefinition | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    dag: DAGDefinition | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    status: str | None = None


class WorkflowResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: str | None
    category: str | None
    dag: dict | None
    input_schema: dict | None
    output_schema: dict | None
    version: int
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
