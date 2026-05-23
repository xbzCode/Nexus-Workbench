"""快照 API — 查看快照列表、回滚"""

from fastapi import APIRouter, HTTPException

from server.services.snapshot_service import list_snapshots, rollback_to_snapshot

router = APIRouter(prefix="/api", tags=["snapshots"])


@router.get("/tasks/{task_id}/snapshots")
async def api_list_snapshots(task_id: str):
    """列出任务的所有快照"""
    snapshots = list_snapshots(task_id)
    return [s.model_dump() for s in snapshots]


@router.post("/tasks/{task_id}/snapshots/{snapshot_id}/rollback")
async def api_rollback(task_id: str, snapshot_id: str):
    """回滚到指定快照"""
    ok = await rollback_to_snapshot(task_id, snapshot_id)
    if not ok:
        raise HTTPException(400, "回滚失败：快照不存在或 Git 操作失败")
    return {"rolled_back": True, "snapshot_id": snapshot_id}
