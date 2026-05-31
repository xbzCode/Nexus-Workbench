"""pytest 配置 — async fixture + test DB

核心引擎测试不需要 DB，conftest 只提供 DB 相关 fixture，
实际连接延迟到 fixture 使用时才创建。
"""

import asyncio
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.main import app
from app.models.base import Base


# 测试用 SQLite 内存数据库（延迟创建）
_test_engine = None
_test_session_factory = None


def _get_test_engine():
    global _test_engine, _test_session_factory
    if _test_engine is None:
        try:
            import aiosqlite  # noqa: F401
            TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"
        except ImportError:
            # aiosqlite 未安装时用 aiosgdb (不会真的跑DB测试)
            return None, None
        _test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
        _test_session_factory = async_sessionmaker(
            _test_engine, class_=AsyncSession, expire_on_commit=False
        )
    return _test_engine, _test_session_factory


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=False)
async def setup_db():
    """每个需要 DB 的测试前重建表（显式使用）"""
    engine, _ = _get_test_engine()
    if engine is None:
        pytest.skip("aiosqlite not installed")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    _, factory = _get_test_engine()
    if factory is None:
        pytest.skip("aiosqlite not installed")
    async with factory() as session:
        yield session


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
