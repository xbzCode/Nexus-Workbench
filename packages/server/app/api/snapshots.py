"""快照 API"""

import os
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.config.settings import settings
from app.schemas.base import APIResponse
from app.schemas.snapshot import SnapshotCreate, SnapshotResponse
from app.services import snapshot_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("")
async def list_snapshots(task_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    items = await snapshot_service.list_snapshots(session, UUID(task_id))
    return APIResponse(data=items)


@router.get("/{snapshot_id}")
async def get_snapshot(snapshot_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    snap = await snapshot_service.get_snapshot(session, UUID(snapshot_id))
    if not snap:
        raise HTTPException(404, "Snapshot not found")
    return APIResponse(data=snap)


@router.post("", status_code=201)
async def create_snapshot(body: SnapshotCreate, session: AsyncSession = Depends(get_session)):
    snap = await snapshot_service.create_snapshot(
        session=session,
        task_id=body.task_id,
        step_id=body.step_id,
        type=body.type,
        git_commit_hash=body.git_commit_hash,
        git_diff=body.git_diff,
        untracked_files=body.untracked_files,
        environment=body.environment,
    )
    return APIResponse(data=snap)


@router.post("/{snapshot_id}/rollback")
async def rollback_snapshot(snapshot_id: str, session: AsyncSession = Depends(get_session)):
    """回滚到指定快照

    执行 git checkout 恢复工作目录到该快照的 commit_hash 状态。
    """
    from uuid import UUID
    snap = await snapshot_service.get_snapshot(session, UUID(snapshot_id))
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    workspace_dir = os.path.abspath(settings.WORKSPACE_DIR)
    commit_hash = snap.git_commit_hash

    try:
        # git checkout 恢复到指定 commit
        import asyncio
        proc = await asyncio.create_subprocess_exec(
            "git", "checkout", commit_hash,
            cwd=workspace_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

        if proc.returncode != 0:
            error_msg = stderr.decode().strip() or f"git checkout failed with code {proc.returncode}"
            logger.error(f"[Snapshot] Rollback failed: {error_msg}")
            raise HTTPException(500, f"回滚失败: {error_msg}")

        logger.info(f"[Snapshot] Rolled back to {commit_hash[:8]}")

        # 如果有 untracked_files 信息，删除回滚后多出的未跟踪文件
        # （保守策略：只做 checkout，不自动删除文件，由用户手动清理）

    except asyncio.TimeoutError:
        raise HTTPException(500, "回滚超时")
    except FileNotFoundError:
        raise HTTPException(500, "git 命令不可用，无法执行回滚")

    return APIResponse(data=snap)
