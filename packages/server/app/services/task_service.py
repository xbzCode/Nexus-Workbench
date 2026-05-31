"""Task 服务 — DAG 执行（Mock + Adapter 双模式）"""

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.core.dag.serializer import dag_from_dict
from app.core.events.bus import Event, EventBus, get_event_bus
from app.core.executor.engine import execute_dag
from app.models.task import Task, TaskStep
from app.schemas.workflow import DAGDefinition, NodeInstance
from app.schemas.task import TaskCreate

# 运行中的任务 {task_id: asyncio.Task}
_running_tasks: dict[uuid.UUID, Any] = {}


async def list_tasks(session: AsyncSession, user_id: uuid.UUID) -> list[Task]:
    result = await session.execute(
        select(Task).where(Task.user_id == user_id).order_by(Task.created_at.desc())
    )
    return list(result.scalars().all())


async def get_task(session: AsyncSession, task_id: uuid.UUID) -> Task | None:
    return await session.get(Task, task_id)


async def create_task(session: AsyncSession, user_id: uuid.UUID, data: TaskCreate) -> Task:
    # 确定 execution_mode
    if data.execution_mode:
        execution_mode = data.execution_mode
    elif data.workflow_id:
        execution_mode = "workflow"
    elif data.dag:
        execution_mode = "dynamic_assembly"
    else:
        execution_mode = "bare_agent"

    # 动态组装的 DAG 存入 context
    context = None
    if data.dag:
        context = {"dag": data.dag.model_dump()}

    task = Task(
        user_id=user_id,
        title=data.title,
        matched_workflow_id=data.workflow_id,
        input_data=data.input_data,
        execution_mode=execution_mode,
        context=context,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def get_task_steps(session: AsyncSession, task_id: uuid.UUID) -> list[TaskStep]:
    result = await session.execute(
        select(TaskStep).where(TaskStep.task_id == task_id).order_by(TaskStep.created_at)
    )
    return list(result.scalars().all())


async def get_step(session: AsyncSession, step_id: uuid.UUID) -> TaskStep | None:
    return await session.get(TaskStep, step_id)


async def start_task(
    session: AsyncSession,
    task: Task,
    workflow_dag: dict | None = None,
) -> None:
    """启动任务执行

    Args:
        session: DB session
        task: Task 实例
        workflow_dag: 工作流的 DAG（JSONB dict），如无则用空 DAG
    """
    if task.status not in ("pending", "paused"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Task status is {task.status}, cannot start")

    task.status = "running"
    task.started_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(task)

    # 获取 DAG
    if workflow_dag:
        dag = DAGDefinition(**workflow_dag)
    elif task.execution_mode == "bare_agent":
        # 裸 Agent 模式 → 构造单节点 DAG，使用 bare-agent 节点
        # 从 context 中提取 bare-agent 的 definition_id（启动时同步的内置节点）
        from app.services.node_service import get_node_by_name
        bare_node = await get_node_by_name(session, "bare-agent")
        definition_id = str(bare_node.id) if bare_node else "bare-agent"

        dag = DAGDefinition(
            nodes=[
                NodeInstance(
                    id="agent_1",
                    definition_id=definition_id,
                    config={"prompt_template": "{input}"},
                )
            ],
            edges=[],
        )
    else:
        # 其他无 DAG 的情况
        dag = DAGDefinition(nodes=[], edges=[])

    # 在后台执行 DAG
    event_bus = get_event_bus()
    task_id = task.id

    import asyncio
    from app.config.database import async_session_factory

    # 工作目录
    workspace_dir = os.path.abspath(settings.WORKSPACE_DIR)

    async def _run():
        """后台任务 — 使用独立 session 更新状态"""
        async with async_session_factory() as bg_session:
            try:
                node_outputs = await execute_dag(
                    dag=dag,
                    event_bus=event_bus,
                    workflow_input=task.input_data or {},
                    task_id=task_id,
                    workspace_dir=workspace_dir,
                    mock_mode=False,
                )
                # 更新任务状态（如果 engine 没有更新）
                bg_task = await bg_session.get(Task, task_id)
                if bg_task and bg_task.status == "running":
                    bg_task.output_data = node_outputs
                    bg_task.status = "completed"
                    bg_task.completed_at = datetime.now(timezone.utc)
                    await bg_session.commit()
            except Exception as e:
                bg_task = await bg_session.get(Task, task_id)
                if bg_task and bg_task.status == "running":
                    bg_task.status = "failed"
                    bg_task.output_data = {"error": str(e)}
                    bg_task.completed_at = datetime.now(timezone.utc)
                    await bg_session.commit()
            finally:
                _running_tasks.pop(task_id, None)

    background_task = asyncio.create_task(_run())
    _running_tasks[task_id] = background_task


async def cancel_task(session: AsyncSession, task: Task) -> None:
    """取消任务"""
    if task.id in _running_tasks:
        _running_tasks[task.id].cancel()
        _running_tasks.pop(task.id, None)

    task.status = "cancelled"
    task.completed_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(task)


# ── 暂停/恢复控制 ──

# 暂停信号集合 {task_id}：引擎在执行循环中检查此集合
_paused_tasks: set[uuid.UUID] = set()


def is_task_paused(task_id: uuid.UUID) -> bool:
    """引擎调用：检查任务是否被暂停"""
    return task_id in _paused_tasks


async def pause_task(session: AsyncSession, task: Task) -> None:
    """暂停任务

    设置暂停信号，引擎会在下一个检查点停止执行。
    任务状态设为 paused。
    """
    if task.status != "running":
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Task status is {task.status}, cannot pause (only running tasks can be paused)")

    _paused_tasks.add(task.id)

    task.status = "paused"
    await session.commit()
    await session.refresh(task)

    # 发送暂停事件
    event_bus = get_event_bus()
    event_bus.emit(Event(
        event_type="task:paused",
        data={"task_id": str(task.id)},
        task_id=task.id,
    ))


async def resume_task(session: AsyncSession, task: Task, workflow_dag: dict | None = None) -> None:
    """恢复暂停的任务

    清除暂停信号，将状态恢复为 running，然后重新启动后台执行。
    引擎会从上次中断的节点继续执行（通过已完成的 steps 判断跳过）。
    """
    if task.status != "paused":
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Task status is {task.status}, cannot resume (only paused tasks can be resumed)")

    _paused_tasks.discard(task.id)

    # 重新走 start_task 逻辑（start_task 已支持 paused 状态）
    await start_task(session, task, workflow_dag)

    # 发送恢复事件
    event_bus = get_event_bus()
    event_bus.emit(Event(
        event_type="task:resumed",
        data={"task_id": str(task.id)},
        task_id=task.id,
    ))
