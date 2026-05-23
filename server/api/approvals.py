"""Approval 审批 API"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.services.approval import (
    create_approval, resolve_approval, list_pending_approvals, get_approval,
)

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


class ResolveApprovalRequest(BaseModel):
    approved: bool = True
    result_data: dict = {}


@router.get("")
async def api_list_approvals(task_id: str = ""):
    """列出待审批"""
    approvals = await list_pending_approvals(task_id or None)
    return [a.model_dump() for a in approvals]


@router.get("/{approval_id}")
async def api_get_approval(approval_id: str):
    """获取审批详情"""
    try:
        return (await get_approval(approval_id)).model_dump()
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{approval_id}/resolve")
async def api_resolve_approval(approval_id: str, req: ResolveApprovalRequest):
    """处理审批"""
    try:
        approval = await resolve_approval(approval_id, req.approved, req.result_data)
        return approval.model_dump()
    except ValueError as e:
        raise HTTPException(400, str(e))
