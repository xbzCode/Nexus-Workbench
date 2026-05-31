"""Snapshot 服务"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.snapshot import Snapshot


async def list_snapshots(session: AsyncSession, task_id: uuid.UUID) -> list[Snapshot]:
    result = await session.execute(
        select(Snapshot).where(Snapshot.task_id == task_id).order_by(Snapshot.created_at)
    )
    return list(result.scalars().all())


async def get_snapshot(session: AsyncSession, snapshot_id: uuid.UUID) -> Snapshot | None:
    return await session.get(Snapshot, snapshot_id)


async def create_snapshot(session: AsyncSession, task_id: uuid.UUID, step_id: uuid.UUID | None,
                          type: str, git_commit_hash: str, **kwargs) -> Snapshot:
    snap = Snapshot(
        task_id=task_id,
        step_id=step_id,
        type=type,
        git_commit_hash=git_commit_hash,
        **kwargs,
    )
    session.add(snap)
    await session.commit()
    await session.refresh(snap)
    return snap
