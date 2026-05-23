from __future__ import annotations

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field
import uuid


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now().isoformat()


# ============ DAG 定义 ============

class HookDef(BaseModel):
    type: str = "pre"  # pre | post | on_error
    script: str = ""
    config: dict = {}


class NodeInstance(BaseModel):
    id: str
    definition_id: str
    position: dict = {"x": 0, "y": 0}
    config: dict = {}
    hooks: list[HookDef] = []


class EdgeDef(BaseModel):
    source_id: str
    target_id: str
    condition: str | None = None
    data_mapping: dict | None = None


class DAGDefinition(BaseModel):
    nodes: list[NodeInstance] = []
    edges: list[EdgeDef] = []


# ============ 工作流 ============

class Workflow(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = ""
    description: str = ""
    category: str = "custom"
    dag: DAGDefinition = DAGDefinition()
    input_schema: dict = {}
    output_schema: dict = {}
    version: int = 1
    status: str = "draft"  # draft | published | archived
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


# ============ 节点定义（注册中心） ============

class NodeResources(BaseModel):
    """节点附带的资源引用"""
    skill_entry: str = ""          # SKILL.md 等入口文件名（有此字段 = skill 节点）
    pip_requirements: str = ""     # 需要预装的 pip 依赖文件（相对路径，如 requirements.txt）


class NodeSetup(BaseModel):
    """节点执行前的环境准备"""
    pip_requirements: str = ""     # 相对路径，如 scripts/requirements.txt 或 requirements.txt


class NodeDefinition(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = ""
    display_name: str = ""
    description: str = ""
    category: str = ""
    adapter_type: str = "codebuddy"
    config_schema: dict = {}
    input_schema: dict = {}
    output_schema: dict = {}
    default_config: dict = {}
    resources: NodeResources = NodeResources()    # 资源引用
    setup: NodeSetup = NodeSetup()                # 环境准备
    source_dir: str = ""                          # 来源目录的绝对路径（Registry 扫描时填入）


# ============ 任务 ============

class StepState:
    PENDING = "pending"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ROLLED_BACK = "rolled_back"


class TaskStatus:
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExecutionContext(BaseModel):
    current_step_id: str | None = None
    step_states: dict[str, str] = {}  # node_id -> StepState
    variables: dict = {}
    breakpoints: list[str] = []
    adapter_session_id: str | None = None


class Task(BaseModel):
    id: str = Field(default_factory=new_id)
    title: str = ""
    intent: str = ""
    matched_workflow_id: str | None = None
    status: str = TaskStatus.PENDING
    execution_mode: str = "workflow"  # workflow | bare_agent
    context: ExecutionContext = ExecutionContext()
    input_data: dict = {}
    output_data: dict | None = None
    created_at: str = Field(default_factory=now_iso)
    started_at: str | None = None
    completed_at: str | None = None


# ============ 步骤 ============

class TaskStep(BaseModel):
    id: str = Field(default_factory=new_id)
    task_id: str = ""
    node_id: str = ""
    status: str = StepState.PENDING
    snapshot_id: str | None = None
    input_data: dict = {}
    output_data: dict | None = None
    error: dict | None = None
    retry_count: int = 0
    round_count: int = 0
    approval_count: int = 0
    debug_info: dict | None = None
    started_at: str | None = None
    completed_at: str | None = None


# ============ 快照 ============

class Snapshot(BaseModel):
    id: str = Field(default_factory=new_id)
    task_id: str = ""
    step_id: str = ""
    type: str = "pre_step"  # pre_step | post_step | manual
    git_commit_hash: str = ""
    git_diff: str | None = None
    untracked_files: list[str] = []
    environment: dict = {}
    created_at: str = Field(default_factory=now_iso)


# ============ 确认/待办 ============

class ApprovalSource:
    AGENT = "agent"
    WORKFLOW = "workflow"


class Approval(BaseModel):
    id: str = Field(default_factory=new_id)
    task_id: str = ""
    step_id: str = ""
    source: str = ApprovalSource.AGENT  # agent | workflow
    type: str = "confirm"  # confirm | choice | input
    title: str = ""
    description: str = ""
    options: list[dict] | None = None
    input_schema: dict | None = None
    context_data: dict = {}
    status: str = "pending"  # pending | approved | rejected | expired
    result: dict | None = None
    expires_at: str | None = None
    created_at: str = Field(default_factory=now_iso)
    resolved_at: str | None = None
