"""根路由注册"""

from fastapi import APIRouter

from app.api.approvals import router as approvals_router
from app.api.describe import router as describe_router
from app.api.events import router as events_router
from app.api.execution_paths import router as execution_paths_router
from app.api.match import router as match_router
from app.api.nodes import router as nodes_router
from app.api.snapshots import router as snapshots_router
from app.api.tasks import router as tasks_router
from app.api.teams import router as teams_router
from app.api.workflows import router as workflows_router

api_router = APIRouter()

api_router.include_router(match_router, prefix="/match", tags=["match"])
api_router.include_router(describe_router, prefix="/describe", tags=["describe"])
api_router.include_router(teams_router, prefix="/teams", tags=["teams"])
api_router.include_router(workflows_router, prefix="/workflows", tags=["workflows"])
api_router.include_router(nodes_router, prefix="/nodes", tags=["nodes"])
api_router.include_router(tasks_router, prefix="/tasks", tags=["tasks"])
api_router.include_router(approvals_router, prefix="/approvals", tags=["approvals"])
api_router.include_router(snapshots_router, prefix="/snapshots", tags=["snapshots"])
api_router.include_router(execution_paths_router, prefix="/execution-paths", tags=["execution-paths"])
api_router.include_router(events_router, prefix="/events", tags=["events"])
