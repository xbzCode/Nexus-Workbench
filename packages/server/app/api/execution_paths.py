"""执行路径 API"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.schemas.base import APIResponse
from app.schemas.execution_path import ExecutionPathResponse, PrecipitateRequest, RateRequest
from app.services import execution_path_service

router = APIRouter()


@router.get("")
async def list_execution_paths(
    task_id: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """列出执行路径，可选按 task_id 过滤"""
    from uuid import UUID
    if task_id:
        items = await execution_path_service.get_task_paths(session, UUID(task_id))
    else:
        from sqlalchemy import select
        from app.models.execution_path import ExecutionPath
        result = await session.execute(select(ExecutionPath).order_by(ExecutionPath.created_at.desc()).limit(100))
        items = list(result.scalars().all())
    return APIResponse(data=items)


@router.get("/{path_id}")
async def get_execution_path(path_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    ep = await execution_path_service.get_path(session, UUID(path_id))
    if not ep:
        raise HTTPException(404, "Execution path not found")
    return APIResponse(data=ep)


@router.post("/{path_id}/precipitate")
async def precipitate(
    path_id: str, body: PrecipitateRequest, session: AsyncSession = Depends(get_session)
):
    from uuid import UUID
    result = await execution_path_service.precipitate(session, UUID(path_id), body)
    return APIResponse(data=result)


@router.post("/{path_id}/rate")
async def rate_path(
    path_id: str, body: RateRequest, session: AsyncSession = Depends(get_session)
):
    from uuid import UUID
    await execution_path_service.rate(session, UUID(path_id), body.rating)
    return APIResponse(message="Rated")
