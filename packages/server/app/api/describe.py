"""自然语言创建 API — 用户描述 → LLM 生成 → 确认保存"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.schemas.base import APIResponse
from app.schemas.node import NodeDefResponse
from app.schemas.workflow import DAGDefinition, WorkflowResponse
from app.services import describe_service

router = APIRouter()


# ── Request/Response Schemas ──


class DescribeNodeRequest(BaseModel):
    user_input: str


class DescribeNodeResponse(BaseModel):
    skill_md: str
    suggested: dict


class ConfirmNodeRequest(BaseModel):
    skill_md: str
    overrides: dict | None = None


class DescribeWorkflowRequest(BaseModel):
    user_input: str


class DescribeWorkflowResponse(BaseModel):
    name: str
    display_name: str
    description: str | None
    category: str | None
    dag: DAGDefinition


class ConfirmWorkflowRequest(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None
    dag: DAGDefinition | None = None


# ── Endpoints ──


@router.post("/node", response_model=APIResponse[DescribeNodeResponse])
async def describe_node(
    body: DescribeNodeRequest, session: AsyncSession = Depends(get_session)
):
    """自然语言描述 → 生成 SKILL.md 草稿"""
    result = await describe_service.describe_node(body.user_input)
    if not result:
        raise HTTPException(503, "LLM 服务不可用，无法生成节点定义")
    return APIResponse(data=DescribeNodeResponse(**result))


@router.post("/node/confirm", response_model=APIResponse[NodeDefResponse], status_code=201)
async def confirm_node(
    body: ConfirmNodeRequest, session: AsyncSession = Depends(get_session)
):
    """确认 SKILL.md → 注册为 NodeDefinition"""
    node = await describe_service.confirm_node(
        session, TEMP_USER_ID, body.skill_md, body.overrides
    )
    return APIResponse(data=node)


@router.post("/workflow", response_model=APIResponse[DescribeWorkflowResponse])
async def describe_workflow(
    body: DescribeWorkflowRequest, session: AsyncSession = Depends(get_session)
):
    """自然语言描述 → 生成 DAG 工作流草稿"""
    result = await describe_service.describe_workflow(body.user_input, session)
    if not result:
        raise HTTPException(503, "无法生成工作流（LLM 不可用或无已发布节点）")
    return APIResponse(data=DescribeWorkflowResponse(**result))


@router.post("/workflow/confirm", response_model=APIResponse[WorkflowResponse], status_code=201)
async def confirm_workflow(
    body: ConfirmWorkflowRequest, session: AsyncSession = Depends(get_session)
):
    """确认 DAG → 保存为 Workflow"""
    wf = await describe_service.confirm_workflow(
        session,
        TEMP_USER_ID,
        name=body.name,
        description=body.description,
        category=body.category,
        dag=body.dag,
    )
    return APIResponse(data=wf)
