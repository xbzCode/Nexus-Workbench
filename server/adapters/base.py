"""Adapter 抽象基类"""

from abc import ABC, abstractmethod
from typing import AsyncIterator

from server.adapters.events import AdapterEvent


class AgentHarnessAdapter(ABC):
    """所有 Agent Harness 的抽象基类 — 事件驱动双向交互模型"""

    @abstractmethod
    async def start_session(self, config: dict) -> str:
        """启动 Agent 会话，返回 session_id"""
        ...

    @abstractmethod
    async def send_input(self, session_id: str, input_data: dict) -> None:
        """向 Agent 发送输入，非阻塞"""
        ...

    @abstractmethod
    async def on_event(self, session_id: str) -> AsyncIterator[AdapterEvent]:
        """监听 Agent 事件流，持续迭代直到会话结束"""
        ...

    @abstractmethod
    async def respond(self, session_id: str, approval_id: str, response: dict) -> None:
        """回复 Agent 的确认请求"""
        ...

    @abstractmethod
    async def terminate(self, session_id: str) -> None:
        """终止 Agent 会话"""
        ...
