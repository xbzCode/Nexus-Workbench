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
    """规则匹配（降级方案）：关键词匹配"""
    keywords_map = {
        "开发": ["development", "code_generation"],
        "生成": ["development", "code_generation"],
        "修复": ["fix", "bug_fix"],
        "bug": ["fix", "bug_fix"],
        "审查": ["review", "code_review"],
        "review": ["review", "code_review"],
    }

    input_lower = user_input.lower()
    best_wf = None
    best_score = 0

    for wf in workflows:
        score = 0
        # 工作流名称匹配
        if wf["name"].lower() in input_lower:
            score += 3
        # 描述匹配
        if wf["description"].lower() in input_lower:
            score += 2
        # 节点类型匹配
        for keyword, categories in keywords_map.items():
            if keyword in input_lower:
                for node_id in wf.get("nodes", []):
                    if any(cat in node_id for cat in categories):
                        score += 1

        if score > best_score:
            best_score = score
            best_wf = wf

    if best_wf:
        return {
            "intent": user_input,
            "matched_workflow_id": best_wf["id"],
            "matched_workflow_name": best_wf["name"],
            "confidence": min(best_score / 5, 1.0),
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
