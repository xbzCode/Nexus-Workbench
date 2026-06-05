"""匹配服务 — 三档降级

第一档：LLM 语义匹配已有工作流
第二档：LLM 动态组装（从已发布节点中挑选并编排 DAG）
第三档：裸 Agent（降级兜底）

设计原则：
- 工作流匹配 100% 由 LLM 驱动，不做关键词/规则兜底。
  关键词匹配天然不稳定——字数变化、同义词、表述方式改变都会失效。
  如果 LLM 不可用，直接跳过第一档，进入动态组装或裸 Agent。
"""

import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow import Workflow
from app.schemas.match import MatchResult
from app.schemas.workflow import DAGDefinition

logger = logging.getLogger(__name__)


async def match(user_input: str, session: AsyncSession, user_id: uuid.UUID) -> MatchResult:
    """三档降级匹配入口"""
    logger.info(f"[Match] 开始匹配: user_input={user_input!r}")

    # 收集可用工作流名称（用于返回调试信息）
    available_names: list[str] | None = None

    # 第一档：LLM 匹配已有工作流
    try:
        result = await _match_existing(user_input, session, user_id)
        if result:
            logger.info(f"[Match] 第一档命中: mode={result.mode}, name={result.workflow_name}, confidence={result.confidence}")
            return result
        logger.info("[Match] 第一档未命中")
        # 收集已发布工作流名称供前端展示
        available_names = await _get_published_workflow_names(session, user_id)
    except Exception as e:
        logger.error(f"[Match] 第一档异常: {e}", exc_info=True)

    # 第二档：LLM 动态组装 DAG
    try:
        from app.services.assembly_service import assemble
        result = await assemble(user_input, session)
        if result:
            logger.info(f"[Match] 第二档命中: mode={result.mode}, confidence={result.confidence}")
            return result
        logger.info("[Match] 第二档未命中")
    except Exception as e:
        logger.error(f"[Match] 第二档异常: {e}", exc_info=True)

    # 第三档：降级为裸 Agent
    logger.info("[Match] 降级为裸 Agent")
    return MatchResult(
        mode="bare_agent",
        reasoning="未匹配到已有工作流，将使用裸 Agent 模式执行",
        available_workflow_names=available_names,
    )


async def _match_existing(
    user_input: str, session: AsyncSession, user_id: uuid.UUID
) -> MatchResult | None:
    """第一档：LLM 语义匹配已有工作流

    只查询已发布（published）的工作流，交给 LLM 判断最佳匹配。
    LLM 不可用或判断无匹配时返回 None，由上层进入第二档动态组装。
    """
    stmt = (
        select(Workflow)
        .where(Workflow.user_id == user_id, Workflow.status == "published")
        .order_by(Workflow.updated_at.desc())
    )
    result = await session.execute(stmt)
    workflows = list(result.scalars().all())

    if not workflows:
        logger.info("[Match] 没有已发布的工作流，跳过第一档")
        return None

    logger.info(f"[Match] 查询到 {len(workflows)} 个已发布工作流: {[w.name for w in workflows]}")

    # 检查 LLM 是否可用
    from app.config.settings import settings
    if not settings.is_llm_configured:
        logger.warning(
            f"[Match] LLM 未配置，跳过第一档（有 {len(workflows)} 个工作流但无法语义匹配）。"
            f"请配置 LLM_API_KEY 以启用工作流匹配。"
        )
        return None

    # LLM 语义匹配
    return await _llm_match(user_input, workflows)


async def _llm_match(user_input: str, workflows: list[Workflow]) -> MatchResult | None:
    """LLM 语义匹配

    将所有工作流摘要 + 用户输入发给 LLM，让它判断最佳匹配。
    """
    from app.core.llm.client import achat
    from app.config.settings import settings

    # 构建工作流列表摘要
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

        # 提取 JSON（可能被 markdown 包裹）
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


async def _get_published_workflow_names(
    session: AsyncSession, user_id: uuid.UUID
) -> list[str] | None:
    """获取用户已发布的工作流名称列表（用于前端调试展示）"""
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
