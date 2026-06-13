"""审批 API"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.schemas.approval import ApprovalCreate, ApprovalResponse, ApprovalResolve
from app.schemas.base import APIResponse
from app.services import approval_service

router = APIRouter()


def _to_response(approval) -> ApprovalResponse:
    """ORM → Pydantic schema"""
    return ApprovalResponse.model_validate(approval)


class ApprovalListResponse(BaseModel):
    """分页审批列表响应"""
    items: list[ApprovalResponse]
    total: int
    limit: int
    offset: int


@router.get("")
async def list_approvals(
    status: str | None = Query(None, description="按状态过滤: pending/approved/rejected/expired"),
    urgency: str | None = Query(None, description="按紧急度过滤"),
    type: str | None = Query(None, description="按审批类型过滤: confirm/choice/multi_choice/ranking/input/form"),
    source: str | None = Query(None, description="按来源过滤: agent/workflow"),
    task_id: uuid.UUID | None = Query(None, description="按任务ID过滤"),
    search: str | None = Query(None, description="搜索标题/描述"),
    limit: int = Query(50, ge=1, le=200, description="每页数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    session: AsyncSession = Depends(get_session),
):
    items, total = await approval_service.list_approvals(
        session, TEMP_USER_ID,
        urgency=urgency, task_id=task_id, status=status,
        approval_type=type, source=source, search=search,
        limit=limit, offset=offset,
    )
    data = ApprovalListResponse(
        items=[_to_response(a) for a in items],
        total=total,
        limit=limit,
        offset=offset,
    )
    return APIResponse(data=data.model_dump())


@router.post("", status_code=201)
async def create_approval(body: ApprovalCreate, session: AsyncSession = Depends(get_session)):
    approval = await approval_service.create_approval(session, TEMP_USER_ID, body)
    return APIResponse(data=_to_response(approval).model_dump())


@router.get("/{approval_id}")
async def get_approval(approval_id: str, session: AsyncSession = Depends(get_session)):
    approval = await approval_service.get_approval(session, uuid.UUID(approval_id))
    if not approval:
        raise HTTPException(404, "Approval not found")
    return APIResponse(data=_to_response(approval).model_dump())


@router.post("/{approval_id}/resolve")
async def resolve_approval(
    approval_id: str, body: ApprovalResolve, session: AsyncSession = Depends(get_session)
):
    approval = await approval_service.get_approval(session, uuid.UUID(approval_id))
    if not approval:
        raise HTTPException(404, "Approval not found")
    if approval.status != "pending":
        raise HTTPException(400, f"Approval already resolved as {approval.status}")
    resolved = await approval_service.resolve_approval(session, approval, body)
    return APIResponse(data=_to_response(resolved).model_dump())
