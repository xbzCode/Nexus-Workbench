"""SSE 事件推送 — 实时推送 DAG 执行事件，支持按 task_id 过滤"""

import asyncio
import json
import uuid

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.core.events.bus import Event, get_event_bus

router = APIRouter()


@router.get("/stream")
async def sse_stream(
    request: Request,
    task_id: uuid.UUID | None = Query(None, description="按任务ID过滤事件"),
):
    """SSE 事件流端点

    客户端连接后持续推送 DAG 执行事件：
    - dag:validation_passed
    - dag:topo_sorted
    - dag:level_started / dag:level_completed
    - dag:node_started / dag:node_completed / dag:node_failed / dag:node_skipped
    - dag:execution_completed
    - node:thinking / node:progress / node:question
    - approval:created / approval:resolved

    支持查询参数：
    - task_id: 仅接收指定任务的事件（精准过滤）
    """
    event_bus = get_event_bus()
    queue = event_bus.subscribe(task_id=task_id) if task_id else event_bus.subscribe()

    async def event_generator():
        try:
            while True:
                # 检查客户端是否断开
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    # 发送心跳
                    yield f": heartbeat\n\n"
                    continue

                data = json.dumps({
                    "event": event.event_type,
                    "data": event.data,
                    "source": event.source,
                    "task_id": str(event.task_id) if event.task_id else None,
                    "timestamp": event.timestamp,
                }, default=str)
                yield f"data: {data}\n\n"
        finally:
            if task_id:
                event_bus.unsubscribe(queue, task_id=task_id)
            else:
                event_bus.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
