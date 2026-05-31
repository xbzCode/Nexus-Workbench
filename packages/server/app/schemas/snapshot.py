"""Snapshot Pydantic schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class SnapshotCreate(BaseModel):
    task_id: uuid.UUID
    step_id: uuid.UUID | None = None
    type: str
    git_commit_hash: str
    git_diff: str | None = None
    untracked_files: list | None = None
    environment: dict | None = None


class SnapshotResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    step_id: uuid.UUID | None
    type: str
    git_commit_hash: str
    git_diff: str | None
    untracked_files: list | None
    environment: dict | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
