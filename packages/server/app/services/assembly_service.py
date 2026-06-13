"""动态组装服务 — LLM 根据用户意图 + 全局节点能力描述组装 DAG

第二档匹配：未命中已有工作流时，用 LLM 从全局已注册节点中挑选并编排 DAG。
LLM 返回 confidence，低于 ASSEMBLY_CONFIDENCE_THRESHOLD 时视为组装失败。

无论用户是否选了 Team，动态组装始终从全局节点池挑选。
"""

import json
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.schemas.match import MatchResult
from app.schemas.workflow import DAGDefinition, EdgeDef, NodeInstance
from app.services import node_service

logger = logging.getLogger(__name__)

from app.config.logging import tlog


async def assemble(user_input: str, session: AsyncSession) -> MatchResult | None:
    """全局动态组装 DAG（第二档）

    Args:
        user_input: 用户自然语言输入
        session: DB session

    Returns:
        MatchResult(dynamic_assembly) 或 None（无法组装时）
    """
    # 1. 获取已发布节点能力描述（排除 bare-agent，它是兜底节点不应被 LLM 选中）
    nodes = await node_service.list_nodes(session, category=None)
    published = [n for n in nodes if n.status == "published" and n.name != "bare-agent"]

    if not published:
        logger.info("[Assembly] 没有已发布的节点，跳过动态组装")
        return None

    logger.info(f"[Assembly] 找到 {len(published)} 个已发布节点: {[n.name for n in published]}")
    tlog().info("ASSEMBLY | 开始动态组装 | nodes=%s", [n.name for n in published])
    return await _assemble_from_nodes(user_input, published)


async def _assemble_from_nodes(
    user_input: str, nodes: list,
) -> MatchResult | None:
    """从给定节点列表中用 LLM 编排 DAG"""
    # 构建节点摘要
    node_summaries = []
    name_to_uuid: dict[str, str] = {}
    name_to_display_name: dict[str, str] = {}
    for n in nodes:
        summary = {"name": n.name, "display_name": n.display_name}
        if n.description:
            summary["description"] = n.description
        if n.category:
            summary["category"] = n.category
        node_summaries.append(summary)
        name_to_uuid[n.name] = str(n.id)
        name_to_display_name[n.name] = n.display_name or n.name

    return await _llm_assemble(user_input, node_summaries, name_to_uuid, name_to_display_name)


async def _llm_assemble(
    user_input: str, node_summaries: list[dict], name_to_uuid: dict[str, str], name_to_display_name: dict[str, str]
) -> MatchResult | None:
    """调用 LLM 从节点列表中选择并编排 DAG

    Args:
        name_to_uuid: 节点 name → UUID 映射，用于将 LLM 返回的 name 转为 definition_id

    Returns:
        MatchResult(dynamic_assembly) 或 None
    """
    from app.core.llm.client import achat
    from app.config.settings import settings

    threshold = settings.ASSEMBLY_CONFIDENCE_THRESHOLD

    prompt = f"""你是一个工作流编排助手。根据用户的自然语言输入，从可用节点中选择合适的节点并编排为 DAG 工作流。

用户输入：{user_input}

可用节点：
{json.dumps(node_summaries, ensure_ascii=False, indent=2)}

请选择合适的节点并编排执行顺序。返回 JSON 格式：
{{
  "can_assemble": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "编排理由",
  "nodes": [
    {{"id": "node_1", "definition_name": "节点name", "config": {{}}}},
    {{"id": "node_2", "definition_name": "节点name", "config": {{}}}}
  ],
  "edges": [
    {{"source_id": "node_1", "target_id": "node_2"}}
  ]
}}

规则：
1. 只能从可用节点中选择，使用节点的 name 字段作为 definition_name
2. 节点 id 用 node_1, node_2, ... 递增
3. 如果用户意图与所有可用节点都无关，设置 can_assemble=false, confidence=0
4. 单节点工作流不需要 edges
5. 多节点时用 edges 表示执行顺序（前一个节点的输出是后一个的输入）
6. config 暂时留空 {{}}
7. confidence 是你对匹配程度的信心，考虑用户意图与节点能力的语义相关度

只返回 JSON，不要其他内容。"""

    try:
        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            caller="llm_assemble",
            temperature=0.2,
            max_tokens=500,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[Assembly] achat 返回 None（LLM 不可用或超时）")
            return None

        logger.info(f"[Assembly] LLM 原始返回: {content[:300]}")

        # 提取 JSON（复用 question_detector 的提取器，处理混合文本场景）
        from app.core.question_detector import extract_json_from_llm_response
        json_str = extract_json_from_llm_response(content)
        if not json_str:
            logger.warning("[Assembly] 无法从 LLM 响应中提取 JSON: %s", content[:200])
            return None

        parsed = json.loads(json_str)

        confidence = parsed.get("confidence", 0)
        if not parsed.get("can_assemble") or confidence < threshold:
            tlog().info("ASSEMBLY | 组装失败 | can_assemble=%s confidence=%.2f reasoning=%s",
                        parsed.get('can_assemble'), confidence, parsed.get('reasoning', '')[:80])
            logger.info(
                f"[Assembly] LLM 判断无法组装或置信度不足: "
                f"confidence={confidence:.2f}, threshold={threshold:.2f}, "
                f"reasoning={parsed.get('reasoning', '')}"
            )
            return None

        # 构建 DAG
        dag_nodes = []
        for n in parsed.get("nodes", []):
            def_name = n.get("definition_name", "")
            if def_name not in name_to_uuid:
                logger.warning(f"[Assembly] LLM 选择了不存在的节点: {def_name}")
                return None
            dag_nodes.append(
                NodeInstance(
                    id=n["id"],
                    definition_id=name_to_uuid[def_name],
                    display_name=name_to_display_name.get(def_name, def_name),
                    config=n.get("config", {}),
                )
            )

        dag_edges = []
        for e in parsed.get("edges", []):
            dag_edges.append(
                EdgeDef(
                    source_id=e["source_id"],
                    target_id=e["target_id"],
                )
            )

        dag_def = DAGDefinition(nodes=dag_nodes, edges=dag_edges)

        return MatchResult(
            mode="dynamic_assembly",
            dag=dag_def,
            confidence=confidence,
            reasoning=parsed.get("reasoning", f"动态组装，使用 {len(dag_nodes)} 个节点"),
        )

    except Exception as e:
        logger.warning(f"[Assembly] LLM assembly failed: {e}")
        return None
