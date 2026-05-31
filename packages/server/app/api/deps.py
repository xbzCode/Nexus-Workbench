"""API 依赖注入"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.config.database import get_session

# 临时：无认证时使用固定用户 ID，认证迭代时替换
TEMP_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

__all__ = ["get_session", "TEMP_USER_ID"]
