"""诊断端点 — 快速测试 DAG 执行"""
import asyncio
import traceback

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from server.services.store import store
from server.services.task_runner import create_task, start_task
from server.models.schemas import Task

router = APIRouter(prefix="/api/diag", tags=["diag"])


@router.get("/run-test", response_class=PlainTextResponse)
async def run_test():
    """快速测试 DAG 执行，返回详细结果"""
    lines = []
    wf_id = list(store.workflows.keys())[0] if store.workflows else None
    if not wf_id:
        return "No workflows available!"

    wf = store.workflows[wf_id]
    lines.append(f"Workflow: {wf_id} ({wf.name})")
    lines.append(f"Nodes: {[n.id + ' def=' + n.definition_id for n in wf.dag.nodes]}")

    # 检查节点定义是否存在
    for n in wf.dag.nodes:
        nd = store.nodes.get(n.definition_id)
        lines.append(f"  Node {n.id}: def_exists={nd is not None}, def_name={nd.name if nd else 'N/A'}")

    try:
        task = await create_task(
            title="diag_test",
            intent="你好",
            workflow_id=wf_id,
            input_data={"requirement": "你好"},
        )
        lines.append(f"Task created: {task.id}")
    except Exception as e:
        lines.append(f"create_task FAILED: {type(e).__name__}: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    try:
        result = await start_task(task.id)
        lines.append(f"Task started: {result.status}")
    except Exception as e:
        lines.append(f"start_task FAILED: {type(e).__name__}: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    # 等待完成
    for i in range(60):
        await asyncio.sleep(1)
        t = store.tasks.get(task.id)
        if t.status in ("completed", "failed", "cancelled"):
            lines.append(f"Final: {t.status}")
            for s in store.steps.values():
                if s.task_id == task.id:
                    err_str = str(s.error) if s.error else "None"
                    lines.append(f"  {s.node_id}: {s.status} err={err_str[:500]}")
            break
    else:
        lines.append("TIMEOUT after 60s")

    return "\n".join(lines)
