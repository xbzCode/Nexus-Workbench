"""工作流 CRUD API"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.core.dag.validate import DAGValidationError
from app.schemas.base import APIResponse
from app.schemas.workflow import WorkflowCreate, WorkflowResponse, WorkflowUpdate
from app.services import workflow_service

router = APIRouter()


@router.get("", response_model=APIResponse[list[WorkflowResponse]])
async def list_workflows(session: AsyncSession = Depends(get_session)):
    items = await workflow_service.list_workflows(session, TEMP_USER_ID)
    return APIResponse(data=items)


@router.get("/{workflow_id}", response_model=APIResponse[WorkflowResponse])
async def get_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    wf = await workflow_service.get_workflow(session, UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return APIResponse(data=wf)


@router.post("", response_model=APIResponse[WorkflowResponse], status_code=201)
async def create_workflow(body: WorkflowCreate, session: AsyncSession = Depends(get_session)):
    try:
        wf = await workflow_service.create_workflow(session, TEMP_USER_ID, body)
    except DAGValidationError as e:
        raise HTTPException(status_code=400, detail=e.errors)
    return APIResponse(data=wf)


@router.put("/{workflow_id}", response_model=APIResponse[WorkflowResponse])
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
    return APIResponse(data=updated)


@router.delete("/{workflow_id}", response_model=APIResponse[None])
async def delete_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    from uuid import UUID
    wf = await workflow_service.get_workflow(session, UUID(workflow_id))
    if not wf:
        raise HTTPException(404, "Workflow not found")
    await workflow_service.delete_workflow(session, wf)
    return APIResponse(message="Deleted")
