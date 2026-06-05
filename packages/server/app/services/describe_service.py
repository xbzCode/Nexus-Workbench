"""自然语言创建服务 — 用户描述意图，LLM 生成 SKILL.md 或 DAG

提供两个核心能力：
1. describe_node: 用户描述 → LLM 生成 SKILL.md → 用户确认 → 注册为 NodeDefinition
2. describe_workflow: 用户描述 → LLM 生成 DAG → 用户确认 → 保存为 Workflow
"""

import json
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.node import NodeDefCreate
from app.schemas.workflow import DAGDefinition, EdgeDef, NodeInstance, WorkflowCreate
from app.services import node_service, workflow_service

logger = logging.getLogger(__name__)

# ── SKILL.md 生成 Prompt ──

_NODE_SKILL_PROMPT = """你是一个节点定义生成器。用户将用自然语言描述一个 AI Agent 节点的能力，你需要生成标准格式的 SKILL.md。

用户描述：{user_input}

请生成一个完整的 SKILL.md，格式如下：

```
---
name: <英文短名，kebab-case，如 code-review>
description: <一句话描述节点的功能和触发条件>
version: 1.0.0
metadata:
  category: <分类，如 development/testing/design/analysis>
  adapter_type: codebuddy
---

# <节点中文名>

<详细描述节点的工作流程、约束和选项>

## Workflow

1. <步骤1>
2. <步骤2>
...

## Constraints

- <约束1>
- <约束2>

## Options

- <选项1>: <说明>
```

规则：
1. name 必须是英文 kebab-case 格式
2. description 要精确描述功能和触发场景
3. adapter_type 默认 codebuddy
4. 正文中 Workflow 部分描述 Agent 执行步骤
5. Constraints 描述限制和安全要求
6. Options 描述可配置项

只返回 SKILL.md 内容，不要其他解释。"""


_WORKFLOW_DAG_PROMPT = """你是一个工作流编排助手。用户将用自然语言描述一个工作流，你需要根据可用节点生成 DAG。

用户描述：{user_input}

可用节点：
{nodes_json}

请生成一个 DAG 工作流，返回 JSON 格式：
{{
  "name": "<工作流英文名，kebab-case>",
  "display_name": "<工作流中文名>",
  "description": "<一句话描述>",
  "category": "<分类>",
  "nodes": [
    {{"id": "node_1", "definition_name": "<节点name>", "config": {{}}}},
    {{"id": "node_2", "definition_name": "<节点name>", "config": {{}}}}
  ],
  "edges": [
    {{"source_id": "node_1", "target_id": "node_2"}}
  ]
}}

规则：
1. 只能从可用节点中选择，使用节点的 name 字段
2. 节点 id 用 node_1, node_2, ... 递增
3. 单节点工作流不需要 edges
4. 多节点用 edges 表示执行顺序
5. 如果没有合适的节点，返回 {{"error": "无法用已有节点编排"}}

只返回 JSON，不要其他内容。"""


async def describe_node(user_input: str) -> dict | None:
    """根据用户描述生成 SKILL.md 草稿

    Returns:
        {"skill_md": "...", "suggested": {"name": ..., "display_name": ..., ...}}
        或 None（LLM 不可用时）
    """
    content = await _call_llm(_NODE_SKILL_PROMPT.format(user_input=user_input))
    if not content:
        return None

    # 解析 YAML frontmatter 提取结构化字段
    suggested = _parse_skill_frontmatter(content)

    return {
        "skill_md": content,
        "suggested": suggested,
    }


async def confirm_node(
    session: AsyncSession,
    user_id: uuid.UUID,
    skill_md: str,
    overrides: dict | None = None,
) -> NodeDefCreate:
    """用户确认后注册节点

    Args:
        skill_md: LLM 生成的 SKILL.md 全文
        overrides: 用户修改的字段（name, display_name, description, category 等）

    Returns:
        创建的 NodeDefinition
    """
    parsed = _parse_skill_frontmatter(skill_md)
    merged = {**parsed, **(overrides or {})}

    data = NodeDefCreate(
        name=merged.get("name", f"node-{uuid.uuid4().hex[:8]}"),
        display_name=merged.get("display_name", merged.get("name", "未命名节点")),
        description=merged.get("description"),
        category=merged.get("category"),
        adapter_type=merged.get("adapter_type", "codebuddy"),
        skill_md=skill_md,
    )
    return await node_service.create_node(session, user_id, data)


async def describe_workflow(
    user_input: str, session: AsyncSession
) -> dict | None:
    """根据用户描述生成 DAG 工作流草稿

    Returns:
        {"name": ..., "dag": DAGDefinition, "description": ...}
        或 None
    """
    nodes = await node_service.list_nodes(session, category=None)
    published = [n for n in nodes if n.status == "published"]

    if not published:
        logger.info("[Describe] 没有已发布节点，无法编排工作流")
        return None

    node_summaries = []
    for n in published:
        s = {"name": n.name, "display_name": n.display_name}
        if n.description:
            s["description"] = n.description
        if n.category:
            s["category"] = n.category
        node_summaries.append(s)

    content = await _call_llm(
        _WORKFLOW_DAG_PROMPT.format(
            user_input=user_input,
            nodes_json=json.dumps(node_summaries, ensure_ascii=False, indent=2),
        )
    )
    if not content:
        return None

    try:
        parsed = json.loads(content)
        if "error" in parsed:
            logger.info(f"[Describe] LLM 无法编排: {parsed['error']}")
            return None

        dag_nodes = []
        for n in parsed.get("nodes", []):
            dag_nodes.append(
                NodeInstance(
                    id=n["id"],
                    definition_id=n.get("definition_name", n.get("definition_id", "")),
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

        dag = DAGDefinition(nodes=dag_nodes, edges=dag_edges)

        return {
            "name": parsed.get("name", "unnamed-workflow"),
            "display_name": parsed.get("display_name", "未命名工作流"),
            "description": parsed.get("description"),
            "category": parsed.get("category"),
            "dag": dag,
        }

    except (json.JSONDecodeError, KeyError) as e:
        logger.warning(f"[Describe] Failed to parse workflow DAG: {e}")
        return None


async def confirm_workflow(
    session: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    description: str | None = None,
    category: str | None = None,
    dag: DAGDefinition | None = None,
):
    """用户确认后保存工作流，自动发布（status=published），返回 Workflow ORM 对象"""
    data = WorkflowCreate(
        name=name,
        description=description,
        category=category,
        dag=dag,
    )
    wf = await workflow_service.create_workflow(session, user_id, data)
    # 用户通过自然语言确认创建 → 自动发布，立即可用
    wf.status = "published"
    await session.commit()
    await session.refresh(wf)
    return wf


# ── 内部工具 ──


def _parse_skill_frontmatter(skill_md: str) -> dict:
    """从 SKILL.md 的 YAML frontmatter 提取字段"""
    result = {}
    if not skill_md.startswith("---"):
        return result

    parts = skill_md.split("---", 2)
    if len(parts) < 3:
        return result

    yaml_block = parts[1].strip()
    # 简易 YAML 解析（避免引入 pyyaml 依赖）
    for line in yaml_block.split("\n"):
        line = line.strip()
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key in ("name", "description", "version", "adapter_type", "category"):
            result[key] = value

    # 从正文标题提取 display_name
    body = parts[2].strip()
    if body.startswith("# "):
        first_line = body.split("\n")[0]
        result.setdefault("display_name", first_line[2:].strip())

    return result


async def _call_llm(prompt: str) -> str | None:
    """调用 LLM，返回纯文本内容"""
    from app.core.llm.client import achat

    content = await achat(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1500,
        timeout=30.0,
    )
    if not content:
        return None

    # 去除 markdown 代码块包裹
    if content.startswith("```"):
        lines = content.split("\n")
        # 去掉首行 ```xxx 和末行 ```
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()

    return content
