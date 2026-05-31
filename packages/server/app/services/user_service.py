"""User 服务 — 迭代1最简版"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

# 固定临时用户 ID，与 deps.py 一致
TEMP_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


async def ensure_temp_user(session: AsyncSession) -> User:
    """确保临时用户存在（无认证阶段的种子数据）"""
    user = await session.get(User, TEMP_USER_ID)
    if not user:
        user = User(id=TEMP_USER_ID, username="temp_user")
        session.add(user)
        await session.flush()
    return user
