"""Adapter 注册表 — 按 adapter_type 路由到对应的 Adapter 实现

用法:
    from app.adapters.registry import get_adapter

    adapter = get_adapter("codebuddy")
    session_id = await adapter.start_session(config)

注册新 Adapter:
    from app.adapters.registry import register_adapter
    from app.adapters.claude import claude_adapter

    register_adapter("claude", claude_adapter)
"""

import logging
from typing import Optional

from app.adapters.base import AgentHarnessAdapter

logger = logging.getLogger(__name__)

# 全局注册表：adapter_type → Adapter 实例
_registry: dict[str, AgentHarnessAdapter] = {}


def register_adapter(adapter_type: str, adapter: AgentHarnessAdapter) -> None:
    """注册一个 Adapter 实现"""
    _registry[adapter_type] = adapter
    logger.info(f"[AdapterRegistry] Registered adapter: {adapter_type}")


def get_adapter(adapter_type: str) -> Optional[AgentHarnessAdapter]:
    """按类型获取 Adapter，未找到返回 None"""
    return _registry.get(adapter_type)


def list_adapters() -> dict[str, str]:
    """列出已注册的 Adapter 类型"""
    return {k: type(v).__name__ for k, v in _registry.items()}


def init_adapters() -> None:
    """初始化所有内置 Adapter（在应用启动时调用一次）"""
    # CodeBuddy — 始终注册
    try:
        from app.adapters.codebuddy import codebuddy_adapter
        register_adapter("codebuddy", codebuddy_adapter)
    except ImportError:
        logger.warning("[AdapterRegistry] CodeBuddy adapter import failed")

    # 未来在此处添加其他 Adapter:
    # try:
    #     from app.adapters.claude import claude_adapter
    #     register_adapter("claude", claude_adapter)
    # except ImportError:
    #     pass
