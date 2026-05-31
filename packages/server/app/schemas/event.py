"""SSE/WebSocket 事件 schema"""

from pydantic import BaseModel


class SSEEvent(BaseModel):
    event: str
    data: dict
