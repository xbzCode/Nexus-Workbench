"""JSON 文件存储 — 内存缓存 + 持久化"""

import json
import os

from server.config import STORE_FILE, DATA_DIR
from server.models.schemas import (
    Workflow, NodeDefinition, Task, TaskStep, Snapshot, Approval
)


# 预置工作流
BUILTIN_WORKFLOWS: list[dict] = [
    {
        "id": "wf_bug_fix",
        "name": "Bug修复流程",
        "description": "分析Bug → 修复代码 → 验证结果，适用于已知Bug的修复场景",
        "category": "fix",
        "status": "published",
        "dag": {
            "nodes": [
                {
                    "id": "bug_analyze",
                    "definition_id": "node_def_bug_fix",
                    "position": {"x": 100, "y": 100},
                    "config": {},
                    "hooks": [],
                },
                {
                    "id": "bug_fix_code",
                    "definition_id": "node_def_code_generation",
                    "position": {"x": 100, "y": 260},
                    "config": {
                        "prompt_template": "根据上级节点的分析结果，修复工作目录 {workspace} 中的Bug。上级输出: {previous_output}\n请直接修改代码并验证修复结果。",
                    },
                    "hooks": [],
                },
                {
                    "id": "bug_review",
                    "definition_id": "node_def_code_review",
                    "position": {"x": 100, "y": 420},
                    "config": {
                        "need_approval": True,
                        "prompt_template": "请审查工作目录 {workspace} 中刚修复的代码。上级输出: {previous_output}\n重点审查: 修复是否正确、是否引入新问题、代码质量。",
                    },
                    "hooks": [],
                },
            ],
            "edges": [
                {"source_id": "bug_analyze", "target_id": "bug_fix_code", "condition": None, "data_mapping": None},
                {"source_id": "bug_fix_code", "target_id": "bug_review", "condition": None, "data_mapping": None},
            ],
        },
    },
    {
        "id": "wf_feature_dev",
        "name": "需求开发流程",
        "description": "代码生成 → 代码审查，适用于新功能开发场景",
        "category": "development",
        "status": "published",
        "dag": {
            "nodes": [
                {
                    "id": "dev_gen",
                    "definition_id": "node_def_code_generation",
                    "position": {"x": 100, "y": 100},
                    "config": {},
                    "hooks": [],
                },
                {
                    "id": "dev_review",
                    "definition_id": "node_def_code_review",
                    "position": {"x": 100, "y": 260},
                    "config": {
                        "need_approval": True,
                    },
                    "hooks": [],
                },
            ],
            "edges": [
                {"source_id": "dev_gen", "target_id": "dev_review", "condition": None, "data_mapping": None},
            ],
        },
    },
]


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

        # 预置工作流：确保内置工作流存在
        for wf_data in BUILTIN_WORKFLOWS:
            if wf_data["id"] not in self.workflows:
                self.workflows[wf_data["id"]] = Workflow(**wf_data)

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
