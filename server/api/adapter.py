"""Adapter 测试 API — 手动触发 CodeBuddy 执行验证"""

import asyncio
import traceback
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Body
from server.adapters.codebuddy import codebuddy_adapter
from server.adapters.events import (
    AgentThinkingEvent, ApprovalNeededEvent,
    ProgressUpdateEvent, ExecutionCompletedEvent,
)

router = APIRouter(prefix="/api/adapter", tags=["adapter"])

# 内存中保存会话事件，供查询
_session_events: dict[str, list[dict]] = {}


class StartSessionRequest(BaseModel):
    prompt: str = "请输出 hello world"
    allowed_tools: str = ""


@router.post("/start")
async def start_session(req: StartSessionRequest = Body(default=None)):
    """启动 CodeBuddy 会话"""
    if req is None:
        req = StartSessionRequest()
    config = {
        "prompt_template": req.prompt,
        "input_data": {},
        "allowed_tools": req.allowed_tools,
    }
    try:
        session_id = await codebuddy_adapter.start_session(config)
    except Exception as e:
        raise HTTPException(500, f"启动失败: {repr(e)}\n{traceback.format_exc()}")

    # 后台监听事件
    _session_events[session_id] = []
    asyncio.create_task(_collect_events(session_id))

    return {"session_id": session_id}


@router.get("/events/{session_id}")
async def get_events(session_id: str):
    """获取会话的所有事件"""
    events = _session_events.get(session_id, [])
    return {"events": events, "count": len(events)}


@router.post("/terminate/{session_id}")
async def terminate_session(session_id: str):
    """终止会话"""
    await codebuddy_adapter.terminate(session_id)
    return {"terminated": True}


async def _collect_events(session_id: str):
    """后台收集事件"""
    try:
        async for event in codebuddy_adapter.on_event(session_id):
            event_dict = _event_to_dict(event)
            _session_events[session_id].append(event_dict)
    except Exception as e:
        _session_events[session_id].append({
            "type": "error",
            "content": str(e),
        })


def _event_to_dict(event) -> dict:
    if isinstance(event, AgentThinkingEvent):
        return {"type": "agent_thinking", "content": event.content[:500]}
    elif isinstance(event, ApprovalNeededEvent):
        return {"type": "approval_needed", "approval": event.approval}
    elif isinstance(event, ProgressUpdateEvent):
        return {"type": "progress", "content": event.content[:500]}
    elif isinstance(event, ExecutionCompletedEvent):
        return {"type": "completed", "output": event.output}
    else:
        return {"type": "unknown", "data": str(event)}
