"""Kahn 拓扑排序 — 返回分层执行列表

输出: [[node_a, node_b], [node_c], [node_d]]
  层级0: 无依赖节点
  层级1: 依赖层级0的节点
  ...
"""

from __future__ import annotations

from collections import defaultdict, deque

from app.core.dag.model import DAGContext


def topo_sort(ctx: DAGContext) -> list[list[str]]:
    """Kahn 算法拓扑排序，返回分层执行列表

    Returns:
        按层级排列的节点 ID 列表，如 [[A, B], [C], [D]]

    Raises:
        ValueError: 存在环（不应发生，因为 validate 已检测）
    """
    # 计算入度
    in_degree: dict[str, int] = defaultdict(int)
    for nid in ctx.node_ids():
        in_degree[nid] = len(ctx.get_in_edges(nid))

    # 入度为 0 的节点入队
    queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
    levels: list[list[str]] = []

    while queue:
        # 当前层所有节点
        level = list(queue)
        levels.append(level)
        queue.clear()

        for nid in level:
            for edge in ctx.get_out_edges(nid):
                target = edge.target_id
                in_degree[target] -= 1
                if in_degree[target] == 0:
                    queue.append(target)

    # 检查是否所有节点都被处理（有环则不会）
    processed = sum(len(lv) for lv in levels)
    if processed != len(ctx.node_ids()):
        raise ValueError(f"拓扑排序失败：存在环（已处理 {processed}/{len(ctx.node_ids())} 个节点）")

    return levels
