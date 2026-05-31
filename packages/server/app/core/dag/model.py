"""DAG 数据结构定义 — 引擎内部使用的图模型

复用 schemas/workflow.py 的 DAGDefinition/NodeInstance/EdgeDef，
在此基础上提供图操作能力（邻接表、反向邻接表、节点查找等）。
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.schemas.workflow import DAGDefinition, EdgeDef, NodeInstance


@dataclass
class DAGContext:
    """引擎内部的 DAG 上下文，提供图操作方法"""

    dag: DAGDefinition
    # 邻接表：node_id → [EdgeDef]
    adjacency: dict[str, list[EdgeDef]] = field(default_factory=lambda: defaultdict(list), init=False)
    # 反向邻接表：node_id → [EdgeDef]
    reverse_adj: dict[str, list[EdgeDef]] = field(default_factory=lambda: defaultdict(list), init=False)
    # 节点索引：node_id → NodeInstance
    node_map: dict[str, NodeInstance] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        for node in self.dag.nodes:
            self.node_map[node.id] = node
        for edge in self.dag.edges:
            self.adjacency[edge.source_id].append(edge)
            self.reverse_adj[edge.target_id].append(edge)

    # ── 查询方法 ──

    def get_node(self, node_id: str) -> NodeInstance | None:
        return self.node_map.get(node_id)

    def get_out_edges(self, node_id: str) -> list[EdgeDef]:
        return self.adjacency.get(node_id, [])

    def get_in_edges(self, node_id: str) -> list[EdgeDef]:
        return self.reverse_adj.get(node_id, [])

    def get_predecessors(self, node_id: str) -> list[str]:
        """返回所有上游节点 ID"""
        return [e.source_id for e in self.reverse_adj.get(node_id, [])]

    def get_successors(self, node_id: str) -> list[str]:
        """返回所有下游节点 ID"""
        return [e.target_id for e in self.adjacency.get(node_id, [])]

    def root_nodes(self) -> list[str]:
        """返回无入边的根节点 ID"""
        return [n.id for n in self.dag.nodes if not self.reverse_adj.get(n.id)]

    def node_ids(self) -> set[str]:
        return set(self.node_map.keys())

    @classmethod
    def from_dict(cls, dag_dict: dict) -> DAGContext:
        """从 JSONB 字典构建"""
        dag = DAGDefinition(**dag_dict)
        return cls(dag=dag)
