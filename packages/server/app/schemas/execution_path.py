"""ExecutionPath Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class ExecutionPathResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    source: str
    steps: list | None
    total_duration: float | None
    total_approvals: int
    success: bool
    user_rating: int | None
    precipitated_to: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PrecipitateRequest(BaseModel):
    workflow_name: str
    workflow_description: str | None = None


class RateRequest(BaseModel):
    rating: int  # 1-5
