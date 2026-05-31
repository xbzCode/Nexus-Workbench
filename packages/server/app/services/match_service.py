"""匹配服务 — 三档降级

第一档：匹配已有工作流（LLM 语义匹配 + 关键词兜底）
第二档：LLM 动态组装（从已发布节点中挑选并编排 DAG）
第三档：裸 Agent（降级兜底）
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

    # 第一档：匹配已有工作流
    try:
        result = await _match_existing(user_input, session, user_id)
        if result:
            logger.info(f"[Match] 第一档命中: mode={result.mode}, name={result.workflow_name}")
            return result
        logger.info("[Match] 第一档未命中")
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
    )


async def _match_existing(
    user_input: str, session: AsyncSession, user_id: uuid.UUID
) -> MatchResult | None:
    """第一档：匹配已有工作流

    优先 LLM 语义匹配，LLM 不可用时降级为关键词匹配。
    只匹配已发布的工作流，不匹配草稿（避免大量测试数据拖慢 LLM）。
    """
    # 获取用户所有已发布的工作流
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

    # 尝试 LLM 匹配
    llm_result = await _llm_match(user_input, workflows)
    if llm_result:
        return llm_result

    # 降级为关键词匹配
    return _keyword_match(user_input, workflows)


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
            logger.warning("[Match] _llm_match: achat 返回 None（LLM 不可用或超时）")
            return None

        logger.info(f"[Match] _llm_match: LLM 返回: {content[:200]}")

        # 提取 JSON（可能被 markdown 包裹）
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        parsed = json.loads(content)

        if parsed.get("matched") and parsed.get("confidence", 0) >= 0.6:
            wf_id = parsed["workflow_id"]
            # 找到对应的工作流
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

        return None

    except Exception as e:
        logger.warning(f"[Match] LLM match failed: {e}")
        return None


def _keyword_match(user_input: str, workflows: list[Workflow]) -> MatchResult | None:
    """关键词匹配（兜底方案）

    用用户输入中的关键词匹配工作流名称和描述。
    支持中文：用滑动窗口做 n-gram 匹配，而非空格分词。
    """
    input_lower = user_input.lower()
    best_match = None
    best_score = 0.0

    # 从用户输入提取关键词（中文用 bigram，英文用空格分词）
    keywords = _extract_keywords(input_lower)
    # 也保留完整输入用于完全匹配
    full_input = input_lower.strip()

    for wf in workflows:
        score = 0.0
        name_lower = wf.name.lower()
        desc_lower = (wf.description or "").lower()
        category_lower = (wf.category or "").lower()

        # 完全包含（最强信号）
        if full_input in name_lower or name_lower in full_input:
            score = max(score, 0.85)

        # 关键词匹配名称
        name_hits = sum(1 for kw in keywords if kw in name_lower)
        if name_hits > 0:
            score = max(score, 0.5 + 0.1 * min(name_hits, 3))

        # 关键词匹配描述
        desc_hits = sum(1 for kw in keywords if kw in desc_lower)
        if desc_hits > 0:
            score = max(score, 0.4 + 0.1 * min(desc_hits, 3))

        # 分类匹配
        if category_lower and category_lower in full_input:
            score = max(score, 0.4)

        if score > best_score:
            best_score = score
            best_match = wf

    if best_match and best_score >= 0.4:
        dag = DAGDefinition(**best_match.dag) if best_match.dag else None
        return MatchResult(
            mode="matched",
            workflow_id=best_match.id,
            workflow_name=best_match.name,
            confidence=best_score,
            reasoning=f"关键词匹配：{best_match.name}",
            dag=dag,
        )

    return None


def _extract_keywords(text: str) -> list[str]:
    """从输入中提取关键词

    英文用空格分词，中文用 bigram（2字组合）
    """
    keywords = []
    # 英文词
    words = text.split()
    for w in words:
        if len(w) > 1:
            keywords.append(w)

    # 中文 bigram
    if len(text) >= 2:
        for i in range(len(text) - 1):
            bigram = text[i : i + 2]
            # 只取包含中文字符的 bigram
            if any("\u4e00" <= c <= "\u9fff" for c in bigram):
                keywords.append(bigram)

    # 去重
    seen = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)

    return unique
