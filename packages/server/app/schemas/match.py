"""Match Pydantic schemas"""

import uuid

from pydantic import BaseModel

from app.schemas.workflow import DAGDefinition


class MatchRequest(BaseModel):
    user_input: str


class MatchResult(BaseModel):
    mode: str  # matched | dynamic_assembly | bare_agent
    workflow_id: uuid.UUID | None = None
    workflow_name: str | None = None
    confidence: float | None = None
    dag: DAGDefinition | None = None
    reasoning: str | None = None
