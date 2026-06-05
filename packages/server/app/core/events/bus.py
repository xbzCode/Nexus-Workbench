"""事件总线 — asyncio.Queue 实现的发布/订阅

支持：
- 发布事件（emit）
- 订阅事件（subscribe）
- 按 event_type 过滤
- 按 task_id 过滤
- 超时队列自动清理（防止内存泄漏）
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator

# 队列最大闲置时间（秒），超过此时间未被消费则视为泄漏
_QUEUE_IDLE_TIMEOUT = 300  # 5 minutes


@dataclass
class Event:
    """通用事件"""
    event_type: str
    data: dict[str, Any] = field(default_factory=dict)
    source: str | None = None  # 事件来源（如 node_id）
    task_id: uuid.UUID | None = None  # 所属任务
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())  # 事件时间戳


class _TrackedQueue(asyncio.Queue[Event]):
    """带追踪信息的 Queue，记录最后消费时间和订阅参数"""

    __slots__ = ("last_access", "_sub_event_type", "_sub_task_id")

    def __init__(
        self,
        event_type: str | None = None,
        task_id: uuid.UUID | None = None,
    ) -> None:
        super().__init__()
        self.last_access: float = time.monotonic()
        self._sub_event_type = event_type
        self._sub_task_id = task_id

    def touch(self) -> None:
        self.last_access = time.monotonic()


class EventBus:
    """异步事件总线"""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[_TrackedQueue]] = defaultdict(list)
        self._global_subscribers: list[_TrackedQueue] = []
        self._task_subscribers: dict[uuid.UUID, list[_TrackedQueue]] = defaultdict(list)
        self._all_queues: set[_TrackedQueue] = set()
        self._cleanup_task: asyncio.Task | None = None  # type: ignore[type-arg]

    def _start_cleanup_loop(self) -> None:
        """启动后台清理协程（懒启动）"""
        if self._cleanup_task is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._cleanup_task = loop.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        """定期清理超时队列"""
        while True:
            await asyncio.sleep(60)  # 每 60 秒检查一次
            self._cleanup_idle_queues()

    def _cleanup_idle_queues(self) -> None:
        """清理闲置超时的队列"""
        now = time.monotonic()
        stale = [q for q in self._all_queues if now - q.last_access > _QUEUE_IDLE_TIMEOUT]
        for q in stale:
            self._remove_queue(q)

    def _remove_queue(self, q: _TrackedQueue) -> None:
        """从所有订阅列表中移除队列"""
        self._all_queues.discard(q)
        if q._sub_task_id is not None:
            subs = self._task_subscribers.get(q._sub_task_id, [])
            if q in subs:
                subs.remove(q)
                if not subs:
                    del self._task_subscribers[q._sub_task_id]
        elif q._sub_event_type is None:
            if q in self._global_subscribers:
                self._global_subscribers.remove(q)
        else:
            subs = self._subscribers.get(q._sub_event_type, [])
            if q in subs:
                subs.remove(q)

    def emit(self, event: Event) -> None:
        """发布事件到所有匹配的订阅者"""
        # 按 task_id 订阅（最高优先级，精准匹配）
        if event.task_id is not None:
            for queue in self._task_subscribers.get(event.task_id, []):
                queue.touch()
                queue.put_nowait(event)

        # 按类型订阅
        for queue in self._subscribers.get(event.event_type, []):
            queue.touch()
            queue.put_nowait(event)
        # 全局订阅
        for queue in self._global_subscribers:
            queue.touch()
            queue.put_nowait(event)

    def subscribe(
        self,
        event_type: str | None = None,
        task_id: uuid.UUID | None = None,
    ) -> asyncio.Queue[Event]:
        """订阅事件

        Args:
            event_type: 事件类型，None 表示不按类型过滤
            task_id: 任务ID，指定后只接收该任务的事件

        Returns:
            asyncio.Queue，消费方通过 await queue.get() 获取事件
        """
        self._start_cleanup_loop()
        queue = _TrackedQueue(event_type=event_type, task_id=task_id)
        self._all_queues.add(queue)
        if task_id is not None:
            self._task_subscribers[task_id].append(queue)
        elif event_type is None:
            self._global_subscribers.append(queue)
        else:
            self._subscribers[event_type].append(queue)
        return queue

    def unsubscribe(
        self,
        queue: asyncio.Queue[Event],
        event_type: str | None = None,
        task_id: uuid.UUID | None = None,
    ) -> None:
        """取消订阅"""
        if isinstance(queue, _TrackedQueue):
            self._remove_queue(queue)
            return
        # fallback: 对非 TrackedQueue 的老式调用
        if task_id is not None:
            subs = self._task_subscribers.get(task_id, [])
            if queue in subs:
                subs.remove(queue)
                if not subs:
                    del self._task_subscribers[task_id]
        elif event_type is None:
            if queue in self._global_subscribers:
                self._global_subscribers.remove(queue)
        else:
            subs = self._subscribers.get(event_type, [])
            if queue in subs:
                subs.remove(queue)

    async def events(
        self,
        event_type: str | None = None,
        task_id: uuid.UUID | None = None,
    ) -> AsyncIterator[Event]:
        """异步迭代订阅的事件"""
        queue = self.subscribe(event_type, task_id)
        try:
            while True:
                event = await queue.get()
                if isinstance(queue, _TrackedQueue):
                    queue.touch()
                yield event
        finally:
            self.unsubscribe(queue, event_type, task_id)

    def clear(self) -> None:
        """清空所有订阅"""
        self._subscribers.clear()
        self._global_subscribers.clear()
        self._task_subscribers.clear()
        self._all_queues.clear()

    @property
    def stats(self) -> dict[str, int]:
        """返回当前订阅统计"""
        return {
            "global_subscribers": len(self._global_subscribers),
            "type_subscribers": sum(len(v) for v in self._subscribers.values()),
            "task_subscribers": sum(len(v) for v in self._task_subscribers.values()),
            "total_queues": len(self._all_queues),
        }


# 全局事件总线实例
_event_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """获取全局事件总线"""
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus
