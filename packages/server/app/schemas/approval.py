"""Approval Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class ApprovalCreate(BaseModel):
    task_id: uuid.UUID
    step_id: uuid.UUID | None = None
    source: str  # agent | workflow
    urgency: str = "auto_decidable"
    type: str = "confirm"
    title: str
    description: str | None = None
    options: list[dict] | None = None
    input_schema: dict | None = None
    context_data: dict | None = None


class ApprovalResolve(BaseModel):
    status: str  # approved | rejected
    result: dict | None = None


class ApprovalResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    step_id: uuid.UUID | None
    user_id: uuid.UUID
    source: str
    urgency: str
    type: str
    title: str
    description: str | None
    options: list | None
    input_schema: dict | None
    context_data: dict | None
    validation_result: dict | None
    status: str
    result: dict | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None

    model_config = {"from_attributes": True}
