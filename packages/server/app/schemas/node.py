"""NodeDefinition Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class NodeValidationSchema(BaseModel):
    commands: list[str]
    auto_rollback: bool = True
    max_retries: int = 2
    retry_backoff: str = "exponential"


class NodeDefCreate(BaseModel):
    name: str
    display_name: str
    description: str | None = None
    category: str | None = None
    adapter_type: str = "codebuddy"
    config_schema: dict | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    default_config: dict | None = None
    skill_md: str | None = None
    resources: dict | None = None
    validation: NodeValidationSchema | None = None


class NodeDefUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    category: str | None = None
    adapter_type: str | None = None
    config_schema: dict | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    default_config: dict | None = None
    skill_md: str | None = None
    resources: dict | None = None
    status: str | None = None


class NodeDefResponse(BaseModel):
    id: uuid.UUID
    author_id: uuid.UUID
    name: str
    display_name: str
    description: str | None
    category: str | None
    adapter_type: str
    config_schema: dict | None
    input_schema: dict | None
    output_schema: dict | None
    default_config: dict | None
    skill_md: str | None
    resources: dict | None = None
    source_dir: str | None = None
    version: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
