"""Team API — REST 路由

路由：
- GET    /api/teams          — 列出所有 Team
- POST   /api/teams          — 创建 Team
- GET    /api/teams/{id}     — 获取 Team 详情
- PATCH  /api/teams/{id}     — 更新 Team
- DELETE /api/teams/{id}     — 删除 Team
- GET    /api/teams/{id}/workflows  — 获取 Team 的工作流列表
- GET    /api/teams/{id}/nodes      — 获取 Team 的节点列表
- POST   /api/teams/{id}/validate   — 验证资源引用
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models.team import Team
from app.models.workflow import Workflow
from app.models.node import NodeDefinition
from app.schemas.base import APIResponse
from app.schemas.team import TeamCreate, TeamUpdate, TeamResponse
from app.services import team_service

router = APIRouter()
logger = logging.getLogger(__name__)


def _team_to_response(team: Team) -> dict:
    """将 ORM Team 转为可序列化的 dict"""
    return {
        "id": str(team.id),
        "name": team.name,
        "display_name": team.display_name,
        "description": team.description,
        "icon": team.icon,
        "team_prompt": team.team_prompt,
        "default_adapter_type": team.default_adapter_type,
        "workflow_ids": team.workflow_ids or [],
        "node_definition_ids": team.node_definition_ids or [],
        "status": team.status,
        "created_at": team.created_at.isoformat() if team.created_at else None,
        "updated_at": team.updated_at.isoformat() if team.updated_at else None,
    }


def _workflow_to_dict(wf: Workflow) -> dict:
    """将 ORM Workflow 转为可序列化的 dict"""
    return {
        "id": str(wf.id),
        "name": wf.name,
        "description": wf.description,
        "category": wf.category,
        "status": wf.status,
        "version": wf.version,
        "created_at": wf.created_at.isoformat() if wf.created_at else None,
        "updated_at": wf.updated_at.isoformat() if wf.updated_at else None,
    }


def _node_to_dict(node: NodeDefinition) -> dict:
    """将 ORM NodeDefinition 转为可序列化的 dict"""
    return {
        "id": str(node.id),
        "name": node.name,
        "display_name": node.display_name,
        "description": node.description,
        "category": node.category,
        "adapter_type": node.adapter_type,
        "version": node.version,
        "status": node.status,
        "created_at": node.created_at.isoformat() if node.created_at else None,
        "updated_at": node.updated_at.isoformat() if node.updated_at else None,
    }


@router.get("")
async def list_teams(
    status: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """列出所有 Team"""
    teams = await team_service.list_teams(session, status=status)
    return APIResponse(data=[_team_to_response(t) for t in teams])


@router.post("")
async def create_team(
    body: TeamCreate,
    session: AsyncSession = Depends(get_session),
):
    """创建 Team"""
    existing = await team_service.get_team_by_name(session, body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Team name '{body.name}' already exists")
    team = await team_service.create_team(session, body)
    return APIResponse(data=_team_to_response(team))


@router.get("/{team_id}")
async def get_team(
    team_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """获取 Team 详情"""
    team = await team_service.get_team(session, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return APIResponse(data=_team_to_response(team))


@router.patch("/{team_id}")
async def update_team(
    team_id: uuid.UUID,
    body: TeamUpdate,
    session: AsyncSession = Depends(get_session),
):
    """更新 Team"""
    team = await team_service.get_team(session, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    team = await team_service.update_team(session, team, body)
    return APIResponse(data=_team_to_response(team))


@router.delete("/{team_id}")
async def delete_team(
    team_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """删除 Team"""
    team = await team_service.get_team(session, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    await team_service.delete_team(session, team)
    return APIResponse(message=f"Team '{team.name}' deleted")


@router.get("/{team_id}/workflows")
async def get_team_workflows(
    team_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """获取 Team 关联的所有工作流"""
    team = await team_service.get_team(session, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    workflows = await team_service.get_team_workflows(session, team)
    return APIResponse(data=[_workflow_to_dict(w) for w in workflows])


@router.get("/{team_id}/nodes")
async def get_team_nodes(
    team_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """获取 Team 关联的所有节点"""
    team = await team_service.get_team(session, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    nodes = await team_service.get_team_nodes(session, team)
    return APIResponse(data=[_node_to_dict(n) for n in nodes])


@router.post("/{team_id}/validate")
async def validate_team_resources(
    team_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """验证 Team 中的 workflow/node 引用有效性"""
    team = await team_service.get_team(session, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    result = await team_service.validate_team_resources(session, team)
    return APIResponse(data=result)
