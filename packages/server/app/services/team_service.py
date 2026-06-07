"""Team CRUD 服务 + 引用清理

职责：
- Team 的 CRUD 操作
- 删除 Team 时自动清理 Workflow/NodeDefinition 中对已删除资源的引用
- Team 匹配（供 match_service 调用）
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Team
from app.models.workflow import Workflow
from app.models.node import NodeDefinition
from app.schemas.team import TeamCreate, TeamUpdate, TeamSummary

logger = logging.getLogger(__name__)


# ── CRUD ──

async def list_teams(session: AsyncSession, status: str | None = None) -> list[Team]:
    """列出所有 Team"""
    stmt = select(Team).order_by(Team.name)
    if status:
        stmt = stmt.where(Team.status == status)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_team(session: AsyncSession, team_id: uuid.UUID) -> Team | None:
    return await session.get(Team, team_id)


async def get_team_by_name(session: AsyncSession, name: str) -> Team | None:
    stmt = select(Team).where(Team.name == name)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_team(session: AsyncSession, data: TeamCreate) -> Team:
    team = Team(
        name=data.name,
        display_name=data.display_name,
        description=data.description,
        icon=data.icon,
        team_prompt=data.team_prompt,
        default_adapter_type=data.default_adapter_type,
        workflow_ids=data.workflow_ids,
        node_definition_ids=data.node_definition_ids,
    )
    session.add(team)
    await session.commit()
    await session.refresh(team)
    logger.info(f"[Team] Created team: {team.name}")
    return team


async def update_team(session: AsyncSession, team: Team, data: TeamUpdate) -> Team:
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(team, key, value)
    await session.commit()
    await session.refresh(team)
    logger.info(f"[Team] Updated team: {team.name}")
    return team


async def delete_team(session: AsyncSession, team: Team) -> None:
    """删除 Team，同时清理所有关联资源中的引用"""
    team_name = team.name

    # 清理所有 Workflow 中对此 Team 的引用
    if team.workflow_ids:
        stmt = select(Workflow).where(Workflow.id.in_(
            [uuid.UUID(wid) for wid in team.workflow_ids]
        ))
        result = await session.execute(stmt)
        for wf in result.scalars().all():
            # Workflow 没有 team_id 字段，不需要清理
            pass

    # 清理所有 NodeDefinition 中对此 Team 的引用
    if team.node_definition_ids:
        stmt = select(NodeDefinition).where(NodeDefinition.id.in_(
            [uuid.UUID(nid) for nid in team.node_definition_ids]
        ))
        result = await session.execute(stmt)
        for node in result.scalars().all():
            pass

    await session.delete(team)
    await session.commit()
    logger.info(f"[Team] Deleted team: {team_name}")


# ── 引用验证 ──

async def validate_team_resources(
    session: AsyncSession,
    team: Team,
) -> dict:
    """验证 Team 中的 workflow_ids / node_definition_ids 引用有效性

    Returns:
        {"valid": True} 或 {"valid": False, "invalid_workflow_ids": [...], "invalid_node_ids": [...]}
    """
    invalid_workflows = []
    invalid_nodes = []

    for wid_str in team.workflow_ids:
        try:
            wid = uuid.UUID(wid_str)
            exists = await session.get(Workflow, wid)
            if not exists:
                invalid_workflows.append(wid_str)
        except ValueError:
            invalid_workflows.append(wid_str)

    for nid_str in team.node_definition_ids:
        try:
            nid = uuid.UUID(nid_str)
            exists = await session.get(NodeDefinition, nid)
            if not exists:
                invalid_nodes.append(nid_str)
        except ValueError:
            invalid_nodes.append(nid_str)

    if invalid_workflows or invalid_nodes:
        return {
            "valid": False,
            "invalid_workflow_ids": invalid_workflows,
            "invalid_node_ids": invalid_nodes,
        }
    return {"valid": True}


# ── 资源查询 ──

async def get_team_workflows(session: AsyncSession, team: Team) -> list[Workflow]:
    """获取 Team 关联的所有 Workflow（已发布 + 未归档）"""
    if not team.workflow_ids:
        return []
    try:
        uuids = [uuid.UUID(wid) for wid in team.workflow_ids]
    except ValueError:
        return []
    stmt = select(Workflow).where(
        Workflow.id.in_(uuids),
        Workflow.status != "archived",
    ).order_by(Workflow.updated_at.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_team_nodes(session: AsyncSession, team: Team) -> list[NodeDefinition]:
    """获取 Team 关联的所有 NodeDefinition（draft + published，排除 deprecated）"""
    if not team.node_definition_ids:
        return []
    try:
        uuids = [uuid.UUID(nid) for nid in team.node_definition_ids]
    except ValueError:
        return []
    stmt = select(NodeDefinition).where(
        NodeDefinition.id.in_(uuids),
        NodeDefinition.status.in_(["draft", "published"]),
    ).order_by(NodeDefinition.name)
    result = await session.execute(stmt)
    return list(result.scalars().all())


# ── LLM 匹配用 ──

async def get_active_team_summaries(session: AsyncSession) -> list[TeamSummary]:
    """获取所有活跃 Team 的轻量摘要（供 LLM 匹配用）

    过滤掉没有任何工作流和节点的空 Team，避免匹配到无资源的 Team。
    """
    stmt = select(Team).where(Team.status == "active").order_by(Team.name)
    result = await session.execute(stmt)
    teams = list(result.scalars().all())
    # 过滤掉没有工作流也没有节点的空 Team
    eligible = [t for t in teams if t.workflow_ids or t.node_definition_ids]
    return [
        TeamSummary(
            id=str(t.id),
            name=t.name,
            display_name=t.display_name,
            description=t.description or "",
        )
        for t in eligible
    ]
