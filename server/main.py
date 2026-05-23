import asyncio
import logging
import os
import sys
import subprocess

# 确保项目根目录在 sys.path 中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import DATA_DIR, WEB_DIR, WORKSPACE_DIR, CODEBUDDY_PATH, EXTENSION_DIR
from server.services.store import store
from server.services.registry import scan_extensions
from server.api.workflows import router as workflows_router
from server.api.nodes import router as nodes_router
from server.api.dag import router as dag_router
from server.api.adapter import router as adapter_router
from server.api.tasks import router as tasks_router
from server.api.approvals import router as approvals_router
from server.api.snapshots import router as snapshots_router
from server.api.events import router as events_router
from server.api.debug import router as debug_router
from server.api.diag import router as diag_router

app = FastAPI(title="AgentFlow MVP")

# 注册路由
app.include_router(workflows_router)
app.include_router(nodes_router)
app.include_router(dag_router)
app.include_router(adapter_router)
app.include_router(tasks_router)
app.include_router(approvals_router)
app.include_router(snapshots_router)
app.include_router(events_router)
app.include_router(debug_router)
app.include_router(diag_router)


# === 启动时初始化 ===
@app.on_event("startup")
async def startup():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    # 扫描 extention/ 目录，加载节点定义
    extension_nodes = scan_extensions(EXTENSION_DIR)
    store.load(extension_nodes=extension_nodes)


# === 健康检查 ===
@app.get("/api/health")
async def health():
    cbc_available = False
    try:
        result = subprocess.run(
            [CODEBUDDY_PATH, "--version"],
            capture_output=True, text=True, timeout=5,
            encoding="utf-8", errors="replace",
        )
        cbc_available = result.returncode == 0
    except Exception:
        pass

    return {
        "status": "ok",
        "codebuddy_available": cbc_available,
    }


# === 静态文件服务 ===
if os.path.isdir(WEB_DIR):
    app.mount("/vendor", StaticFiles(directory=os.path.join(WEB_DIR, "vendor")), name="vendor")
    app.mount("/assets", StaticFiles(directory=WEB_DIR), name="assets")

    @app.get("/")
    async def index():
        return FileResponse(os.path.join(WEB_DIR, "index.html"))
