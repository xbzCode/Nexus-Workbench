"""DAG 模型 — 校验 + 环检测"""

from server.models.schemas import DAGDefinition


def validate_dag(dag: DAGDefinition, node_defs: dict) -> list[str]:
    """校验 DAG，返回错误列表。空列表表示合法。"""
    errors = []
    node_ids = {n.id for n in dag.nodes}

    # 1. 节点 ID 唯一性
    seen = set()
    for n in dag.nodes:
        if n.id in seen:
            errors.append(f"节点 ID 重复: {n.id}")
        seen.add(n.id)

    # 2. 边引用的节点必须存在
    for e in dag.edges:
        if e.source_id not in node_ids:
            errors.append(f"边的 source_id 不存在: {e.source_id}")
        if e.target_id not in node_ids:
            errors.append(f"边的 target_id 不存在: {e.target_id}")

    # 3. 节点定义必须存在
    for n in dag.nodes:
        if n.definition_id not in node_defs:
            errors.append(f"节点 {n.id} 引用了不存在的定义: {n.definition_id}")

    # 4. 环检测
    if has_cycle(dag):
        errors.append("DAG 中存在环路")

    return errors


def has_cycle(dag: DAGDefinition) -> bool:
    """DFS 三色标记法检测环"""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n.id: WHITE for n in dag.nodes}

    # 邻接表
    adj: dict[str, list[str]] = {n.id: [] for n in dag.nodes}
    for e in dag.edges:
        adj[e.source_id].append(e.target_id)

    def dfs(node_id: str) -> bool:
        color[node_id] = GRAY
        for neighbor in adj.get(node_id, []):
            if color[neighbor] == GRAY:
                return True  # 回边 → 有环
            if color[neighbor] == WHITE and dfs(neighbor):
                return True
        color[node_id] = BLACK
        return False

    for n in dag.nodes:
        if color[n.id] == WHITE:
            if dfs(n.id):
                return True
    return False
