"""Git 快照服务 — 步骤执行前后自动创建快照，支持回滚"""

import asyncio
import os
import logging
import subprocess

from server.models.schemas import Snapshot
from server.services.store import store
from server.config import WORKSPACE_DIR

logger = logging.getLogger(__name__)


async def init_git_repo(workspace: str) -> None:
    """在工作目录初始化 Git 仓库"""
    os.makedirs(workspace, exist_ok=True)
    if not os.path.isdir(os.path.join(workspace, ".git")):
        await _git_cmd(workspace, "init")
        await _git_cmd(workspace, 'config user.email "agentflow@local"')
        await _git_cmd(workspace, 'config user.name "AgentFlow"')
        await _git_cmd(workspace, "add -A")
        await _git_cmd(workspace, 'commit --allow-empty -m "init workspace"')
        logger.info(f"Git repo initialized: {workspace}")


async def create_snapshot(task_id: str, step_id: str, snapshot_type: str) -> Snapshot | None:
    """创建 Git 快照"""
    task = store.tasks.get(task_id)
    if not task:
        return None

    workspace = _find_workspace(task_id)
    if not workspace or not os.path.isdir(os.path.join(workspace, ".git")):
        return None

    await _git_cmd(workspace, "add -A")

    commit_msg = f"[agentflow] {snapshot_type} step={step_id}"
    commit_result = await _git_cmd(workspace, f'commit --allow-empty -m "{commit_msg}"')
    if commit_result.startswith("fatal"):
        logger.warning(f"Git commit failed: {commit_result[:200]}")
        return None

    commit_hash = await _git_cmd(workspace, "rev-parse HEAD")
    commit_hash = commit_hash.strip()

    diff = await _git_cmd(workspace, "diff HEAD~1 HEAD")

    untracked_output = await _git_cmd(workspace, "ls-files --others --exclude-standard")
    untracked = [f for f in untracked_output.strip().split("\n") if f]

    snapshot = Snapshot(
        task_id=task_id,
        step_id=step_id,
        type=snapshot_type,
        git_commit_hash=commit_hash,
        git_diff=diff[:10000] if diff else None,
        untracked_files=untracked,
    )
    store.snapshots[snapshot.id] = snapshot
    store.save()

    logger.info(f"Snapshot created: {snapshot.id[:8]} hash={commit_hash[:8]} type={snapshot_type}")
    return snapshot


async def rollback_to_snapshot(task_id: str, snapshot_id: str) -> bool:
    """回滚到指定快照"""
    snapshot = store.snapshots.get(snapshot_id)
    if not snapshot or snapshot.task_id != task_id:
        return False

    workspace = _find_workspace(task_id)
    if not workspace:
        return False

    commit_hash = snapshot.git_commit_hash

    await _git_cmd(workspace, f"reset --hard {commit_hash}")
    await _git_cmd(workspace, "clean -fd")

    logger.info(f"Rollback to snapshot {snapshot_id[:8]}, commit {commit_hash[:8]}")
    return True


def list_snapshots(task_id: str) -> list[Snapshot]:
    """列出任务的所有快照"""
    return [s for s in store.snapshots.values() if s.task_id == task_id]


def _find_workspace(task_id: str) -> str | None:
    """根据 task_id 查找工作目录"""
    task = store.tasks.get(task_id)
    if not task:
        return None
    if task.context.variables.get("workspace"):
        ws = task.context.variables["workspace"]
        if os.path.isdir(ws):
            return ws
    workspace = os.path.join(WORKSPACE_DIR, task_id)
    if os.path.isdir(workspace):
        return workspace
    if os.path.isdir(WORKSPACE_DIR):
        for d in os.listdir(WORKSPACE_DIR):
            full = os.path.join(WORKSPACE_DIR, d)
            if os.path.isdir(full) and os.path.isdir(os.path.join(full, ".git")):
                return full
    return None


async def _git_cmd(workspace: str, args: str) -> str:
    """执行 Git 命令，使用 subprocess.run + asyncio.to_thread。
    注意：git 命令通常是短时操作（<5s），不会导致线程池饥饿。"""
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            f"git {args}",
            cwd=workspace,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            shell=True,
        )
        if result.returncode != 0 and result.stderr:
            return f"fatal: {result.stderr.strip()}"
        return result.stdout
    except subprocess.TimeoutExpired:
        return "fatal: git command timed out after 15s"
    except Exception as e:
        return f"fatal: {e}"
