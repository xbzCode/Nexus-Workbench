"""工作流 CRUD API"""

from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from server.models.schemas import Workflow, DAGDefinition
from server.services.store import store

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


class CreateWorkflowRequest(BaseModel):
    name: str = ""
    description: str = ""
    category: str = "custom"


class UpdateWorkflowRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    dag: Optional[dict] = None


@router.get("")
async def list_workflows():
    return list(store.workflows.values())


@router.post("")
async def create_workflow(req: CreateWorkflowRequest):
    wf = Workflow(
        name=req.name,
        description=req.description,
        category=req.category,
    )
    store.workflows[wf.id] = wf
    store.save()
    return wf


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str):
    wf = store.workflows.get(workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


@router.put("/{workflow_id}")
async def update_workflow(workflow_id: str, req: UpdateWorkflowRequest):
    wf = store.workflows.get(workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")

    if req.name is not None:
        wf.name = req.name
    if req.description is not None:
        wf.description = req.description
    if req.category is not None:
        wf.category = req.category
    if req.status is not None:
        wf.status = req.status
    if req.dag is not None:
        wf.dag = DAGDefinition(**req.dag)

    from server.models.schemas import now_iso
    wf.updated_at = now_iso()
    store.save()
    return wf


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    if workflow_id not in store.workflows:
        raise HTTPException(404, "Workflow not found")
    del store.workflows[workflow_id]
    store.save()
    return {"deleted": True}
