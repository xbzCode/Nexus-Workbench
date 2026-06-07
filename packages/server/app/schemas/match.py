"""Match Pydantic schemas"""

import uuid

from pydantic import BaseModel

from app.schemas.workflow import DAGDefinition


class MatchRequest(BaseModel):
    user_input: str
    team_id: uuid.UUID | None = None  # 可选：指定 Team 进行范围匹配


class MatchResult(BaseModel):
    mode: str  # matched | dynamic_assembly | bare_agent
    workflow_id: uuid.UUID | None = None
    workflow_name: str | None = None
    team_id: uuid.UUID | None = None  # 匹配到的 Team
    team_name: str | None = None
    confidence: float | None = None
    dag: DAGDefinition | None = None
    reasoning: str | None = None
    available_workflow_names: list[str] | None = None  # 用户已有但未匹配的工作流名称（调试用）
