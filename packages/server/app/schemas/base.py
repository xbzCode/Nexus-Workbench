"""Pydantic 公共 schema"""

from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """统一 API 响应格式"""

    success: bool = True
    data: T | None = None
    message: str = "ok"
    errors: list[dict[str, Any]] | None = None


class PageParams(BaseModel):
    """分页参数"""

    page: int = 1
    page_size: int = 20

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size
