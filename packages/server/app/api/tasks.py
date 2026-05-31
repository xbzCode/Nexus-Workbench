"""任务 API — 含启动/取消/执行"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.models.workflow import Workflow
from app.schemas.base import APIResponse
from app.schemas.task import StepResponse, TaskCreate, TaskResponse
from app.services import task_service

router = APIRouter()


@router.get("", response_model=APIResponse[list[TaskResponse]])
async def list_tasks(session: AsyncSession = Depends(get_session)):
    items = await task_service.list_tasks(session, TEMP_USER_ID)
    return APIResponse(data=items)


@router.get("/{task_id}", response_model=APIResponse[TaskResponse])
async def get_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    return APIResponse(data=task)


@router.post("", response_model=APIResponse[TaskResponse], status_code=201)
async def create_task(body: TaskCreate, session: AsyncSession = Depends(get_session)):
    task = await task_service.create_task(session, TEMP_USER_ID, body)
    return APIResponse(data=task)


@router.post("/{task_id}/start", response_model=APIResponse[TaskResponse])
async def start_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")

    # 获取 DAG：优先从关联工作流，其次从 task.context（动态组装）
    workflow_dag = None
    if task.matched_workflow_id:
        wf = await session.get(Workflow, task.matched_workflow_id)
        if wf and wf.dag:
            workflow_dag = wf.dag
    elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
        workflow_dag = task.context["dag"]

    await task_service.start_task(session, task, workflow_dag)
    return APIResponse(data=task)


@router.post("/{task_id}/cancel", response_model=APIResponse[TaskResponse])
async def cancel_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    await task_service.cancel_task(session, task)
    return APIResponse(data=task)


@router.post("/{task_id}/pause", response_model=APIResponse[TaskResponse])
async def pause_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    await task_service.pause_task(session, task)
    return APIResponse(data=task)


@router.post("/{task_id}/resume", response_model=APIResponse[TaskResponse])
async def resume_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")

    # 获取 DAG：与 start_task 相同的逻辑
    workflow_dag = None
    if task.matched_workflow_id:
        wf = await session.get(Workflow, task.matched_workflow_id)
        if wf and wf.dag:
            workflow_dag = wf.dag
    elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
        workflow_dag = task.context["dag"]

    await task_service.resume_task(session, task, workflow_dag)
    return APIResponse(data=task)


@router.get("/{task_id}/steps", response_model=APIResponse[list[StepResponse]])
async def get_task_steps(task_id: str, session: AsyncSession = Depends(get_session)):
    steps = await task_service.get_task_steps(session, uuid.UUID(task_id))
    return APIResponse(data=steps)
