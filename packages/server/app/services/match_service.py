"""匹配服务 — 四档降级 + Team 范围匹配

匹配流程：
┌─ 用户选了 team_id ────────────────────────────┐
│   第一档：Team 范围内 LLM 匹配 Workflow          │
│   第二档：Team 范围内 LLM 动态组装 DAG           │
│   第三档：bare-agent（注入 team_prompt）          │
│                                                 │
└─ 用户未选 team_id ─────────────────────────────┤
    第零档：LLM 智能匹配最合适的 Team               │
      ├─ 命中 → 进入上面 Team scope 流程           │
      └─ 未命中 → 全局匹配（兼容旧逻辑）             │
         第一档：全局 LLM 匹配 Workflow              │
         第二档：全局 LLM 动态组装 DAG               │
         第三档：bare-agent                          │
"""

import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Team
from app.models.workflow import Workflow
from app.schemas.match import MatchResult
from app.schemas.workflow import DAGDefinition

logger = logging.getLogger(__name__)


async def match(
    user_input: str,
    session: AsyncSession,
    user_id: uuid.UUID,
    team_id: uuid.UUID | None = None,
) -> MatchResult:
    """四档降级匹配入口

    Args:
        user_input: 用户自然语言输入
        session: DB session
        user_id: 用户 ID
        team_id: 可选，指定 Team ID 进行范围匹配
    """
    logger.info(f"[Match] 开始匹配: user_input={user_input!r}, team_id={team_id}")

    available_names: list[str] | None = None
    matched_team: Team | None = None

    # ── 第零档：用户未指定 team_id 时，LLM 智能匹配 Team ──
    if team_id is None:
        try:
            matched_team = await _match_team(user_input, session)
            if matched_team:
                team_id = matched_team.id
                logger.info(
                    f"[Match] 第零档命中 Team: name={matched_team.name}, "
                    f"display={matched_team.display_name}"
                )
            else:
                logger.info("[Match] 第零档未命中 Team，降级为全局匹配")
        except Exception as e:
            logger.warning(f"[Match] 第零档异常: {e}")

    # ── 用户指定了 team_id 但第零档未执行（matched_team 为 None），补全 Team 对象 ──
    if team_id and not matched_team:
        from app.services.team_service import get_team
        matched_team = await get_team(session, team_id)
        if not matched_team:
            logger.warning(f"[Match] 用户指定的 Team 不存在: {team_id}")
            team_id = None  # 降级为全局匹配
        elif not matched_team.workflow_ids and not matched_team.node_definition_ids:
            logger.info(f"[Match] 用户指定的 Team「{matched_team.name}」没有任何工作流和节点，降级为全局匹配")
            matched_team = None
            team_id = None

    # ── 有 Team scope：在 Team 范围内匹配 ──
    if team_id and matched_team:
        # 第一档：Team 范围内匹配 Workflow
        try:
            result = await _match_existing_scoped(user_input, session, user_id, team_id)
            if result:
                result.team_id = team_id
                result.team_name = matched_team.name
                logger.info(
                    f"[Match] Team scope 第一档命中: mode={result.mode}, "
                    f"team={matched_team.name}, name={result.workflow_name}, "
                    f"confidence={result.confidence}"
                )
                return result
            logger.info(f"[Match] Team scope 第一档未命中 (team={matched_team.name})")
            available_names = await _get_scoped_workflow_names(session, user_id, team_id)
        except Exception as e:
            logger.error(f"[Match] Team scope 第一档异常: {e}", exc_info=True)

        # 第二档：Team 范围内动态组装
        try:
            from app.services.assembly_service import assemble_scoped
            result = await assemble_scoped(user_input, session, team_id)
            if result:
                result.team_id = team_id
                result.team_name = matched_team.name
                logger.info(
                    f"[Match] Team scope 第二档命中: team={matched_team.name}, "
                    f"confidence={result.confidence}"
                )
                return result
            logger.info(f"[Match] Team scope 第二档未命中 (team={matched_team.name})")
        except Exception as e:
            logger.error(f"[Match] Team scope 第二档异常: {e}", exc_info=True)

        # 第三档：Team 下的 bare-agent（注入 team_prompt）
        logger.info(f"[Match] Team scope 降级为 bare-agent (team={matched_team.name})")
        return MatchResult(
            mode="bare_agent",
            team_id=team_id,
            team_name=matched_team.name,
            reasoning=f"在 Team「{matched_team.display_name}」范围内未匹配到合适的工作流，使用裸 Agent 模式",
            available_workflow_names=available_names,
        )

    # ── 无 Team scope：全局匹配（兼容旧逻辑）──
    # 第一档：全局 LLM 匹配已有工作流
    try:
        result = await _match_existing(user_input, session, user_id)
        if result:
            logger.info(
                f"[Match] 全局第一档命中: mode={result.mode}, "
                f"name={result.workflow_name}, confidence={result.confidence}"
            )
            return result
        logger.info("[Match] 全局第一档未命中")
        available_names = await _get_published_workflow_names(session, user_id)
    except Exception as e:
        logger.error(f"[Match] 全局第一档异常: {e}", exc_info=True)

    # 第二档：全局 LLM 动态组装 DAG
    try:
        from app.services.assembly_service import assemble
        result = await assemble(user_input, session)
        if result:
            logger.info(f"[Match] 全局第二档命中: confidence={result.confidence}")
            return result
        logger.info("[Match] 全局第二档未命中")
    except Exception as e:
        logger.error(f"[Match] 全局第二档异常: {e}", exc_info=True)

    # 第三档：降级为裸 Agent
    logger.info("[Match] 全局降级为裸 Agent")
    return MatchResult(
        mode="bare_agent",
        reasoning="未匹配到已有工作流或合适的 Team，将使用裸 Agent 模式执行",
        available_workflow_names=available_names,
    )


# ── 第零档：Team 匹配 ──

async def _match_team(user_input: str, session: AsyncSession) -> Team | None:
    """LLM 智能匹配最合适的 Team

    根据用户意图语义匹配到最合适的 Team。
    无活跃 Team 或 LLM 不可用时返回 None。
    """
    from app.services.team_service import get_active_team_summaries

    teams = await get_active_team_summaries(session)
    if not teams:
        logger.info("[Match:Team] 没有活跃的 Team，跳过 Team 匹配")
        return None

    # 检查 LLM 是否可用
    from app.config.settings import settings
    if not settings.is_llm_configured:
        logger.warning("[Match:Team] LLM 未配置，跳过 Team 匹配")
        return None

    from app.core.llm.client import achat

    team_list = [
        {"id": t.id, "name": t.name, "display_name": t.display_name, "description": t.description}
        for t in teams
    ]

    prompt = f"""你是一个 Team 匹配助手。根据用户的自然语言输入，从可用 Team 中找到最匹配的一个。

用户输入：{user_input}

可用 Team：
{json.dumps(team_list, ensure_ascii=False, indent=2)}

请判断用户意图最适合哪个 Team。返回 JSON 格式：
- 如果有匹配（confidence >= 0.5）：
  {{"matched": true, "team_id": "匹配的Team ID", "confidence": 0.8, "reasoning": "匹配原因"}}
- 如果没有匹配：
  {{"matched": false, "reasoning": "无匹配原因"}}

匹配时考虑：
- 用户意图的领域归属（文档/开发/设计/数据分析等）
- Team 描述的语义相关性
- 如果用户意图明确属于某个领域，confidence 应该较高

只返回 JSON，不要其他内容。"""

    try:
        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=200,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[Match:Team] LLM 返回空内容")
            return None

        # 提取 JSON
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        parsed = json.loads(content)

        if parsed.get("matched") and parsed.get("confidence", 0) >= 0.5:
            team_id_str = parsed["team_id"]
            try:
                tid = uuid.UUID(team_id_str)
            except ValueError:
                logger.warning(f"[Match:Team] LLM 返回了无效的 team_id: {team_id_str}")
                return None

            # 验证 Team 存在
            from sqlalchemy import select as sa_select
            stmt = sa_select(Team).where(Team.id == tid, Team.status == "active")
            result = await session.execute(stmt)
            team = result.scalar_one_or_none()
            if team:
                logger.info(
                    f"[Match:Team] 匹配到 Team: {team.name}, "
                    f"confidence={parsed['confidence']}, "
                    f"reasoning={parsed.get('reasoning', '')}"
                )
                return team
            logger.warning(f"[Match:Team] Team 不存在或已归档: {team_id_str}")

        logger.info(
            f"[Match:Team] 无匹配: matched={parsed.get('matched')}, "
            f"confidence={parsed.get('confidence')}"
        )
        return None

    except Exception as e:
        logger.warning(f"[Match:Team] LLM 匹配异常: {e}")
        return None


# ── 第一档：Workflow 匹配（全局 / Team scope） ──

async def _match_existing(
    user_input: str, session: AsyncSession, user_id: uuid.UUID
) -> MatchResult | None:
    """全局第一档：LLM 语义匹配已有工作流"""
    stmt = (
        select(Workflow)
        .where(Workflow.user_id == user_id, Workflow.status == "published")
        .order_by(Workflow.updated_at.desc())
    )
    result = await session.execute(stmt)
    workflows = list(result.scalars().all())

    if not workflows:
        logger.info("[Match] 没有已发布的工作流，跳过全局第一档")
        return None

    from app.config.settings import settings
    if not settings.is_llm_configured:
        logger.warning("[Match] LLM 未配置，跳过全局第一档")
        return None

    return await _llm_match(user_input, workflows)


async def _match_existing_scoped(
    user_input: str, session: AsyncSession, user_id: uuid.UUID, team_id: uuid.UUID
) -> MatchResult | None:
    """Team scope 第一档：在 Team 范围内 LLM 匹配 Workflow"""
    from app.services.team_service import get_team, get_team_workflows

    team = await get_team(session, team_id)
    if not team:
        logger.warning(f"[Match] Team 不存在: {team_id}")
        return None

    workflows = await get_team_workflows(session, team)
    if not workflows:
        logger.info(f"[Match] Team「{team.name}」没有关联的工作流，跳过第一档")
        return None

    from app.config.settings import settings
    if not settings.is_llm_configured:
        logger.warning("[Match] LLM 未配置，跳过 Team scope 第一档")
        return None

    logger.info(
        f"[Match] Team「{team.name}」有 {len(workflows)} 个工作流: "
        f"{[w.name for w in workflows]}"
    )
    return await _llm_match(user_input, workflows)


async def _llm_match(user_input: str, workflows: list[Workflow]) -> MatchResult | None:
    """LLM 语义匹配工作流"""
    from app.core.llm.client import achat
    from app.config.settings import settings

    workflow_list = []
    for wf in workflows:
        node_count = len(wf.dag.get("nodes", [])) if wf.dag else 0
        workflow_list.append({
            "id": str(wf.id),
            "name": wf.name,
            "description": wf.description or "",
            "category": wf.category or "",
            "node_count": node_count,
        })

    prompt = f"""你是一个工作流匹配助手。根据用户的自然语言输入，从已有工作流中找到最匹配的一个。

用户输入：{user_input}

已有工作流：
{json.dumps(workflow_list, ensure_ascii=False, indent=2)}

请判断是否有匹配的工作流。返回 JSON 格式：
- 如果有匹配（confidence >= 0.6）：
  {{"matched": true, "workflow_id": "匹配的工作流ID", "confidence": 0.8, "reasoning": "匹配原因"}}
- 如果没有匹配：
  {{"matched": false, "reasoning": "无匹配原因"}}

只返回 JSON，不要其他内容。"""

    try:
        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=300,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[Match] LLM 返回空内容，无法完成匹配")
            return None

        logger.info(f"[Match] LLM 返回: {content[:200]}")

        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        parsed = json.loads(content)

        if parsed.get("matched") and parsed.get("confidence", 0) >= 0.6:
            wf_id = parsed["workflow_id"]
            for wf in workflows:
                if str(wf.id) == wf_id:
                    dag = DAGDefinition(**wf.dag) if wf.dag else None
                    return MatchResult(
                        mode="matched",
                        workflow_id=wf.id,
                        workflow_name=wf.name,
                        confidence=parsed["confidence"],
                        reasoning=parsed.get("reasoning", ""),
                        dag=dag,
                    )
            logger.warning(f"[Match] LLM 返回了不存在的 workflow_id: {wf_id}")
        else:
            logger.info(
                f"[Match] LLM 判断无匹配或置信度不足: "
                f"matched={parsed.get('matched')}, confidence={parsed.get('confidence')}, "
                f"reason={parsed.get('reasoning', '')}"
            )

        return None

    except Exception as e:
        logger.warning(f"[Match] LLM 匹配异常: {e}")
        return None


# ── 辅助 ──

async def _get_published_workflow_names(
    session: AsyncSession, user_id: uuid.UUID
) -> list[str] | None:
    """获取用户已发布的工作流名称列表（全局）"""
    try:
        stmt = (
            select(Workflow.name)
            .where(Workflow.user_id == user_id, Workflow.status == "published")
            .order_by(Workflow.updated_at.desc())
        )
        result = await session.execute(stmt)
        names = list(result.scalars().all())
        return names if names else None
    except Exception:
        return None


async def _get_scoped_workflow_names(
    session: AsyncSession, user_id: uuid.UUID, team_id: uuid.UUID
) -> list[str] | None:
    """获取 Team 范围内已发布的工作流名称列表"""
    try:
        from app.services.team_service import get_team_workflows, get_team
        team = await get_team(session, team_id)
        if not team:
            return None
        workflows = await get_team_workflows(session, team)
        names = [w.name for w in workflows if w.status == "published"]
        return names if names else None
    except Exception:
        return None
