"""Approval 审批服务 — 双来源统一（agent + workflow）

审批流程（改造后）：
  - Agent 提问/审批 → task_runner 事件循环中创建 approval → _wait_for_approval 阻塞
  - 用户在 Web UI 回答 → resolve_approval 更新状态
  - _wait_for_approval 检测到已解决 → 返回结果 → task_runner 调 adapter.resume_session
  - 不再需要 adapter.respond()，resume 逻辑统一在 task_runner 中处理
"""

from datetime import datetime
from server.models.schemas import Approval, ApprovalSource, Task, TaskStep, StepState
from server.services.store import store
from server.core.events import event_bus


async def create_approval(
    task_id: str,
    step_id: str,
    source: str,
    approval_type: str,
    title: str,
    description: str = "",
    context_data: dict | None = None,
    options: list[dict] | None = None,
    input_schema: dict | None = None,
) -> Approval:
    """创建审批请求"""
    approval = Approval(
        task_id=task_id,
        step_id=step_id,
        source=source,
        type=approval_type,
        title=title,
        description=description,
        context_data=context_data or {},
        options=options,
        input_schema=input_schema,
    )
    store.approvals[approval.id] = approval
    store.save()

    # 更新步骤状态
    step = store.steps.get(step_id)
    if step:
        step.status = StepState.WAITING_APPROVAL
        store.save()

    await event_bus.emit("approval:created", {
        "approval_id": approval.id,
        "task_id": task_id,
        "source": source,
        "title": title,
        "type": approval_type,
    })

    return approval


async def resolve_approval(approval_id: str, approved: bool, result_data: dict | None = None) -> Approval:
    """处理审批
    
    注意：resolve 只是更新审批状态，不再直接调用 adapter。
    resume 逻辑由 task_runner 的事件循环统一处理。
    """
    approval = store.approvals.get(approval_id)
    if not approval:
        raise ValueError(f"审批不存在: {approval_id}")

    if approval.status != "pending":
        raise ValueError(f"审批已处理: {approval.status}")

    approval.status = "approved" if approved else "rejected"
    approval.result = result_data or {"approved": approved}
    approval.resolved_at = datetime.now().isoformat()
    store.save()

    await event_bus.emit("approval:resolved", {
        "approval_id": approval_id,
        "approved": approved,
        "source": approval.source,
    })

    return approval


async def list_pending_approvals(task_id: str | None = None) -> list[Approval]:
    """列出待审批"""
    approvals = [a for a in store.approvals.values() if a.status == "pending"]
    if task_id:
        approvals = [a for a in approvals if a.task_id == task_id]
    return approvals


async def get_approval(approval_id: str) -> Approval:
    """获取审批详情"""
    approval = store.approvals.get(approval_id)
    if not approval:
        raise ValueError(f"审批不存在: {approval_id}")
    return approval
