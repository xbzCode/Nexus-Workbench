"""调度器 — 拓扑排序 + 并行调度 + 条件求值"""

import asyncio
from server.models.schemas import DAGDefinition


def topological_sort(dag: DAGDefinition) -> list[list[str]]:
    """Kahn 算法，返回执行层级 [[node_a, node_b], [node_c], ...]"""
    node_ids = [n.id for n in dag.nodes]
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}

    # 邻接表 + 计算入度
    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for e in dag.edges:
        adj[e.source_id].append(e.target_id)
        in_degree[e.target_id] += 1

    # BFS 分层
    levels: list[list[str]] = []
    queue = [nid for nid in node_ids if in_degree[nid] == 0]
    visited_count = 0

    while queue:
        levels.append(list(queue))
        next_queue = []
        for nid in queue:
            visited_count += 1
            for neighbor in adj[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    next_queue.append(neighbor)
        queue = next_queue

    # 如果有环，visited_count < 总节点数，但校验已在 dag.py 中完成
    return levels


def evaluate_condition(condition: str | None, output_data: dict) -> bool:
    """条件边求值。condition 为 None 表示无条件通过。
    
    支持属性访问语法：output.status == 'completed'
    内部将 output_data 包装为 DotDict 以支持 dict.key 语法。
    """
    if condition is None:
        return True

    # 简单沙箱 eval：只暴露 output 变量
    try:
        result = eval(condition, {"__builtins__": {}}, {"output": DotDict(output_data)})
        return bool(result)
    except Exception:
        return False


class DotDict(dict):
    """支持属性访问的 dict，用于 eval 条件表达式中 output.key 语法"""
    def __getattr__(self, key):
        try:
            return self[key]
        except KeyError:
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{key}'")


def resolve_data_mapping(
    mapping: dict | None,
    source_output: dict,
    all_outputs: dict[str, dict],
    workflow_input: dict,
) -> dict:
    """解析 data_mapping，构建目标节点的 input_data。
    
    mapping 示例:
      {"node_b.input.code": "node_a.output.code"}
      {"node_b.input.env": "$workflow.input"}
    """
    if not mapping:
        return source_output  # 默认：上游输出直接作为下游输入

    result = {}
    for target_path, source_expr in mapping.items():
        # 只取 target_path 最后一个 key（简化）
        target_key = target_path.split(".")[-1]

        # 解析 source_expr
        value = _resolve_expr(source_expr, source_output, all_outputs, workflow_input)
        result[target_key] = value

    return result


def _resolve_expr(expr: str, source_output: dict, all_outputs: dict[str, dict], workflow_input: dict):
    """解析单个映射表达式"""
    if expr.startswith("$workflow.input"):
        return workflow_input
    if expr.startswith("$node."):
        # $node.{id}.output → all_outputs[id]
        parts = expr.split(".")
        node_id = parts[1]
        return all_outputs.get(node_id, {})
    if expr.startswith("$prev.output"):
        return source_output

    # node_a.output.code → all_outputs["node_a"]["code"]
    parts = expr.split(".")
    if len(parts) >= 3 and parts[1] == "output":
        node_id = parts[0]
        key = parts[2] if len(parts) > 2 else None
        node_out = all_outputs.get(node_id, {})
        return node_out.get(key, node_out) if key else node_out

    return expr
