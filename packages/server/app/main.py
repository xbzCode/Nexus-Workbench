"""FastAPI 入口 + 健康检查 + 种子数据"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config.settings import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时初始化日志 + Adapter + 种子数据（PG 不可用时静默跳过）"""
    # 初始化日志系统（必须在最前面）
    from app.config.logging import setup_logging
    setup_logging(log_level=settings.LOG_LEVEL, log_dir=settings.LOG_DIR)
    logger.info("[lifespan] 应用启动: DEBUG=%s, LOG_LEVEL=%s", settings.DEBUG, settings.LOG_LEVEL)

    # 初始化 Adapter Registry
    from app.adapters import init_adapters
    init_adapters()
    logger.info("[lifespan] Adapters initialized")

    try:
        from app.config.database import async_session_factory
        from app.services.user_service import ensure_temp_user
        from app.services.extension_sync import sync_extensions
        from app.services.team_service import ensure_default_teams
        from app.api.deps import TEMP_USER_ID

        async with async_session_factory() as session:
            await ensure_temp_user(session)
            await session.commit()
        logger.info("[lifespan] Seed user ensured")

        # 种子 Team 数据（先创建 Team，再同步扩展节点以便关联）
        async with async_session_factory() as session:
            team_count = await ensure_default_teams(session)
        logger.info("[lifespan] Default teams ensured: %d", team_count)

        # 同步扩展节点（Team 已存在，可正确关联）
        async with async_session_factory() as session:
            count = await sync_extensions(session, TEMP_USER_ID)
        logger.info("[lifespan] Extension nodes synced: %d", count)
    except Exception as e:
        logger.warning("[lifespan] DB not available, skipping seed: %s", e)

    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS — 开发阶段允许前端跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(api_router, prefix=settings.API_PREFIX)


@app.get("/api/health")
async def health_check() -> dict:
    """健康检查 — 验证 DB 连接"""
    db_connected = False
    try:
        from app.config.database import engine
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        db_connected = True
    except Exception:
        pass

    return {
        "status": "ok",
        "db_connected": db_connected,
        "app": settings.APP_NAME,
        "version": "0.1.0",
    }
