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
class ApprovalNeededEvent(AdapterEvent):
    """Agent 需要确认（高风险操作）"""
    approval: dict = field(default_factory=dict)


@dataclass
class QuestionDetectedEvent(AdapterEvent):
    """Agent 提问/不确定，需要用户回答后继续"""
    question: str = ""
    options: list = field(default_factory=list)
    context_data: dict = field(default_factory=dict)


@dataclass
class ProgressUpdateEvent(AdapterEvent):
    """进度更新"""
    content: str = ""
    progress: float = 0.0


@dataclass
class ExecutionCompletedEvent(AdapterEvent):
    """执行完成"""
    output: dict = field(default_factory=dict)
