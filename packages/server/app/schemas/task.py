"""Task + TaskStep Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.workflow import DAGDefinition


class TaskCreate(BaseModel):
    title: str
    input_data: dict | None = None
    workflow_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None  # 可选：指定 Team
    execution_mode: str | None = None  # workflow | dynamic_assembly | bare_agent
    dag: DAGDefinition | None = None  # 动态组装时直接传入 DAG


class TaskResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    team_id: uuid.UUID | None = None
    team_name: str | None = None  # 联查 Team 表填充
    title: str
    intent: str | None
    matched_workflow_id: uuid.UUID | None
    workflow_name: str | None = None  # 联查 Workflow 表填充
    status: str
    execution_mode: str
    context: dict | None
    dag: dict | None = None  # 联查填充：workflow→Workflow.dag, dynamic_assembly→context.dag, bare_agent→构造
    input_data: dict | None
    output_data: dict | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StepResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    node_id: str
    node_definition_id: uuid.UUID | None
    status: str
    snapshot_id: uuid.UUID | None
    input_data: dict | None
    output_data: dict | None
    error: dict | None
    retry_count: int
    round_count: int
    approval_count: int
    debug_info: dict | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}
