"""JSON 文件存储 — 内存缓存 + 持久化"""

import json
import os

from server.config import STORE_FILE, DATA_DIR
from server.models.schemas import (
    Workflow, NodeDefinition, Task, TaskStep, Snapshot, Approval
)


class Store:
    """内存缓存 + JSON 文件持久化"""

    def __init__(self):
        self.workflows: dict[str, Workflow] = {}
        self.nodes: dict[str, NodeDefinition] = {}
        self.tasks: dict[str, Task] = {}
        self.steps: dict[str, TaskStep] = {}
        self.snapshots: dict[str, Snapshot] = {}
        self.approvals: dict[str, Approval] = {}

    def load(self, extension_nodes: dict[str, NodeDefinition] | None = None):
        """从文件加载，文件不存在则创建默认"""
        os.makedirs(DATA_DIR, exist_ok=True)

        if os.path.exists(STORE_FILE):
            with open(STORE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = {}

        self.workflows = {k: Workflow(**v) for k, v in data.get("workflows", {}).items()}
        self.tasks = {k: Task(**v) for k, v in data.get("tasks", {}).items()}
        self.steps = {k: TaskStep(**v) for k, v in data.get("steps", {}).items()}
        self.snapshots = {k: Snapshot(**v) for k, v in data.get("snapshots", {}).items()}
        self.approvals = {k: Approval(**v) for k, v in data.get("approvals", {}).items()}

        # 节点定义：Registry 扫描结果优先，store.json 中的用户自定义节点补充
        self.nodes = {}
        # 先加载 store.json 中的节点（用户自定义或旧数据）
        for k, v in data.get("nodes", {}).items():
            self.nodes[k] = NodeDefinition(**v)
        # extension 节点覆盖（registry 扫描结果为准，避免旧数据覆盖新 schema）
        if extension_nodes:
            for nid, nd in extension_nodes.items():
                self.nodes[nid] = nd

        self.save()

    def save(self):
        """持久化到文件"""
        data = {
            "workflows": {k: v.model_dump() for k, v in self.workflows.items()},
            "nodes": {k: v.model_dump() for k, v in self.nodes.items()},
            "tasks": {k: v.model_dump() for k, v in self.tasks.items()},
            "steps": {k: v.model_dump() for k, v in self.steps.items()},
            "snapshots": {k: v.model_dump() for k, v in self.snapshots.items()},
            "approvals": {k: v.model_dump() for k, v in self.approvals.items()},
        }
        with open(STORE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)


# 全局单例
store = Store()
