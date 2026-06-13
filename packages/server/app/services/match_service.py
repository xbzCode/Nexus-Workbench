"""匹配服务 — 统一匹配 + 降级组装

匹配流程：

┌─ 用户选了 team_id ──────────────────────────────────────┐
│   第一档：该 Team 的 Workflow + 该 Team 的节点              │  ← 1次 LLM
│   第二档：全局节点动态组装 DAG                               │  ← 1次 LLM
│   第三档：bare-agent（注入 team_prompt）                     │
│                                                           │
└─ 用户未选 team_id ───────────────────────────────────────┤
    第一档：所有 Team 的 Workflow(去重) + 所有 Team 的节点(去重) │  ← 1次 LLM
    第二档：全局节点动态组装 DAG                                  │  ← 1次 LLM
    第三档：bare-agent                                           │

匹配规则要点：
- 候选池仅包含 team 直接关联的 workflow 和节点，不涉及 workflow DAG 中的组成节点
- 多 team 关联的 workflow/节点需去重
- 第二档动态组装始终从全局节点池挑选
"""

import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Team
from app.models.workflow import Workflow
from app.models.node import NodeDefinition
from app.schemas.match import MatchResult
from app.schemas.workflow import DAGDefinition, EdgeDef, NodeInstance

logger = logging.getLogger(__name__)

from app.config.logging import tlog, task_summary, PHASE_MATCH


async def match(
    user_input: str,
    session: AsyncSession,
    user_id: uuid.UUID,
    team_id: uuid.UUID | None = None,
) -> MatchResult:
    """统一匹配入口

    Args:
        user_input: 用户自然语言输入
        session: DB session
        user_id: 用户 ID
        team_id: 可选，指定 Team ID 进行范围匹配
    """
    logger.info(f"[Match] 开始匹配: user_input={user_input!r}, team_id={team_id}")
    tlog().info("═══ MATCH ═══ user_input=%s | team_id=%s", user_input[:100], team_id or "auto")

    from app.config.settings import settings
    if not settings.is_llm_configured:
        logger.warning("[Match] LLM 未配置，降级为 bare-agent")
        return MatchResult(mode="bare_agent", reasoning="LLM 未配置")

    # ── 构建候选项 ──
    if team_id:
        # 用户指定了 Team：只在该 Team 范围内匹配
        result = await _match_scoped(user_input, session, team_id)
        if result:
            return result

        # 第一档未命中 → 第二档：全局节点动态组装
        try:
            from app.services.assembly_service import assemble
            result = await assemble(user_input, session)
            if result:
                result.team_id = team_id
                team = await session.get(Team, team_id)
                if team:
                    result.team_name = team.name
                logger.info(f"[Match] 第二档命中: confidence={result.confidence}")
                tlog().info("MATCH | 第二档命中 | confidence=%.2f", result.confidence)
                return result
            logger.info("[Match] 第二档未命中")
        except Exception as e:
            logger.error(f"[Match] 第二档异常: {e}", exc_info=True)

        # Team scope 第三档：bare-agent（注入 team_prompt）
        team = await session.get(Team, team_id)
        team_name = team.name if team else None
        available_names = await _get_available_names(session, user_id, team_id)
        logger.info(f"[Match] Team scope 降级为 bare-agent (team={team_name})")
        return MatchResult(
            mode="bare_agent",
            team_id=team_id,
            team_name=team_name,
            reasoning=f"在 Team 范围内未匹配到合适的工作流或节点，使用裸 Agent 模式",
            available_workflow_names=available_names,
        )
    else:
        # 未指定 Team：全局匹配，Team 作为分组维度
        result = await _match_global(user_input, session, user_id)
        if result:
            return result

        # 全局第一档未命中 → 第二档：全局动态组装
        available_names = await _get_available_names(session, user_id, None)
        try:
            from app.services.assembly_service import assemble
            result = await assemble(user_input, session)
            if result:
                logger.info(f"[Match] 全局第二档命中: confidence={result.confidence}")
                return result
            logger.info("[Match] 全局第二档未命中")
        except Exception as e:
            logger.error(f"[Match] 全局第二档异常: {e}", exc_info=True)

        # 全局第三档：bare-agent
        logger.info("[Match] 降级为 bare-agent")
        return MatchResult(
            mode="bare_agent",
            reasoning="未匹配到合适的工作流或节点，将使用裸 Agent 模式执行",
            available_workflow_names=available_names,
        )


# ── 第一档：统一匹配 ──

async def _match_scoped(
    user_input: str, session: AsyncSession, team_id: uuid.UUID
) -> MatchResult | None:
    """Team scope 统一匹配：Team 关联的 Workflow + Team 关联的节点"""
    from app.services.team_service import get_team, get_team_workflows, get_team_nodes

    team = await get_team(session, team_id)
    if not team:
        logger.warning(f"[Match] Team 不存在: {team_id}")
        return None

    # 收集 Team 的 Workflow 和独立节点
    workflows = await get_team_workflows(session, team)
    nodes = await get_team_nodes(session, team)
    nodes = [n for n in nodes if n.name != "bare-agent"]  # 排除 bare-agent

    if not workflows and not nodes:
        logger.info(f"[Match] Team「{team.name}」没有任何工作流和节点")
        return None

    logger.info(
        f"[Match] Team「{team.name}」候选项: "
        f"{len(workflows)} 个工作流, {len(nodes)} 个节点"
    )

    # 构建候选项
    candidates = _build_scoped_candidates(team, workflows, nodes)

    # 一次 LLM 调用统一匹配
    match_info = await _llm_match_unified(user_input, candidates)

    if match_info:
        result = _build_match_result(match_info, workflows, nodes, team_id=team_id)
        if result:
            result.team_id = team_id
            result.team_name = team.name
        return result

    return None


async def _match_global(
    user_input: str, session: AsyncSession, user_id: uuid.UUID
) -> MatchResult | None:
    """全局统一匹配：所有 Team 的 Workflow(去重) + 所有 Team 的节点(去重)

    候选池：
    - 所有 Team 直接关联的 Workflow（多 Team 去重）
    - 所有 Team 直接关联的节点（多 Team 去重，排除 bare-agent）
    不包含 workflow DAG 中的组成节点。
    """
    from app.services.team_service import get_active_team_summaries

    # 获取所有活跃 Team
    team_summaries = await get_active_team_summaries(session)

    # 加载完整 Team 对象
    teams_with_resources: list[Team] = []
    if team_summaries:
        stmt = select(Team).where(
            Team.id.in_([uuid.UUID(t.id) for t in team_summaries]),
            Team.status == "active",
        )
        result = await session.execute(stmt)
        teams_with_resources = list(result.scalars().all())

    # 所有 Team 关联的 Workflow（去重）
    seen_wf_ids: set[str] = set()
    deduped_workflows: list[Workflow] = []
    # 所有 Team 关联的节点（去重）
    seen_node_ids: set[str] = set()
    deduped_nodes: list[NodeDefinition] = []

    for t in teams_with_resources:
        # Workflows
        wfs = await _get_team_workflows_cached(session, t)
        for wf in wfs:
            wid = str(wf.id)
            if wid not in seen_wf_ids:
                seen_wf_ids.add(wid)
                deduped_workflows.append(wf)

        # Nodes
        nds = await _get_team_nodes_cached(session, t)
        for n in nds:
            nid = str(n.id)
            if nid not in seen_node_ids:
                seen_node_ids.add(nid)
                deduped_nodes.append(n)

    # 构建候选项
    candidates = _build_global_candidates(deduped_workflows, deduped_nodes)

    if not candidates:
        logger.info("[Match] 没有任何候选项")
        return None

    logger.info(
        f"[Match] 全局候选项: {len(deduped_workflows)} 个工作流(去重后), "
        f"{len(deduped_nodes)} 个节点(去重后)"
    )

    # 一次 LLM 调用统一匹配
    match_info = await _llm_match_unified(user_input, candidates)

    if match_info:
        result = _build_match_result(match_info, deduped_workflows, deduped_nodes)
        return result

    return None


# ── 候选项构建 ──

def _build_scoped_candidates(
    team: Team,
    workflows: list[Workflow],
    nodes: list[NodeDefinition],
) -> list[dict]:
    """构建 Team scope 候选项

    仅包含 team 直接关联的 workflow 描述和节点描述，
    不涉及 workflow DAG 中的组成节点。
    """
    items: list[dict] = []

    for wf in workflows:
        items.append({
            "type": "workflow",
            "id": str(wf.id),
            "name": wf.name,
            "description": wf.description or "",
            "category": wf.category or "",
        })

    for node in nodes:
        items.append({
            "type": "single_node",
            "id": str(node.id),
            "name": node.name,
            "display_name": node.display_name or node.name,
            "description": node.description or "",
            "category": node.category or "",
        })

    return [{
        "team": team.display_name or team.name,
        "team_id": str(team.id),
        "items": items,
    }]


def _build_global_candidates(
    team_workflows: list[Workflow],
    team_nodes: list[NodeDefinition],
) -> list[dict]:
    """构建全局候选项：所有 Team 的 Workflow(已去重) + 所有 Team 的节点(已去重)

    不包含 workflow DAG 中的组成节点。
    """
    items: list[dict] = []

    for wf in team_workflows:
        items.append({
            "type": "workflow",
            "id": str(wf.id),
            "name": wf.name,
            "description": wf.description or "",
            "category": wf.category or "",
        })

    for node in team_nodes:
        items.append({
            "type": "single_node",
            "id": str(node.id),
            "name": node.name,
            "display_name": node.display_name or node.name,
            "description": node.description or "",
            "category": node.category or "",
        })

    return [{"items": items}]


# ── 统一 LLM 匹配 ──

async def _llm_match_unified(
    user_input: str, candidates: list[dict]
) -> dict | None:
    """统一 LLM 匹配：一次调用完成 Workflow/节点匹配

    Args:
        candidates: 候选项列表

    Returns:
        匹配信息 dict 或 None
        {"match_type": "workflow"|"single_node", "match_id": "...", "confidence": 0.8, "reasoning": "..."}
    """
    from app.core.llm.client import achat
    from app.config.settings import settings

    threshold = settings.ASSEMBLY_CONFIDENCE_THRESHOLD

    prompt = f"""你是一个任务匹配助手。根据用户的自然语言输入，从候选项中找到最匹配的工作流或节点。

用户输入：{user_input}

候选项：
{json.dumps(candidates, ensure_ascii=False, indent=2)}

请判断是否有匹配项。返回 JSON 格式：
- 如果有匹配（confidence >= {threshold}）：
  {{"matched": true, "match_type": "workflow", "match_id": "工作流ID", "confidence": 0.8, "reasoning": "匹配原因"}}
  或
  {{"matched": true, "match_type": "single_node", "match_id": "节点ID", "confidence": 0.8, "reasoning": "匹配原因"}}
- 如果没有匹配：
  {{"matched": false, "reasoning": "无匹配原因"}}

匹配规则：
1. 优先匹配 workflow（多节点编排的完整工作流），其次是 single_node（独立节点可单独完成任务）
2. single_node 类型的候选项是独立可执行的能力节点，如果用户意图与某个节点描述匹配，可以直接选择
3. 考虑候选项的描述（description），而非仅看名称
4. 如果用户意图明确与某个候选项匹配，confidence 应较高（>= 0.8）
5. 如果只能模糊匹配，confidence 适当降低

只返回 JSON，不要其他内容。"""

    try:
        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            caller="match_unified",
            temperature=0.1,
            max_tokens=300,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[Match] LLM 返回空内容")
            return None

        logger.info(f"[Match] LLM 返回: {content[:300]}")

        # 提取 JSON（复用 question_detector 的提取器，处理混合文本场景）
        from app.core.question_detector import extract_json_from_llm_response
        json_str = extract_json_from_llm_response(content)
        if not json_str:
            logger.warning("[Match] 无法从 LLM 响应中提取 JSON: %s", content[:200])
            return None

        parsed = json.loads(json_str)

        if not parsed.get("matched") or parsed.get("confidence", 0) < threshold:
            tlog().info("MATCH | 未命中 | matched=%s confidence=%s reasoning=%s",
                        parsed.get('matched'), parsed.get('confidence'), parsed.get('reasoning', '')[:80])
            logger.info(
                f"[Match] 未命中: matched={parsed.get('matched')}, "
                f"confidence={parsed.get('confidence')}, "
                f"reasoning={parsed.get('reasoning', '')}"
            )
            return None

        match_type = parsed.get("match_type", "")
        match_id = parsed.get("match_id", "")
        confidence = parsed.get("confidence", 0)
        reasoning = parsed.get("reasoning", "")

        if match_type not in ("workflow", "single_node"):
            logger.warning(f"[Match] LLM 返回了未知的 match_type: {match_type}")
            return None

        logger.info(
            f"[Match] 命中: match_type={match_type}, match_id={match_id}, "
            f"confidence={confidence}"
        )
        tlog().info("MATCH | 命中 | match_type=%s | match_id=%s | confidence=%.2f | reasoning=%s",
                    match_type, match_id, confidence, reasoning[:80])

        return {
            "match_type": match_type,
            "match_id": match_id,
            "confidence": confidence,
            "reasoning": reasoning,
        }

    except Exception as e:
        logger.warning(f"[Match] LLM 匹配异常: {e}")
        return None


def _build_match_result(
    match_info: dict,
    workflows: list[Workflow],
    nodes: list[NodeDefinition],
    team_id: uuid.UUID | None = None,
) -> MatchResult | None:
    """从 LLM 匹配信息构建 MatchResult

    对于 workflow 匹配：从 workflows 列表中查找完整 DAG
    对于 single_node 匹配：构建单节点 DAG
    """
    match_type = match_info["match_type"]
    match_id = match_info["match_id"]
    confidence = match_info["confidence"]
    reasoning = match_info["reasoning"]

    if match_type == "workflow":
        for wf in workflows:
            if str(wf.id) == match_id:
                dag = DAGDefinition(**wf.dag) if wf.dag else None
                return MatchResult(
                    mode="matched",
                    workflow_id=wf.id,
                    workflow_name=wf.name,
                    team_id=team_id,
                    confidence=confidence,
                    reasoning=reasoning,
                    dag=dag,
                )
        logger.warning(f"[Match] LLM 返回了不存在的 workflow_id: {match_id}")
        return None

    elif match_type == "single_node":
        for node in nodes:
            if str(node.id) == match_id:
                # 构建单节点 DAG
                dag = DAGDefinition(
                    nodes=[
                        NodeInstance(
                            id="node_1",
                            definition_id=match_id,
                            display_name=node.display_name or node.name,
                            config={},
                        )
                    ],
                    edges=[],
                )
                return MatchResult(
                    mode="dynamic_assembly",
                    team_id=team_id,
                    confidence=confidence,
                    reasoning=reasoning,
                    dag=dag,
                )
        logger.warning(f"[Match] LLM 返回了不存在的 node_id: {match_id}")
        return None

    return None


# ── 辅助 ──

async def _get_team_workflows_cached(
    session: AsyncSession, team: Team
) -> list[Workflow]:
    """获取 Team 直接关联的工作流（非归档）"""
    from app.services.team_service import get_team_workflows
    return await get_team_workflows(session, team)


async def _get_team_nodes_cached(
    session: AsyncSession, team: Team
) -> list[NodeDefinition]:
    """获取 Team 直接关联的节点（排除 bare-agent、deprecated）"""
    from app.services.team_service import get_team_nodes
    nodes = await get_team_nodes(session, team)
    return [n for n in nodes if n.name != "bare-agent"]


async def _get_available_names(
    session: AsyncSession, user_id: uuid.UUID, team_id: uuid.UUID | None
) -> list[str] | None:
    """获取可用的工作流名称列表（调试/降级提示用）"""
    try:
        if team_id:
            from app.services.team_service import get_team, get_team_workflows
            team = await get_team(session, team_id)
            if not team:
                return None
            workflows = await get_team_workflows(session, team)
            names = [w.name for w in workflows if w.status == "published"]
            return names if names else None
        else:
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
