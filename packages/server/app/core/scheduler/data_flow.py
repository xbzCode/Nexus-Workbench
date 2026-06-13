"""数据流传递 — 语义传递 + 精确映射

两层模式：
1. 语义传递（默认）：上游 output 的 {status, summary, result} → 下游 input 的 {previous_status, previous_output, previous_result}
2. 精确映射（高级）：data_mapping 按 $prev.output, $node.{id}.output, $workflow.input 解析

Resume 感知：
- 当下游节点使用 --resume 继承上游 CLI 会话时，Agent 已拥有上游节点的完整对话上下文
- 此时无需再传递 previous_output / previous_summaries 等冗余数据，避免上下文膨胀
- 只传递增量信息（状态、精炼结果），让 Agent 从已有上下文中获取详情
"""

from __future__ import annotations

import re
from typing import Any

from app.core.dag.model import DAGContext


def compute_node_input(
    ctx: DAGContext,
    node_id: str,
    node_outputs: dict[str, dict[str, Any]],
    workflow_input: dict[str, Any] | None = None,
    *,
    is_resume: bool = False,
) -> dict[str, Any]:
    """计算节点的输入数据

    Args:
        ctx: DAG 上下文
        node_id: 当前节点 ID
        node_outputs: 已完成节点的输出 {node_id: output_dict}
        workflow_input: 工作流初始输入
        is_resume: 下游节点是否通过 --resume 继承了上游 CLI 会话。
                   Resume 模式下 Agent 已有上游上下文，语义传递时会省略冗余字段。

    Returns:
        节点的输入 dict
    """
    in_edges = ctx.get_in_edges(node_id)

    if not in_edges:
        # 根节点：直接用工作流输入
        return {"task_input": workflow_input or {}}

    # 收集所有入边的数据
    input_data: dict[str, Any] = {}

    for edge in in_edges:
        source_output = node_outputs.get(edge.source_id, {})

        if edge.data_mapping:
            # 精确映射模式
            mapped = _resolve_mapping(edge.data_mapping, source_output, node_outputs, workflow_input)
            input_data.update(mapped)
        else:
            # 语义传递模式
            input_data.update(_semantic_transfer(source_output, is_resume=is_resume))

    # 汇总所有上游的 summary（用于拼入 prompt）
    # Resume 模式下 Agent 已在上下文中看到上游输出，不需要重复传递
    if not is_resume:
        summaries = []
        for edge in in_edges:
            source_output = node_outputs.get(edge.source_id, {})
            if summary := source_output.get("summary"):
                summaries.append(f"[{edge.source_id}]: {summary}")
        if summaries:
            input_data["previous_summaries"] = "\n".join(summaries)

    return input_data


def _semantic_transfer(source_output: dict[str, Any], *, is_resume: bool = False) -> dict[str, Any]:
    """语义传递 — 自动提取上游关键字段

    数据优先级：result > summary
    - result 是 Agent 明确产出的精炼输出（如 SKILL 要求的结构化结果）
    - summary 是引擎拼凑的摘要（可能包含对话噪音），作为兜底

    Resume 感知：
    - is_resume=True 时，Agent 已有上游的完整对话上下文，无需传递任何输出数据
    - 只传 previous_status 供下游快速判断上游执行状态即可
    """
    result: dict[str, Any] = {}

    # 状态：始终传递
    if "status" in source_output:
        result["previous_status"] = source_output["status"]

    if is_resume:
        # Resume 模式：Agent 已有上游完整对话上下文，无需传递输出数据
        return result

    # 非 resume 模式：传递完整上下文
    if "result" in source_output:
        # result 优先：它是 Agent 明确产出的精炼输出
        result["previous_result"] = source_output["result"]
        result["previous_output"] = source_output["result"]
    elif "summary" in source_output:
        # 无 result：用 summary 兜底
        result["previous_output"] = source_output["summary"]

    # detail：仅在非 resume 模式下传递
    if "detail" in source_output:
        result["previous_detail"] = source_output["detail"]

    return result


# 精确映射变量模式
_MAPPING_VAR = re.compile(r"^\$(prev|node|workflow)\.(.+)$")


def _resolve_mapping(
    mapping: dict[str, str],
    source_output: dict[str, Any],
    node_outputs: dict[str, dict[str, Any]],
    workflow_input: dict[str, Any] | None,
) -> dict[str, Any]:
    """解析精确映射

    支持的特殊变量：
    - $prev.output — 上一个节点输出
    - $node.{id}.output — 任意节点输出
    - $workflow.input — 工作流初始输入
    """
    result: dict[str, Any] = {}

    for target_field, source_expr in mapping.items():
        value = _resolve_value(source_expr, source_output, node_outputs, workflow_input)
        # 支持嵌套字段赋值: "B.input.code" → {"B": {"input": {"code": value}}}
        parts = target_field.split(".")
        _set_nested(result, parts, value)

    return result


def _resolve_value(
    expr: str,
    source_output: dict[str, Any],
    node_outputs: dict[str, dict[str, Any]],
    workflow_input: dict[str, Any] | None,
) -> Any:
    """解析单个映射表达式的值"""
    match = _MAPPING_VAR.match(expr)
    if not match:
        # 字面量
        return expr

    var_type = match.group(1)
    path = match.group(2)

    if var_type == "prev":
        return _get_by_path(source_output, path)
    elif var_type == "node":
        # $node.{id}.output.detail.code → node_id={id}, path=output.detail.code
        parts = path.split(".", 1)
        if len(parts) < 2:
            return None
        node_id = parts[0]
        node_path = parts[1]
        target_output = node_outputs.get(node_id, {})
        return _get_by_path(target_output, node_path)
    elif var_type == "workflow":
        if path == "input":
            return workflow_input or {}
        return _get_by_path(workflow_input or {}, path)

    return None


def _get_by_path(data: dict[str, Any], path: str) -> Any:
    """按点分隔路径获取嵌套值，如 'output.detail.code'"""
    current = data
    for key in path.split("."):
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


def _set_nested(data: dict[str, Any], keys: list[str], value: Any) -> None:
    """按路径设置嵌套值"""
    current = data
    for key in keys[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value
