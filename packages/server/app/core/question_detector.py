"""Agent 提问检测模块

职责：从 Agent 输出文本中检测是否包含提问，并分类提问类型。
本模块是提问检测的**唯一入口**，Adapter 和 Engine 都通过此模块检测提问。

架构原则：
- 标记优先：Agent 使用 <<<QUESTION>>> 标记的 → 直接分类（可靠、快速）
- 无标记时走 fallback LLM 分析（覆盖 Agent 未遵守标记协议的场景）
- 对外暴露统一接口 detect_question()
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.config.logging import tlog, task_summary

# ── 正则常量 ──
_Q_PATTERN = re.compile(r'<<<QUESTION>>>(.*?)<<<END_QUESTION>>>', re.DOTALL)


async def detect_question(agent_text: str) -> dict[str, Any] | None:
    """检测 Agent 输出是否包含提问，返回结构化结果

    这是提问检测的**唯一入口**，替代原来的双路径（_classify_question_type + _analyze_agent_output）。

    流程：
    1. 正则匹配 <<<QUESTION>>> 标记 → 有标记直接分类
    2. 无标记 → fallback LLM 综合分析

    Args:
        agent_text: Agent 本轮完整输出文本

    Returns:
        None — 不是提问
        {"is_question": True, "type": "choice", "question": "...", "options": [...], ...}
    """
    if not agent_text or len(agent_text.strip()) < 5:
        return None

    # 1. 标记检测
    match = _Q_PATTERN.search(agent_text)
    if match:
        question_content = match.group(1).strip()
        result = await _classify_question_type(question_content, context_text=agent_text)
        if result:
            result["is_question"] = True
            return result
        # 分类失败（LLM 不可用等），至少标记为提问
        return {"is_question": True, "type": "input", "question": question_content[:200], "options": []}

    # 2. 无标记 → fallback 分析
    return await _analyze_agent_output(agent_text)


# ── 内部实现 ──

async def _classify_question_type(question_text: str, context_text: str = "") -> dict[str, Any] | None:
    """LLM 分类提问类型（Agent 已通过标记明确在提问）

    Args:
        question_text: <<<QUESTION>>> 标记内的提问内容
        context_text: 完整 Agent 输出文本（包含选项列表等上下文信息）
    """
    if not question_text or len(question_text.strip()) < 5:
        return None

    try:
        from app.core.llm.client import achat
        from app.config.settings import settings

        # 上下文段落
        context_section = ""
        if context_text and context_text.strip() != question_text.strip():
            clean_context = _Q_PATTERN.sub('', context_text).strip()
            if clean_context:
                context_section = f"""

Agent 完整输出上下文（选项列表可能在其中）：
{clean_context[-2000:]}
"""

        prompt = f"""分析以下 Agent 提问，判断提问类型并返回 JSON。

Agent 提问：
{question_text[:2000]}{context_section}
类型说明：
- "form"：2个及以上独立问题（每个问题可能类型不同：选择、输入、确认等）
- "choice"：1个问题，明确列出2个及以上选项让用户单选
- "multi_choice"：1个问题，列出多个选项让用户多选
- "input"：1个问题，要求用户自由输入/回答（无具体选项）
- "confirm"：1个问题，征求确认或许可（是/否）
- "ranking"：1个问题，要求用户对选项排序/排优先级

单问题返回格式（type 为 choice/multi_choice/input/confirm/ranking 时）：
{{
  "type": "choice|multi_choice|input|confirm|ranking",
  "question": "提取出的核心问题（简短摘要，不超过100字）",
  "options": [
    {{"label": "选项描述", "value": "唯一值"}}
  ],
  "reasoning": "简短说明判断依据"
}}

多问题返回格式（type 为 form 时）：
{{
  "type": "form",
  "question": "整体问题摘要（不超过100字）",
  "questions": [
    {{
      "id": "q1",
      "type": "choice",
      "question": "第一个问题的文本",
      "options": [{{"label": "选项A", "value": "a"}}, {{"label": "选项B", "value": "b"}}]
    }},
    {{
      "id": "q2",
      "type": "input",
      "question": "第二个问题的文本",
      "options": []
    }}
  ],
  "reasoning": "简短说明判断依据"
}}

规则：
- 如果同时提出了多个独立问题/维度，必须用 form 类型
- questions 中每个子问题的 type 只能是 choice/multi_choice/input/confirm/ranking
- options 仅在 type 为 choice/multi_choice 或 ranking 时填充，其他类型为空数组
- choice: 选项互斥，语义为单选；如果 Agent 未列出具体选项，归类为 input
- multi_choice: 选项不互斥，语义为多选
- 示例性选项必须加"其他"：当选项带有"如"、"例如"、"等"、"etc"等示例性暗示词时，
  说明选项并未穷举所有可能，必须在末尾添加 {{"label": "其他", "value": "other"}} 选项
- 禁止编造无意义占位选项（如"未指定"、"unknown"），但"其他"是合法选项
- options 中 value 用简短英文标识
- 只返回 JSON，不要其他内容

选项有效性判定规则（最重要，防止将开放性问题误判为选择题）：
- options 的每一项必须是用户可以直接选中提交的**具体离散值**（如科目名、城市名、功能名）
- 如果 options 的 label/value 是对问题回答**维度的抽象描述**（如"不想考虑的方向"、"缺失的信息"、
  "需要调整的部分"），而不是用户可直接选择的项，则这些"选项"无效，整个问题应归类为 input
- 判断标准：问自己"用户看到这个选项后，能直接点选吗？"如果答案是"不能，我还需要补充具体内容"，
  那这就是 input，不是 choice/multi_choice
- 典型错误示例："有没有不想考虑的？" → 选项["不想考虑的方向","想了解但不在列表的"] → 错！
  正确做法：归类为 input，让用户自由输入哪些不想考虑

form 类型使用克制规则（防止过度拆分）：
- 只有当 Agent 的提问确实包含**2个以上需要不同交互方式回答的独立子问题**时才用 form
- 不要把一个自然问题强行拆成 form：如"你觉得怎么样？需要了解细节吗？"本质是一个 input，
  用户可以在一次输入中同时表达看法和是否需要更多信息
- form 的价值在于结构化收集不同类型的回答，而非机械地按问号数量拆分
- 如果拆分后某个子问题的回答对另一个子问题有依赖（如先说看法再决定是否要细节），
  说明不应拆分为 form，而应归为单个 input"""

        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            caller="classify_question_type",
            temperature=0.1,
            max_tokens=800,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            tlog().warning("CLASSIFY QUESTION | LLM 不可用")
            return None

        result = _parse_llm_json(content)
        if not result:
            return None

        if not isinstance(result, dict) or "type" not in result:
            tlog().warning("CLASSIFY | LLM 返回格式异常: %s", content[:200])
            return None

        task_summary("[LLM] Question classified: type=%s, question=%s",
                    result.get("type", ""), str(result.get("question", ""))[:80])
        return result

    except Exception as e:
        tlog().warning("CLASSIFY | 分类异常: %s", e)
        return None


async def _analyze_agent_output(agent_text: str) -> dict[str, Any] | None:
    """LLM 综合分析 Agent 输出是否包含提问（fallback 路径）

    Args:
        agent_text: Agent 本轮输出的完整文本
    """
    if not agent_text or len(agent_text.strip()) < 10:
        return None

    # 快速排除：纯陈述性文本
    has_question_mark = "？" in agent_text or "?" in agent_text
    _hint_words = ["请选择", "请确认", "请问", "是否", "你想", "你希望", "哪个", "哪种",
                   "would you", "should i", "do you want", "please choose"]
    has_hint = any(w in agent_text.lower() for w in _hint_words)
    if not has_question_mark and not has_hint and len(agent_text) < 80:
        return None

    try:
        from app.core.llm.client import achat
        from app.config.settings import settings

        prompt = f"""分析以下 AI Agent 的输出，判断它是否在向用户提问/请求指示。

Agent 输出：
<<<AGENT_OUTPUT_START>>>
{agent_text[:2000]}
<<<AGENT_OUTPUT_END>>>

请判断并返回 JSON：

判断规则：
1. is_question = true 的情况：
   - Agent 明确向用户提问（如"你想用哪种方案？"、"请确认是否继续"）
   - Agent 列出了选项让用户选择（如"方案A还是方案B？"）
   - Agent 要求用户提供信息（如"请输入项目名称"）
   - Agent 请求许可/确认（如"是否继续执行？"）
   - Agent 要求排序/优先级排列（如"按重要性排序"）

2. is_question = false 的情况：
   - Agent 只是在陈述进度或结果（如"已完成XX"、"正在执行YY"）
   - Agent 在解释或描述某事（如"这是因为..."、"该文件包含..."）
   - Agent 输出的是总结性文字（如"任务执行完毕"、"生成了以下文件"）
   - 文中的问号只是修辞用法或反问（如"为什么不呢？"）而非真正需要用户回答

类型说明（仅 is_question=true 时需要）：
- "form"：Agent 提出了2个及以上独立问题
- "choice"：1个问题，明确列出2个及以上选项，语义为单选
- "multi_choice"：1个问题，列出多个选项，语义为多选
- "input"：1个问题，要求用户自由输入/回答
- "confirm"：1个问题，征求确认或许可（是/否）
- "ranking"：1个问题，要求用户对选项排序

单问题返回格式：
{{
  "is_question": true,
  "type": "choice|multi_choice|input|confirm|ranking",
  "question": "提取出的核心问题",
  "options": [{{"label": "选项描述", "value": "唯一值"}}],
  "reasoning": "简短说明"
}}

多问题返回格式：
{{
  "is_question": true,
  "type": "form",
  "question": "整体问题摘要",
  "questions": [
    {{"id": "q1", "type": "choice", "question": "问题文本", "options": [...]}}
  ],
  "reasoning": "简短说明"
}}

规则：
- 如果 Agent 同时提出了多个独立问题/维度，必须用 form 类型
- options 仅在 type 为 choice/multi_choice 或 ranking 时填充
- choice 必须 Agent 原文中明确列出了选项，不得编造
- multi_choice 用于语义为多选的场景
- 禁止为 choice/input/multi_choice 编造占位选项
- 只返回 JSON，不要其他内容"""

        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            caller="analyze_agent_output",
            temperature=0.1,
            max_tokens=800,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            tlog().warning("ANALYZE AGENT OUTPUT | LLM 不可用，降级为无提问")
            return None

        result = _parse_llm_json(content)
        if not result:
            return None

        if not isinstance(result, dict) or "is_question" not in result:
            tlog().warning("ANALYZE | LLM 返回格式异常: %s", content[:200])
            return None

        is_q = result.get("is_question", False)
        extra = ""
        if is_q:
            rtype = result.get("type", "")
            rquestion = str(result.get("question", ""))[:80]
            extra = f", type={rtype}, question={rquestion}"
        task_summary("[LLM] Agent analyzed: is_question=%s%s", is_q, extra)
        return result

    except Exception as e:
        tlog().warning("ANALYZE | 分析异常: %s", e)
        return None


# ── JSON 解析工具 ──

# 模块级共享：从 LLM 响应中提取 JSON（也供 match_service / assembly_service 使用）
def extract_json_from_llm_response(content: str) -> str | None:
    """从 LLM 响应中提取纯 JSON 字符串

    处理三种情况：
    1. ```json ... ``` 代码块包裹
    2. 纯 JSON 字符串
    3. 混合文本中嵌入的 JSON（找到第一个 { 和最后一个 }）
    """
    if not content:
        return None

    # 1. 尝试提取 ``` 代码块
    if "```" in content:
        parts = content.split("```")
        for p in parts:
            p = p.strip()
            if p.startswith("json"):
                p = p[4:]
            if p.startswith("{"):
                return p

    # 2. 尝试直接解析（纯 JSON）
    content_stripped = content.strip()
    if content_stripped.startswith("{"):
        return content_stripped

    # 3. 从混合文本中提取 JSON 对象（第一个 { 到最后一个 }）
    start = content_stripped.find("{")
    end = content_stripped.rfind("}")
    if start != -1 and end > start:
        return content_stripped[start:end + 1]

    return None


def _parse_llm_json(content: str) -> dict[str, Any] | None:
    """从 LLM 响应中解析 JSON"""
    json_str = extract_json_from_llm_response(content)
    if not json_str:
        tlog().warning("QUESTION DETECTOR | 无法从响应中提取 JSON: %s", content[:200])
        return None

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        repaired = _repair_truncated_json(json_str)
        if repaired:
            tlog().info("QUESTION DETECTOR | 截断 JSON 修复成功")
            return repaired
        tlog().warning("QUESTION DETECTOR | JSON 解析失败: %s", json_str[:300])
        return None


def _repair_truncated_json(text: str) -> dict[str, Any] | None:
    """修复被截断的 JSON 字符串"""
    if not text or not text.strip().startswith("{"):
        return None

    s = text.strip()
    for _ in range(5):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            pass

        closers = ""
        in_string = False
        escape_next = False
        stack: list[str] = []

        for ch in s:
            if escape_next:
                escape_next = False
                continue
            if ch == '\\':
                escape_next = True
                continue
            if ch == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == '{':
                stack.append('}')
            elif ch == '[':
                stack.append(']')
            elif ch == '}' or ch == ']':
                if stack and stack[-1] == ch:
                    stack.pop()

        if in_string:
            closers += '"'
        closers += ''.join(reversed(stack))
        if not closers:
            break
        s = s + closers

    return None
