"""Approval CRUD 服务"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events.bus import Event, get_event_bus
from app.models.approval import Approval
from app.schemas.approval import ApprovalCreate, ApprovalResolve


async def list_approvals(
    session: AsyncSession, user_id: uuid.UUID, urgency: str | None = None, task_id: uuid.UUID | None = None
) -> list[Approval]:
    stmt = select(Approval).where(Approval.user_id == user_id).order_by(Approval.created_at.desc())
    if urgency:
        stmt = stmt.where(Approval.urgency == urgency)
    if task_id:
        stmt = stmt.where(Approval.task_id == task_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_approval(session: AsyncSession, approval_id: uuid.UUID) -> Approval | None:
    return await session.get(Approval, approval_id)


async def create_approval(session: AsyncSession, user_id: uuid.UUID, data: ApprovalCreate) -> Approval:
    approval = Approval(
        task_id=data.task_id,
        step_id=data.step_id,
        user_id=user_id,
        source=data.source,
        urgency=data.urgency,
        type=data.type,
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
