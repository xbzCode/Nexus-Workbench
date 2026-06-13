"""扩展节点同步服务 — 启动时扫描 extensions/nodes/ 目录，将 SKILL.md 注册为 NodeDefinition

流程：
1. 扫描 EXTENSIONS_DIR/nodes/*/SKILL.md
2. 解析 YAML frontmatter（name, description, version 等）
3. Upsert 到 node_definitions 表（按 name 去重）
4. 同步文件附件到 node_files 表
"""

import logging
import os
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import NodeDefinition, NodeFile
from app.services.node_common import (
    detect_resources,
    get_extensions_dir,
    guess_file_type,
    parse_skill_md,
)

logger = logging.getLogger(__name__)


async def sync_extensions(session: AsyncSession, user_id: uuid.UUID) -> int:
    """扫描扩展目录，将 SKILL.md 同步到 node_definitions 表

    Args:
        session: DB session
        user_id: 用于 author_id

    Returns:
        同步的节点数量
    """
    ext_dir = get_extensions_dir()
    if not ext_dir.exists():
        logger.info(f"[ExtensionSync] Extensions dir not found: {ext_dir}")
        return 0

    synced = 0

    # 遍历每个子目录
    for child in sorted(ext_dir.iterdir()):
        if not child.is_dir():
            continue

        skill_md_path = child / "SKILL.md"
        if not skill_md_path.exists():
            continue

        parsed = parse_skill_md(skill_md_path)
        if not parsed:
            continue

        node_name = parsed["name"]

        # 查询是否已存在
        stmt = select(NodeDefinition).where(NodeDefinition.name == node_name)
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # 更新已有记录
            existing.display_name = parsed["display_name"]
            existing.description = parsed["description"]
            existing.category = parsed["category"]
            existing.version = parsed["version"]
            existing.skill_md = parsed["skill_md_text"]
            existing.source_dir = str(child.relative_to(ext_dir).as_posix())
            existing.resources = detect_resources(child)
            existing.status = "published"
            logger.info(f"[ExtensionSync] Updated node: {node_name}")
        else:
            # 创建新记录
            node = NodeDefinition(
                author_id=user_id,
                name=node_name,
                display_name=parsed["display_name"],
                description=parsed["description"],
                category=parsed["category"],
                adapter_type="codebuddy",
                version=parsed["version"],
                skill_md=parsed["skill_md_text"],
                source_dir=str(child.relative_to(ext_dir).as_posix()),
                resources=detect_resources(child),
                status="published",
            )
            session.add(node)
            logger.info(f"[ExtensionSync] Created node: {node_name}")

        # 同步附件文件（templates/ 等）
        await _sync_node_files(session, child, node_name, existing)

        # 关联到 Team（如果 SKILL.md 中指定了 team）
        team_name = parsed.get("team")
        if team_name:
            await _link_node_to_team(session, node_name, team_name)

        synced += 1

    if synced > 0:
        await session.commit()

    logger.info(f"[ExtensionSync] Synced {synced} extension nodes")
    return synced


async def _link_node_to_team(
    session: AsyncSession,
    node_name: str,
    team_name: str,
) -> None:
    """将节点关联到指定 Team

    如果 Team 不存在则静默跳过（不阻塞同步）。
    """
    try:
        from app.services.team_service import get_team_by_name
        from app.models.team import Team

        team = await get_team_by_name(session, team_name)
        if not team:
            logger.warning(
                f"[ExtensionSync] Team '{team_name}' not found, "
                f"skipping team link for node '{node_name}'"
            )
            return

        # 获取节点 ID
        stmt = select(NodeDefinition.id).where(NodeDefinition.name == node_name)
        result = await session.execute(stmt)
        node_row = result.first()
        if not node_row:
            return

        node_id_str = str(node_row[0])

        # 添加到 team 的 node_definition_ids（去重）
        current_ids = list(team.node_definition_ids) if team.node_definition_ids else []
        if node_id_str not in current_ids:
            current_ids.append(node_id_str)
            team.node_definition_ids = current_ids
            logger.info(
                f"[ExtensionSync] Linked node '{node_name}' to Team '{team_name}'"
            )
    except Exception as e:
        logger.warning(
            f"[ExtensionSync] Failed to link node '{node_name}' to Team "
            f"'{team_name}': {e}"
        )


async def _sync_node_files(
    session: AsyncSession,
    node_dir: Path,
    node_name: str,
    existing_node: NodeDefinition | None,
) -> None:
    """同步节点的附件文件（templates/ 等）到 node_files 表"""
    # 查找节点定义 ID
    node_id = existing_node.id if existing_node else None
    if not node_id:
        # 刚 add 的，需要 flush 拿到 ID
        await session.flush()
        stmt = select(NodeDefinition).where(NodeDefinition.name == node_name)
        result = await session.execute(stmt)
        node = result.scalar_one_or_none()
        if node:
            node_id = node.id
        else:
            return

    # 扫描子目录中的文件（如 templates/）
    for root, dirs, files in os.walk(node_dir):
        # 跳过 SKILL.md 本身
        for fname in files:
            fpath = Path(root) / fname
            if fname == "SKILL.md":
                continue

            rel_path = str(fpath.relative_to(node_dir)).replace("\\", "/")

            try:
                content = fpath.read_bytes()
            except Exception:
                continue

            # 判断文件类型
            file_type = guess_file_type(rel_path)

            # Upsert
            stmt = select(NodeFile).where(
                NodeFile.node_definition_id == node_id,
                NodeFile.path == rel_path,
            )
            result = await session.execute(stmt)
            existing_file = result.scalar_one_or_none()

            if existing_file:
                existing_file.content = content
                existing_file.file_type = file_type
            else:
                session.add(NodeFile(
                    node_definition_id=node_id,
                    path=rel_path,
                    file_type=file_type,
                    content=content,
                ))
