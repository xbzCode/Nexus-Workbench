"""SQLAlchemy async engine + session dependency"""

import logging

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config.settings import settings

# SQLAlchemy 引擎日志：import 阶段即设为 WARNING，防止 engine 创建时 SQL 输出到控制台
# 运行时由 logging.py setup_logging() 统一控制（WARNING+，不单独创建 handler）
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,  # SQL 日志走 Python logging，不靠 echo（echo 无法分级、会双倍输出）
    pool_size=5,
    max_overflow=10,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖注入：获取 async DB session

    注意：commit 由 service 层负责，此处只做 rollback 兜底
    """
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
