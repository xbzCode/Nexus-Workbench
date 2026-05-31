"""Adapter 层 — Agent Harness 事件驱动双向交互"""

from app.adapters.registry import get_adapter, register_adapter, list_adapters, init_adapters

__all__ = ["get_adapter", "register_adapter", "list_adapters", "init_adapters"]
