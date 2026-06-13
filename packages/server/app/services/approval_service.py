"""Approval CRUD 服务"""

import uuid
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events.bus import Event, get_event_bus
from app.models.approval import Approval
from app.schemas.approval import ApprovalCreate, ApprovalResolve


async def list_approvals(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    urgency: str | None = None,
    task_id: uuid.UUID | None = None,
    status: str | None = None,
    approval_type: str | None = None,
    source: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Approval], int]:
    """分页查询审批列表，返回 (items, total_count)"""
    base_filter = Approval.user_id == user_id

    # 计数查询
    count_stmt = select(func.count()).select_from(Approval).where(base_filter)
    # 数据查询
    data_stmt = select(Approval).where(base_filter)

    if urgency:
        count_stmt = count_stmt.where(Approval.urgency == urgency)
        data_stmt = data_stmt.where(Approval.urgency == urgency)
    if task_id:
        count_stmt = count_stmt.where(Approval.task_id == task_id)
        data_stmt = data_stmt.where(Approval.task_id == task_id)
    if status:
        count_stmt = count_stmt.where(Approval.status == status)
        data_stmt = data_stmt.where(Approval.status == status)
    if approval_type:
        count_stmt = count_stmt.where(Approval.type == approval_type)
        data_stmt = data_stmt.where(Approval.type == approval_type)
    if source:
        count_stmt = count_stmt.where(Approval.source == source)
        data_stmt = data_stmt.where(Approval.source == source)
    if search:
        search_pattern = f"%{search}%"
        count_stmt = count_stmt.where(
            (Approval.title.ilike(search_pattern)) | (Approval.description.ilike(search_pattern))
        )
        data_stmt = data_stmt.where(
            (Approval.title.ilike(search_pattern)) | (Approval.description.ilike(search_pattern))
        )

    # 先获取总数
    total = (await session.execute(count_stmt)).scalar() or 0

    # 分页数据
    data_stmt = data_stmt.order_by(Approval.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(data_stmt)
    items = list(result.scalars().all())

    return items, total


async def get_approval(session: AsyncSession, approval_id: uuid.UUID) -> Approval | None:
    return await session.get(Approval, approval_id)


async def create_approval(session: AsyncSession, user_id: uuid.UUID, data: ApprovalCreate) -> Approval:
    approval = Approval(
        task_id=data.task_id,
        step_id=data.step_id,
        user_id=user_id,
        source=data.source.value if hasattr(data.source, "value") else data.source,
        urgency=data.urgency.value if hasattr(data.urgency, "value") else data.urgency,
        type=data.type.value if hasattr(data.type, "value") else data.type,
        title=data.title,
        description=data.description,
        options=data.options,
        input_schema=data.input_schema,
        context_data=data.context_data,
    )
    session.add(approval)
    await session.commit()
    await session.refresh(approval)
    return approval


async def resolve_approval(session: AsyncSession, approval: Approval, data: ApprovalResolve) -> Approval:
    approval.status = data.status
    approval.result = data.result
    approval.resolved_at = datetime.now()
    await session.commit()
    await session.refresh(approval)

    # 推送审批解决事件
    event_bus = get_event_bus()
    event_bus.emit(Event(
        event_type="approval:resolved",
        data={
            "approval_id": str(approval.id),
            "task_id": str(approval.task_id),
            "status": approval.status,
            "result": approval.result,
        },
        task_id=approval.task_id,
    ))

    return approval
