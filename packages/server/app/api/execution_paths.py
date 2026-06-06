"""执行路径 API"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models.execution_path import ExecutionPath
from app.schemas.base import APIResponse
from app.schemas.execution_path import ExecutionPathResponse, PrecipitateRequest, RateRequest
from app.services import execution_path_service

router = APIRouter()


def _to_response(ep) -> ExecutionPathResponse:
    """ORM → Pydantic schema"""
    return ExecutionPathResponse.model_validate(ep)


@router.get("")
async def list_execution_paths(
    task_id: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """列出执行路径，可选按 task_id 过滤"""
    if task_id:
        items = await execution_path_service.get_task_paths(session, uuid.UUID(task_id))
    else:
        result = await session.execute(select(ExecutionPath).order_by(ExecutionPath.created_at.desc()).limit(100))
        items = list(result.scalars().all())
    data = [_to_response(ep) for ep in items]
    return APIResponse(data=data)


@router.get("/{path_id}")
async def get_execution_path(path_id: str, session: AsyncSession = Depends(get_session)):
    ep = await execution_path_service.get_path(session, uuid.UUID(path_id))
    if not ep:
        raise HTTPException(404, "Execution path not found")
    return APIResponse(data=_to_response(ep))


@router.post("/{path_id}/precipitate")
async def precipitate(
    path_id: str, body: PrecipitateRequest, session: AsyncSession = Depends(get_session)
):
    result = await execution_path_service.precipitate(session, uuid.UUID(path_id), body)
    return APIResponse(data=result)


@router.post("/{path_id}/rate")
async def rate_path(
    path_id: str, body: RateRequest, session: AsyncSession = Depends(get_session)
):
    await execution_path_service.rate(session, uuid.UUID(path_id), body.rating)
    return APIResponse(message="Rated")
