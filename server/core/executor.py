"""节点执行器 — 事件驱动 + Mock 执行（迭代3用 Mock，迭代5接入 Adapter）"""

import asyncio
from server.models.schemas import DAGDefinition, NodeInstance
from server.core.scheduler import (
    topological_sort, evaluate_condition, resolve_data_mapping
)
from server.core.events import event_bus


async def execute_dag(
    dag: DAGDefinition,
    input_data: dict,
    node_defs: dict,
) -> dict:
    """执行整个 DAG，返回每个节点的输出 {node_id: output_data}"""
    levels = topological_sort(dag)
    all_outputs: dict[str, dict] = {}

    # 构建节点查找表
    node_map: dict[str, NodeInstance] = {n.id: n for n in dag.nodes}

    # 构建边查找表: target_id -> [edges]
    edges_to: dict[str, list] = {}
    for e in dag.edges:
        edges_to.setdefault(e.target_id, []).append(e)

    for level_idx, level_nodes in enumerate(levels):
        await event_bus.emit("dag:level_started", {
            "level": level_idx,
            "nodes": level_nodes,
        })

        # 并行执行当前层级所有节点
        tasks = []
        for node_id in level_nodes:
            node = node_map[node_id]

            # 检查条件：所有入边条件都满足才执行
            should_run = _should_run_node(node_id, edges_to, all_outputs)
            if not should_run:
                all_outputs[node_id] = {"_skipped": True}
                await event_bus.emit("dag:node_skipped", {"node_id": node_id})
                continue

            # 计算输入数据
            node_input = _compute_input(node_id, edges_to, all_outputs, input_data, dag)

            tasks.append(_execute_node(node, node_input, node_defs))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 收集输出
        for i, node_id in enumerate(level_nodes):
            if node_id in all_outputs:
                continue  # skipped
            result = results[i]
            if isinstance(result, Exception):
                all_outputs[node_id] = {"_error": str(result)}
                await event_bus.emit("dag:node_failed", {"node_id": node_id, "error": str(result)})
            else:
                all_outputs[node_id] = result

    return all_outputs


def _should_run_node(node_id: str, edges_to: dict, all_outputs: dict) -> bool:
    """判断节点是否应该执行：所有入边条件都满足（或无入边）"""
    incoming = edges_to.get(node_id, [])
    if not incoming:
        return True  # 无入边，始终执行

    for e in incoming:
        source_out = all_outputs.get(e.source_id, {})
        if not evaluate_condition(e.condition, source_out):
            return False
    return True


def _compute_input(node_id: str, edges_to: dict, all_outputs: dict, workflow_input: dict, dag: DAGDefinition) -> dict:
    """计算节点输入数据"""
    incoming = edges_to.get(node_id, [])
    if not incoming:
        return workflow_input  # 无入边，用工作流输入

    # 合并所有入边的数据映射
    merged = {}
    for e in incoming:
        source_out = all_outputs.get(e.source_id, {})
        mapped = resolve_data_mapping(e.data_mapping, source_out, all_outputs, workflow_input)
        merged.update(mapped)
    return merged


async def _execute_node(node: NodeInstance, input_data: dict, node_defs: dict) -> dict:
    """执行单个节点（迭代3：Mock 执行）"""
    await event_bus.emit("dag:node_started", {"node_id": node.id, "definition_id": node.definition_id})

    # Mock：延迟 1 秒，返回模拟输出
    await asyncio.sleep(1)
    output = {
        "status": "success",
        "message": f"Mock execution of {node.definition_id}",
        "input_received": input_data,
    }

    await event_bus.emit("dag:node_completed", {"node_id": node.id, "output": output})
    return output
