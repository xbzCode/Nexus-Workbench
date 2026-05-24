"""Adapter 测试 API — 手动触发 Adapter 执行验证"""

import asyncio
import traceback
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Body
from server.adapters.registry import get_adapter, list_adapters
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
    adapter_type: str = "codebuddy"  # 指定 adapter 类型，默认 codebuddy


@router.get("/types")
async def list_adapter_types():
    """列出已注册的 Adapter 类型"""
    return list_adapters()


@router.post("/start")
async def start_session(req: StartSessionRequest = Body(default=None)):
    """启动 Adapter 会话"""
    if req is None:
        req = StartSessionRequest()

    adapter = get_adapter(req.adapter_type)
    if not adapter:
        raise HTTPException(400, f"未注册的 adapter_type: {req.adapter_type}，可用: {list(list_adapters().keys())}")

    config = {
        "prompt_template": req.prompt,
        "input_data": {},
        "allowed_tools": req.allowed_tools,
    }
    try:
        session_id = await adapter.start_session(config)
    except Exception as e:
        raise HTTPException(500, f"启动失败: {repr(e)}\n{traceback.format_exc()}")

    # 后台监听事件
    _session_events[session_id] = []
    asyncio.create_task(_collect_events(session_id, req.adapter_type))

    return {"session_id": session_id}


@router.get("/events/{session_id}")
async def get_events(session_id: str):
    """获取会话的所有事件"""
    events = _session_events.get(session_id, [])
    return {"events": events, "count": len(events)}


@router.post("/terminate/{session_id}")
async def terminate_session(session_id: str, adapter_type: str = "codebuddy"):
    """终止会话"""
    adapter = get_adapter(adapter_type)
    if not adapter:
        raise HTTPException(400, f"未注册的 adapter_type: {adapter_type}")
    await adapter.terminate(session_id)
    return {"terminated": True}


async def _collect_events(session_id: str, adapter_type: str = "codebuddy"):
    """后台收集事件"""
    adapter = get_adapter(adapter_type)
    if not adapter:
        return
    try:
        async for event in adapter.on_event(session_id):
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
