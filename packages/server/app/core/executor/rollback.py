"""自动回滚 — 基于快照的回滚逻辑

迭代2: 定义接口和基本流程，真实 Git 集成在迭代5完成
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)


@dataclass
class RollbackResult:
    """回滚结果"""
    success: bool
    snapshot_id: UUID
    message: str = ""
    files_restored: list[str] | None = None


async def perform_rollback(
    snapshot_id: UUID,
    workspace_dir: str | None = None,
) -> RollbackResult:
    """执行回滚到指定快照

    迭代2: 仅记录日志，真实 Git 操作在迭代5实现

    Args:
        snapshot_id: 目标快照 ID
        workspace_dir: 工作目录

    Returns:
        RollbackResult
    """
    logger.info(f"Rollback requested to snapshot {snapshot_id} (mock, not yet implemented)")

    # TODO (迭代5): 真实实现
    # 1. 查找快照记录（获取 git_commit_hash + untracked_files）
    # 2. git reset --hard {hash}
    # 3. 删除 untracked_files
    # 4. 恢复环境变量

    return RollbackResult(
        success=True,
        snapshot_id=snapshot_id,
        message="Rollback mock: logged but not executed (iteration 5)",
    )
