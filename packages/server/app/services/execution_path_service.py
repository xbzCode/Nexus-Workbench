"""ExecutionPath 服务"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.execution_path import ExecutionPath
from app.models.task import Task
from app.models.workflow import Workflow
from app.schemas.execution_path import PrecipitateRequest


async def get_path(session: AsyncSession, path_id: uuid.UUID) -> ExecutionPath | None:
    return await session.get(ExecutionPath, path_id)


async def get_task_paths(session: AsyncSession, task_id: uuid.UUID) -> list[ExecutionPath]:
    result = await session.execute(
        select(ExecutionPath).where(ExecutionPath.task_id == task_id)
    )
    return list(result.scalars().all())


async def rate(session: AsyncSession, path_id: uuid.UUID, rating: int) -> None:
    ep = await session.get(ExecutionPath, path_id)
    if ep:
        ep.user_rating = max(1, min(5, rating))
        await session.commit()


async def precipitate(
    session: AsyncSession, path_id: uuid.UUID, body: PrecipitateRequest
) -> dict:
    """从执行路径沉淀为工作流

    从关联的 task.context 中提取 DAG（动态组装场景），
    或从 ExecutionPath.steps 中重建 DAG（裸 Agent 场景）。
    """
    ep = await session.get(ExecutionPath, path_id)
    if not ep:
        return {"error": "Execution path not found"}

    # 尝试从关联 task 获取 DAG
    dag = None
    task = await session.get(Task, ep.task_id)
    if task and task.context and "dag" in task.context:
        dag = task.context["dag"]
    elif ep.steps:
        # 从 ExecutionPath.steps 重建 DAG
        dag = _steps_to_dag(ep.steps)

    from app.api.deps import TEMP_USER_ID

    wf = Workflow(
        user_id=TEMP_USER_ID,
        name=body.workflow_name,
        description=body.workflow_description,
        category="precipitated",
        dag=dag,
        precipitated_from=path_id,
    )
    session.add(wf)
    await session.flush()

    ep.precipitated_to = wf.id
    await session.commit()
    return {"workflow_id": str(wf.id)}


def _steps_to_dag(steps: list) -> dict | None:
    """从执行步骤重建 DAG

    steps 格式预期: [{"node_id": "...", "definition_id": "...", ...}]
    """
    if not steps:
        return None

    nodes = []
    edges = []
    prev_id = None
    for i, step in enumerate(steps):
        node_id = step.get("node_id", f"node_{i+1}")
        definition_id = step.get("definition_id", step.get("node_id", ""))
        nodes.append({
            "id": node_id,
            "definition_id": definition_id,
            "position": {"x": 0, "y": i * 100},
            "config": step.get("config", {}),
            "hooks": [],
        })
        if prev_id:
            edges.append({
                "source_id": prev_id,
                "target_id": node_id,
            })
        prev_id = node_id

    return {"nodes": nodes, "edges": edges}
