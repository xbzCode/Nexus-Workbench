"""Approval Pydantic schemas"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel


class ApprovalSource(str, Enum):
    AGENT = "agent"
    WORKFLOW = "workflow"


class ApprovalUrgency(str, Enum):
    AUTO_DECIDABLE = "auto_decidable"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class ApprovalType(str, Enum):
    CONFIRM = "confirm"
    CHOICE = "choice"
    MULTI_CHOICE = "multi_choice"
    RANKING = "ranking"
    INPUT = "input"
    FORM = "form"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    AUTO_APPROVED = "auto_approved"


class ApprovalCreate(BaseModel):
    task_id: uuid.UUID
    step_id: uuid.UUID | None = None
    source: ApprovalSource = ApprovalSource.AGENT
    urgency: ApprovalUrgency = ApprovalUrgency.AUTO_DECIDABLE
    type: ApprovalType = ApprovalType.CONFIRM
    title: str
    description: str | None = None
    options: list[dict] | None = None
    input_schema: dict | None = None
    context_data: dict | None = None


class ApprovalResolve(BaseModel):
    status: Literal["approved", "rejected"]
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
