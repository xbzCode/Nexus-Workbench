"""工作流匹配服务 — LLM 驱动意图解析 + 工作流选择"""

import json
import logging

from server.config import LLM_API_KEY, LLM_API_BASE, LLM_MODEL
from server.services.store import store

logger = logging.getLogger(__name__)


async def match_workflow(user_input: str) -> dict:
    """匹配工作流：LLM 解析意图 → 选择最匹配的工作流
    
    返回: {
        "intent": str,
        "matched_workflow_id": str | None,
        "matched_workflow_name": str | None,
        "confidence": float,
        "reasoning": str,
    }
    """
    # 获取所有已发布或有 DAG 的工作流
    available = []
    for wf in store.workflows.values():
        if wf.dag.nodes:  # 有节点的工作流才可用于匹配
            available.append({
                "id": wf.id,
                "name": wf.name,
                "description": wf.description,
                "category": wf.category,
                "node_count": len(wf.dag.nodes),
                "nodes": [n.definition_id for n in wf.dag.nodes],
            })

    if not available:
        return {
            "intent": user_input,
            "matched_workflow_id": None,
            "matched_workflow_name": None,
            "confidence": 0,
            "reasoning": "没有可用的工作流",
        }

    # 如果只有1个工作流，直接返回
    if len(available) == 1:
        wf = available[0]
        return {
            "intent": user_input,
            "matched_workflow_id": wf["id"],
            "matched_workflow_name": wf["name"],
            "confidence": 0.8,
            "reasoning": "唯一可用的工作流",
        }

    # LLM 匹配
    try:
        result = await _llm_match(user_input, available)
        return result
    except Exception as e:
        logger.warning(f"LLM 匹配失败，降级为规则匹配: {e}")
        return _rule_match(user_input, available)


async def _llm_match(user_input: str, workflows: list[dict]) -> dict:
    """使用 LLM 进行工作流匹配"""
    try:
        import httpx
    except ImportError:
        return _rule_match(user_input, workflows)

    prompt = f"""你是一个任务意图分析器。用户输入一段描述，你需要从候选工作流中选择最匹配的。

用户输入: {user_input}

候选工作流:
{json.dumps(workflows, ensure_ascii=False, indent=2)}

请返回 JSON 格式（不要其他文字）:
{{
  "intent": "用户意图的简短描述",
  "matched_workflow_id": "最匹配的工作流ID",
  "confidence": 0.0到1.0的置信度,
  "reasoning": "选择理由"
}}"""

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{LLM_API_BASE}chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={
                "model": LLM_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"LLM API error: {resp.status_code}")

        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        # 尝试解析 JSON
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            # 从文本中提取 JSON
            import re
            match = re.search(r'\{[^{}]+\}', content, re.DOTALL)
            if match:
                result = json.loads(match.group())
            else:
                raise

        # 找到匹配的工作流名称
        wf_name = None
        for wf in workflows:
            if wf["id"] == result.get("matched_workflow_id"):
                wf_name = wf["name"]
                break

        return {
            "intent": result.get("intent", user_input),
            "matched_workflow_id": result.get("matched_workflow_id"),
            "matched_workflow_name": wf_name,
            "confidence": result.get("confidence", 0.5),
            "reasoning": result.get("reasoning", ""),
        }


def _rule_match(user_input: str, workflows: list[dict]) -> dict:
    """规则匹配（降级方案）：基于工作流的 name/description/category 动态匹配

    不再硬编码关键词映射，而是将用户输入与工作流元数据做 token 级匹配。
    同时从工作流引用的节点定义中提取语义信息辅助匹配。
    """
    import re

    input_lower = user_input.lower()
    # 从用户输入中提取 token（按非字母数字分割）
    input_tokens = set(re.split(r'[^a-zA-Z0-9\u4e00-\u9fff]+', input_lower)) - {""}

    best_wf = None
    best_score = 0

    for wf in workflows:
        score = 0
        wf_name = wf.get("name", "").lower()
        wf_desc = wf.get("description", "").lower()
        wf_cat = wf.get("category", "").lower()

        # 1. 精确匹配：工作流名称出现在用户输入中
        if wf_name and wf_name in input_lower:
            score += 3

        # 2. 描述 token 匹配：用户输入的 token 在描述中出现
        desc_tokens = set(re.split(r'[^a-zA-Z0-9\u4e00-\u9fff]+', wf_desc)) - {""}
        overlap = input_tokens & desc_tokens
        score += len(overlap) * 2

        # 3. Category 匹配
        cat_tokens = set(re.split(r'[^a-zA-Z0-9\u4e00-\u9fff]+', wf_cat)) - {""}
        cat_overlap = input_tokens & cat_tokens
        score += len(cat_overlap)

        # 4. 节点定义语义辅助：从节点定义的 name/category 中提取匹配信号
        for node_def_id in wf.get("nodes", []):
            node_def = store.nodes.get(node_def_id)
            if node_def:
                nd_name = node_def.name.lower()
                nd_cat = node_def.category.lower()
                # 节点名称 token 匹配
                nd_tokens = set(re.split(r'[^a-zA-Z0-9\u4e00-\u9fff]+', nd_name)) - {""}
                score += len(input_tokens & nd_tokens)
                # 节点 category 匹配
                nd_cat_tokens = set(re.split(r'[^a-zA-Z0-9\u4e00-\u9fff]+', nd_cat)) - {""}
                score += len(input_tokens & nd_cat_tokens) * 0.5

        if score > best_score:
            best_score = score
            best_wf = wf

    if best_wf and best_score > 0:
        return {
            "intent": user_input,
            "matched_workflow_id": best_wf["id"],
            "matched_workflow_name": best_wf["name"],
            "confidence": min(best_score / 6, 1.0),
            "reasoning": f"规则匹配 (score={best_score})",
        }

    # 默认返回第一个
    return {
        "intent": user_input,
        "matched_workflow_id": workflows[0]["id"],
        "matched_workflow_name": workflows[0]["name"],
        "confidence": 0.3,
        "reasoning": "默认选择（无明确匹配）",
    }
