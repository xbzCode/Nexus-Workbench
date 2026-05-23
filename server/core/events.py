"""事件总线 — 简单的 asyncio 实现"""

import asyncio
from collections import defaultdict
from typing import Callable, Any


class EventBus:
    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._wildcard_subscribers: list[Callable] = []
        self._queue: asyncio.Queue | None = None

    def subscribe(self, event_type: str, callback: Callable):
        if event_type == "*":
            self._wildcard_subscribers.append(callback)
        else:
            self._subscribers[event_type].append(callback)

    async def emit(self, event_type: str, data: Any = None):
        # 通知订阅者
        for cb in self._subscribers.get(event_type, []):
            try:
                result = cb(event_type, data)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

        # 通知通配符订阅者
        for cb in self._wildcard_subscribers:
            try:
                result = cb(event_type, data)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

        # 放入 SSE 队列
        if self._queue:
            await self._queue.put({"type": event_type, "data": data})

    def set_queue(self, queue: asyncio.Queue):
        self._queue = queue


event_bus = EventBus()
