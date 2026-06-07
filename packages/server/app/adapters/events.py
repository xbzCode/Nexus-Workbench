"""Adapter 事件定义"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AdapterEvent:
    """基类"""
    pass


@dataclass
class AgentThinkingEvent(AdapterEvent):
    """Agent 思考过程"""
    content: str = ""


@dataclass
class ToolUseEvent(AdapterEvent):
    """Agent 调用工具（由 Engine 层决定是否需要审批）"""
    tool_name: str = ""
    tool_input: dict = field(default_factory=dict)


@dataclass
class ApprovalNeededEvent(AdapterEvent):
    """Agent 需要确认（高风险操作）"""
    approval: dict = field(default_factory=dict)


@dataclass
class ProgressUpdateEvent(AdapterEvent):
    """进度更新"""
    content: str = ""
    progress: float = 0.0


@dataclass
class ExecutionCompletedEvent(AdapterEvent):
    """执行完成"""
    output: dict = field(default_factory=dict)
