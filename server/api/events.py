"""SSE 事件推送 + 匹配 API"""

import asyncio
import json

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server.core.events import event_bus
from server.services.matcher_service import match_workflow

router = APIRouter(prefix="/api", tags=["events", "match"])


@router.get("/events")
async def sse_events(task_id: str = Query(default="")):
    """SSE 实时事件推送"""
    queue = asyncio.Queue()

    # 订阅事件总线
    def on_event(event_type: str, data):
        # 过滤指定 task_id 的事件
        if task_id and data:
            event_task_id = data.get("task_id", "")
            if event_task_id and event_task_id != task_id:
                return
        try:
            queue.put_nowait({"type": event_type, "data": data})
        except asyncio.QueueFull:
            pass

    event_bus.subscribe("*", on_event)

    async def event_stream():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # 心跳
                    yield f": heartbeat\n\n"
        except asyncio.CancelledError:
            pass

    response = StreamingResponse(event_stream(), media_type="text/event-stream")
    return response


class MatchRequest(BaseModel):
    user_input: str = ""


@router.post("/match")
async def api_match(req: MatchRequest):
    """工作流匹配（POST）"""
    result = await match_workflow(req.user_input)
    return result


@router.get("/match")
async def api_match_get(user_input: str = Query(default="")):
    """工作流匹配（GET，简单测试用）"""
    result = await match_workflow(user_input)
    return result
