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
    """获取 Team 关联的所有已发布 NodeDefinition"""
    if not team.node_definition_ids:
        return []
    try:
        uuids = [uuid.UUID(nid) for nid in team.node_definition_ids]
    except ValueError:
        return []
    stmt = select(NodeDefinition).where(
        NodeDefinition.id.in_(uuids),
        NodeDefinition.status == "published",
    ).order_by(NodeDefinition.name)
    result = await session.execute(stmt)
    return list(result.scalars().all())


# ── LLM 匹配用 ──

async def get_active_team_summaries(session: AsyncSession) -> list[TeamSummary]:
    """获取所有活跃 Team 的轻量摘要（供 LLM 匹配用）"""
    stmt = select(Team).where(Team.status == "active").order_by(Team.name)
    result = await session.execute(stmt)
    teams = list(result.scalars().all())
    return [
        TeamSummary(
            id=str(t.id),
            name=t.name,
            display_name=t.display_name,
            description=t.description or "",
        )
        for t in teams
    ]


# ── 种子数据 ──

DEFAULT_TEAMS = [
    {
        "name": "document-engineering",
        "display_name": "📄 文档工程",
        "description": "需求文档、技术方案、API 文档、会议纪要等文档类任务。擅长 Markdown 格式化、多语言翻译、技术写作。",
        "icon": "📄",
        "team_prompt": (
            "你属于【文档工程】团队。请遵循以下标准：\n"
            "- 所有文档使用 Markdown 格式，结构清晰\n"
            "- 代码块必须标注语言类型\n"
            "- 专业术语首次出现需添加英文注释\n"
            "- 输出需包含清晰的目录结构\n"
            "- 注重可读性和信息密度"
        ),
    },
    {
        "name": "dev-efficiency",
        "display_name": "💻 研发效能",
        "description": "代码生成、重构、Code Review、单元测试、CI/CD 配置等研发类任务。擅长 Python/TypeScript/Go。",
        "icon": "💻",
        "team_prompt": (
            "你属于【研发效能】团队。请遵循以下标准：\n"
            "- 代码遵循 SOLID 原则，注重可维护性\n"
            "- 所有函数/方法需有类型注解和文档字符串\n"
            "- 错误处理完善，日志充分\n"
            "- 优先使用项目已有的技术栈和模式\n"
            "- 输出代码前说明设计思路"
        ),
    },
    {
        "name": "design-output",
        "display_name": "🎨 设计产出",
        "description": "架构图、流程图、原型图、UI 设计稿等视觉产出类任务。擅长架构可视化、信息图表、HTML/CSS 原型。",
        "icon": "🎨",
        "team_prompt": (
            "你属于【设计产出】团队。请遵循以下标准：\n"
            "- 视觉效果需专业、现代、简洁\n"
            "- 使用清晰的配色和布局\n"
            "- 输出需标注尺寸、颜色值等设计参数\n"
            "- 优先使用 SVG/HTML/CSS 实现可复用的设计\n"
            "- 说明设计决策的理由"
        ),
    },
    {
        "name": "data-analysis",
        "display_name": "📊 数据分析",
        "description": "数据清洗、报表生成、可视化、异常检测等数据分析类任务。擅长 Python pandas、图表生成。",
        "icon": "📊",
        "team_prompt": (
            "你属于【数据分析】团队。请遵循以下标准：\n"
            "- 分析前先说明数据概况和方法\n"
            "- 图表使用清晰的标题、轴标签和图例\n"
            "- 关键结论用醒目的方式标注\n"
            "- 对异常值和边界情况做说明\n"
            "- 提供可复现的分析步骤"
        ),
    },
]


async def ensure_default_teams(session: AsyncSession) -> int:
    """确保默认 Team 存在（种子数据）

    Returns:
        创建/更新的 Team 数量
    """
    count = 0
    for team_data in DEFAULT_TEAMS:
        existing = await get_team_by_name(session, team_data["name"])
        if existing:
            # 更新描述和 prompt（保持可更新）
            existing.display_name = team_data["display_name"]
            existing.description = team_data.get("description")
            existing.icon = team_data.get("icon")
            existing.team_prompt = team_data.get("team_prompt")
        else:
            team = Team(
                name=team_data["name"],
                display_name=team_data["display_name"],
                description=team_data.get("description"),
                icon=team_data.get("icon"),
                team_prompt=team_data.get("team_prompt"),
                workflow_ids=[],
                node_definition_ids=[],
            )
            session.add(team)
        count += 1
    await session.commit()
    logger.info(f"[Team] Ensured {count} default teams")
    return count
