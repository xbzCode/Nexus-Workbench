"""工作流 CRUD API"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.core.dag.validate import DAGValidationError
from app.models.node import NodeDefinition
from app.schemas.base import APIResponse
from app.schemas.workflow import WorkflowCreate, WorkflowResponse, WorkflowUpdate
from app.services import workflow_service

router = APIRouter()


async def _enrich_workflow_dag(wf_response: WorkflowResponse, session: AsyncSession) -> None:
    """为工作流响应的 DAG 节点填充 display_name"""
    dag = wf_response.dag
    if not dag or not dag.get("nodes"):
        return

    def_ids = {n["definition_id"] for n in dag["nodes"] if n.get("definition_id")}
    if not def_ids:
        return

    name_map: dict[str, str] = {}
    result = await session.execute(
        select(NodeDefinition.name, NodeDefinition.display_name).where(
            NodeDefinition.name.in_(def_ids)
        )
    )
    for name, display_name in result.all():
        name_map[name] = display_name

    for node in dag["nodes"]:
        def_id = node.get("definition_id")
        if def_id and def_id in name_map:
            node["display_name"] = name_map[def_id]


@router.get("")
async def list_workflows(session: AsyncSession = Depends(get_session)):
    items = await workflow_service.list_workflows(session, TEMP_USER_ID)
    for item in items:
        await _enrich_workflow_dag(item, session)
    return APIResponse(data=items)


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    wf = await workflow_service.get_workflow(session, UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    await _enrich_workflow_dag(wf, session)
    return APIResponse(data=wf)


@router.post("", status_code=201)
async def create_workflow(body: WorkflowCreate, session: AsyncSession = Depends(get_session)):
    try:
        wf = await workflow_service.create_workflow(session, TEMP_USER_ID, body)
    except DAGValidationError as e:
        raise HTTPException(status_code=400, detail=e.errors)
    await _enrich_workflow_dag(wf, session)
    return APIResponse(data=wf)


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str, body: WorkflowUpdate, session: AsyncSession = Depends(get_session)
):
    from uuid import UUID
    wf = await workflow_service.get_workflow(session, UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    try:
        updated = await workflow_service.update_workflow(session, wf, body)
    except DAGValidationError as e:
        raise HTTPException(status_code=400, detail=e.errors)
    await _enrich_workflow_dag(updated, session)
    return APIResponse(data=updated)


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    wf = await workflow_service.get_workflow(session, UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    await workflow_service.delete_workflow(session, wf)
    return APIResponse(message="Deleted")
