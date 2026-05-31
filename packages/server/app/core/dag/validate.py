"""DAG 校验 — 环检测 + 结构合法性"""

from __future__ import annotations

from app.core.dag.model import DAGContext
from app.schemas.workflow import DAGDefinition


class DAGValidationError(Exception):
    """DAG 校验错误"""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def validate_dag(dag: DAGDefinition) -> DAGContext:
    """校验 DAG 并返回 DAGContext，不合法则抛出 DAGValidationError

    校验项：
    1. 节点 ID 唯一
    2. 边引用的节点存在
    3. 无自环
    4. 无环（DFS 三色标记）
    """
    errors: list[str] = []

    # 1. 节点 ID 唯一
    node_ids = [n.id for n in dag.nodes]
    seen: set[str] = set()
    for nid in node_ids:
        if nid in seen:
            errors.append(f"重复节点 ID: {nid}")
        seen.add(nid)

    node_id_set = set(node_ids)

    # 2. 边引用的节点存在
    for edge in dag.edges:
        if edge.source_id not in node_id_set:
            errors.append(f"边引用了不存在的源节点: {edge.source_id}")
        if edge.target_id not in node_id_set:
            errors.append(f"边引用了不存在的目标节点: {edge.target_id}")

    # 3. 无自环
    for edge in dag.edges:
        if edge.source_id == edge.target_id:
            errors.append(f"自环边: {edge.source_id} → {edge.target_id}")

    if errors:
        raise DAGValidationError(errors)

    ctx = DAGContext(dag=dag)

    # 4. 环检测 — DFS 三色标记
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in node_id_set}

    def dfs(node_id: str) -> bool:
        """返回 True 表示有环"""
        color[node_id] = GRAY
        for edge in ctx.get_out_edges(node_id):
            target = edge.target_id
            if color[target] == GRAY:
                return True  # 回边 → 环
            if color[target] == WHITE and dfs(target):
                return True
        color[node_id] = BLACK
        return False

    for nid in node_id_set:
        if color[nid] == WHITE:
            if dfs(nid):
                errors.append(f"检测到环，涉及节点: {nid}")

    if errors:
        raise DAGValidationError(errors)

    return ctx
