"""任务 API — 含启动/取消/执行"""

import copy
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.models.node import NodeDefinition
from app.models.workflow import Workflow
from app.schemas.base import APIResponse
from app.schemas.task import StepResponse, TaskCreate, TaskResponse
from app.services import task_service

router = APIRouter()


async def _enrich_dag_display_names(
    dag: dict | None, session: AsyncSession
) -> dict | None:
    """为 DAG 中的节点填充 display_name（从 NodeDefinition 表联查）"""
    if not dag or not dag.get("nodes"):
        return dag

    # 收集所有 definition_id，批量查询
    def_ids = {
        n["definition_id"]
        for n in dag["nodes"]
        if n.get("definition_id")
    }
    name_map: dict[str, str] = {}
    if def_ids:
        result = await session.execute(
            select(NodeDefinition.name, NodeDefinition.display_name).where(
                NodeDefinition.name.in_(def_ids)
            )
        )
        for name, display_name in result.all():
            name_map[name] = display_name

    # 深拷贝 DAG，给每个节点加 display_name
    enriched = copy.deepcopy(dag)
    for node in enriched["nodes"]:
        def_id = node.get("definition_id")
        if def_id and def_id in name_map:
            node["display_name"] = name_map[def_id]
    return enriched


async def _enrich_task(task: Any, session: AsyncSession) -> TaskResponse:
    """将 Task ORM 对象转为 TaskResponse，联查 Workflow 填充 workflow_name 和 dag"""
    resp = TaskResponse.model_validate(task)

    if task.matched_workflow_id:
        wf = await session.get(Workflow, task.matched_workflow_id)
        if wf:
            resp.workflow_name = wf.name
            resp.dag = await _enrich_dag_display_names(wf.dag, session)
    elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
        resp.dag = await _enrich_dag_display_names(task.context["dag"], session)
    elif task.execution_mode == "bare_agent":
        # bare_agent 的 DAG 由引擎在 start_task 时构造，此处不填充
        pass

    return resp


async def _enrich_tasks(tasks: list[Any], session: AsyncSession) -> list[TaskResponse]:
    """批量填充 workflow_name 和 dag（含节点 display_name）"""
    # 收集所有 workflow_id 批量查询，避免 N+1
    wf_ids = {t.matched_workflow_id for t in tasks if t.matched_workflow_id}
    wf_map: dict[uuid.UUID, Workflow] = {}
    if wf_ids:
        result = await session.execute(select(Workflow).where(Workflow.id.in_(wf_ids)))
        for wf in result.scalars().all():
            wf_map[wf.id] = wf

    # 收集所有 DAG 中的 definition_id，批量查询 NodeDefinition
    all_def_ids: set[str] = set()
    raw_dags: list[dict] = []
    for task in tasks:
        dag = None
        if task.matched_workflow_id and task.matched_workflow_id in wf_map:
            dag = wf_map[task.matched_workflow_id].dag
        elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
            dag = task.context["dag"]
        if dag and dag.get("nodes"):
            raw_dags.append(dag)
            for n in dag["nodes"]:
                if n.get("definition_id"):
                    all_def_ids.add(n["definition_id"])

    name_map: dict[str, str] = {}
    if all_def_ids:
        result = await session.execute(
            select(NodeDefinition.name, NodeDefinition.display_name).where(
                NodeDefinition.name.in_(all_def_ids)
            )
        )
        for name, display_name in result.all():
            name_map[name] = display_name

    enriched = []
    for task in tasks:
        resp = TaskResponse.model_validate(task)
        if task.matched_workflow_id and task.matched_workflow_id in wf_map:
            wf = wf_map[task.matched_workflow_id]
            resp.workflow_name = wf.name
            if wf.dag:
                enriched_dag = copy.deepcopy(wf.dag)
                for node in enriched_dag.get("nodes", []):
                    def_id = node.get("definition_id")
                    if def_id and def_id in name_map:
                        node["display_name"] = name_map[def_id]
                resp.dag = enriched_dag
        elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
            enriched_dag = copy.deepcopy(task.context["dag"])
            for node in enriched_dag.get("nodes", []):
                def_id = node.get("definition_id")
                if def_id and def_id in name_map:
                    node["display_name"] = name_map[def_id]
            resp.dag = enriched_dag
        enriched.append(resp)
    return enriched


@router.get("")
async def list_tasks(session: AsyncSession = Depends(get_session)):
    items = await task_service.list_tasks(session, TEMP_USER_ID)
    data = await _enrich_tasks(items, session)
    return APIResponse(data=data)


@router.get("/{task_id}")
async def get_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("", status_code=201)
async def create_task(body: TaskCreate, session: AsyncSession = Depends(get_session)):
    task = await task_service.create_task(session, TEMP_USER_ID, body)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/start")
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
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    await task_service.cancel_task(session, task)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/pause")
async def pause_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    await task_service.pause_task(session, task)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/resume")
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
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.get("/{task_id}/steps")
async def get_task_steps(task_id: str, session: AsyncSession = Depends(get_session)):
    steps = await task_service.get_task_steps(session, uuid.UUID(task_id))
    return APIResponse(data=steps)


@router.get("/{task_id}/files")
async def get_task_files(task_id: str):
    """获取任务 workspace 目录下的产物文件列表（直接读磁盘）"""
    try:
        files = task_service.get_task_files(uuid.UUID(task_id))
        return APIResponse(data=files)
    except Exception as e:
        return APIResponse(data=[], message=f"读取文件列表失败: {str(e)}")
