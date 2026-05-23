"""断点调试 API — 设置/移除断点、继续/单步执行"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.models.schemas import TaskStatus
from server.services.store import store
from server.core.events import event_bus

router = APIRouter(prefix="/api/tasks/{task_id}/debug", tags=["debug"])


class SetBreakpointRequest(BaseModel):
    node_id: str


@router.post("/breakpoints")
async def set_breakpoint(task_id: str, req: SetBreakpointRequest):
    """设置断点"""
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    if req.node_id not in task.context.step_states and req.node_id not in [
        n.id for n in store.workflows.get(task.matched_workflow_id, type('obj', (), {'dag': type('obj', (), {'nodes': []})})).dag.nodes
    ]:
        raise HTTPException(400, f"节点 {req.node_id} 不在此工作流中")

    if req.node_id not in task.context.breakpoints:
        task.context.breakpoints.append(req.node_id)
        store.save()

    return {"task_id": task_id, "breakpoints": task.context.breakpoints}


@router.delete("/breakpoints/{node_id}")
async def remove_breakpoint(task_id: str, node_id: str):
    """移除断点"""
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    if node_id in task.context.breakpoints:
        task.context.breakpoints.remove(node_id)
        store.save()

    return {"task_id": task_id, "breakpoints": task.context.breakpoints}


@router.post("/continue")
async def debug_continue(task_id: str):
    """继续执行（移除所有断点）"""
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    task.context.breakpoints.clear()
    store.save()

    return {"task_id": task_id, "action": "continue", "breakpoints": []}


@router.get("/state")
async def debug_state(task_id: str):
    """获取调试状态"""
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    return {
        "task_id": task_id,
        "status": task.status,
        "current_step_id": task.context.current_step_id,
        "breakpoints": task.context.breakpoints,
        "step_states": task.context.step_states,
    }
