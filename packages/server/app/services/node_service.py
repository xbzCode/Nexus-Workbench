"""NodeDefinition CRUD 服务"""

import io
import logging
import uuid
import zipfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import NodeDefinition, NodeFile, NodeValidation
from app.schemas.node import NodeDefCreate, NodeDefUpdate
from app.services.node_common import (
    detect_resources,
    get_extensions_dir,
    guess_file_type,
    parse_skill_md_text,
)

logger = logging.getLogger(__name__)


async def list_nodes(
    session: AsyncSession,
    category: str | None = None,
    status: str | None = None,
) -> list[NodeDefinition]:
    """查询节点列表

    Args:
        session: DB session
        category: 按分类过滤
        status: 按状态过滤（默认不过滤）
    """
    stmt = select(NodeDefinition).order_by(NodeDefinition.name)
    if category:
        stmt = stmt.where(NodeDefinition.category == category)
    if status:
        stmt = stmt.where(NodeDefinition.status == status)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_node(session: AsyncSession, node_id: uuid.UUID) -> NodeDefinition | None:
    return await session.get(NodeDefinition, node_id)


async def get_node_by_name(session: AsyncSession, name: str) -> NodeDefinition | None:
    """按 name 查询节点定义"""
    stmt = select(NodeDefinition).where(NodeDefinition.name == name)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_node(session: AsyncSession, user_id: uuid.UUID, data: NodeDefCreate) -> NodeDefinition:
    node = NodeDefinition(
        author_id=user_id,
        name=data.name,
        display_name=data.display_name,
        description=data.description,
        category=data.category,
        adapter_type=data.adapter_type,
        config_schema=data.config_schema,
        input_schema=data.input_schema,
        output_schema=data.output_schema,
        default_config=data.default_config,
        skill_md=data.skill_md,
    )
    session.add(node)
    await session.flush()

    if data.validation:
        validation = NodeValidation(
            node_definition_id=node.id,
            commands=data.validation.commands,
            auto_rollback=data.validation.auto_rollback,
            max_retries=data.validation.max_retries,
            retry_backoff=data.validation.retry_backoff,
        )
        session.add(validation)

    await session.commit()
    await session.refresh(node)
    return node


async def update_node(session: AsyncSession, node: NodeDefinition, data: NodeDefUpdate) -> NodeDefinition:
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(node, key, value)
    await session.commit()
    await session.refresh(node)
    return node


async def check_node_references(session: AsyncSession, node: NodeDefinition) -> list[str]:
    """检查节点的引用关系，返回引用来源描述列表

    用于判断节点是否可安全硬删。
    """
    refs: list[str] = []
    node_id_str = str(node.id)

    # 1. TaskStep FK 引用
    from app.models.task import TaskStep
    stmt = select(TaskStep.id).where(TaskStep.node_definition_id == node.id).limit(1)
    result = await session.execute(stmt)
    if result.first():
        refs.append("已被任务步骤引用")

    # 2. Team JSONB 引用
    from app.models.team import Team
    stmt = select(Team.name, Team.display_name).where(
        Team.node_definition_ids.contains([node_id_str])
    )
    result = await session.execute(stmt)
    for row in result.all():
        refs.append(f"已被 Team「{row.display_name or row.name}」关联")

    return refs


async def deprecate_node(session: AsyncSession, node: NodeDefinition) -> NodeDefinition:
    """软删除：将节点标记为 deprecated"""
    node.status = "deprecated"
    await session.commit()
    await session.refresh(node)
    return node


async def restore_node(session: AsyncSession, node: NodeDefinition) -> NodeDefinition:
    """恢复：将节点从 deprecated 恢复为 published"""
    node.status = "published"
    await session.commit()
    await session.refresh(node)
    return node


async def delete_node_permanently(session: AsyncSession, node: NodeDefinition) -> None:
    """硬删除节点及其子表数据（NodeFile + NodeValidation）+ 磁盘文件

    前置条件：无任何引用关系（需先调用 check_node_references 确认）。
    """
    import shutil

    from sqlalchemy import delete as sa_delete

    # 删除子表
    await session.execute(
        sa_delete(NodeFile).where(NodeFile.node_definition_id == node.id)
    )
    await session.execute(
        sa_delete(NodeValidation).where(NodeValidation.node_definition_id == node.id)
    )

    # 从 Team 的 node_definition_ids 中移除（JSONB 清理，不是硬引用）
    from app.models.team import Team
    node_id_str = str(node.id)
    stmt = select(Team).where(Team.node_definition_ids.contains([node_id_str]))
    result = await session.execute(stmt)
    for team in result.scalars().all():
        team.node_definition_ids = [
            nid for nid in (team.node_definition_ids or [])
            if nid != node_id_str
        ]

    # 删除磁盘文件（extensions/nodes/{source_dir}/）
    if node.source_dir:
        ext_dir = get_extensions_dir()
        node_disk_dir = ext_dir / node.source_dir
        if node_disk_dir.exists() and node_disk_dir.is_dir():
            # 安全校验：确保删除路径在 extensions/nodes 下，防止路径逃逸
            try:
                node_disk_dir.resolve().relative_to(ext_dir.resolve())
            except ValueError:
                logger.warning(
                    f"[NodeDelete] Skipping unsafe source_dir: {node.source_dir} "
                    f"(resolves outside extensions/nodes)"
                )
            else:
                shutil.rmtree(node_disk_dir)
                logger.info(f"[NodeDelete] Removed disk dir: {node_disk_dir}")

    # 删除节点自身
    await session.delete(node)
    await session.commit()


# ── ZIP 上传导入 ──


def _find_skill_md_in_zip(zf: zipfile.ZipFile) -> str | None:
    """在 ZIP 中查找 SKILL.md 文件的完整路径

    优先级：
    1. 根目录下的 SKILL.md
    2. 任意子目录下的 SKILL.md（取第一个）
    """
    names = zf.namelist()

    # 根目录直接有 SKILL.md
    if "SKILL.md" in names:
        return "SKILL.md"

    # 子目录中查找
    for name in names:
        basename = name.rsplit("/", 1)[-1]
        if basename == "SKILL.md" and not name.startswith("__MACOSX"):
            return name

    return None


async def upload_node_from_zip(
    session: AsyncSession,
    user_id: uuid.UUID,
    zip_bytes: bytes,
) -> NodeDefinition:
    """从 ZIP 包导入节点

    流程：
    1. 校验 ZIP 中是否存在 SKILL.md
    2. 解析 SKILL.md 的 YAML frontmatter
    3. 解压 ZIP 到 extensions/nodes/{name}/（供执行引擎读取模板等文件）
    4. Upsert NodeDefinition（含 source_dir）
    5. 同步附件文件到 node_files 表

    Raises:
        ValueError: ZIP 无效、缺少 SKILL.md、frontmatter 解析失败
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as e:
        raise ValueError("无效的 ZIP 文件") from e

    # 1. 查找 SKILL.md
    skill_path = _find_skill_md_in_zip(zf)
    if not skill_path:
        zf.close()
        raise ValueError("ZIP 包中未找到 SKILL.md 文件，无法导入")

    # 2. 解析 SKILL.md（复用 node_common）
    skill_md_text = zf.read(skill_path).decode("utf-8")
    parsed = parse_skill_md_text(skill_md_text)
    if not parsed:
        zf.close()
        raise ValueError("SKILL.md 格式无效：缺少 YAML frontmatter 或 name 字段")

    node_name = parsed["name"]

    # 计算 SKILL.md 所在的目录前缀（如 "resume-generator/" 或 ""）
    skill_dir = skill_path.rsplit("/", 1)[0] + "/" if "/" in skill_path else ""

    # 3. 解压 ZIP 到 extensions/nodes/{name}/
    ext_dir = get_extensions_dir()
    node_disk_dir = ext_dir / node_name
    _extract_zip_to_dir(zf, skill_dir, node_disk_dir)
    logger.info(f"[NodeUpload] Extracted to {node_disk_dir}")

    # 4. Upsert NodeDefinition（含 source_dir 和 resources）
    resources = detect_resources(node_disk_dir)

    stmt = select(NodeDefinition).where(NodeDefinition.name == node_name)
    result = await session.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        existing.display_name = parsed["display_name"]
        existing.description = parsed["description"]
        existing.category = parsed["category"]
        existing.version = parsed["version"]
        existing.skill_md = parsed["skill_md_text"]
        existing.status = "published"
        existing.source_dir = node_name
        existing.resources = resources
        node = existing
        logger.info(f"[NodeUpload] Updated node: {node_name}")
    else:
        node = NodeDefinition(
            author_id=user_id,
            name=node_name,
            display_name=parsed["display_name"],
            description=parsed["description"],
            category=parsed["category"],
            adapter_type="codebuddy",
            version=parsed["version"],
            skill_md=parsed["skill_md_text"],
            status="published",
            source_dir=node_name,
            resources=resources,
        )
        session.add(node)
        await session.flush()
        logger.info(f"[NodeUpload] Created node: {node_name}")

    # 5. 同步附件文件到 node_files 表
    for entry in zf.namelist():
        # 跳过目录、SKILL.md 本身、macOS 隐藏文件
        if entry.endswith("/"):
            continue
        if entry == skill_path:
            continue
        if entry.startswith("__MACOSX"):
            continue
        # 只处理 SKILL.md 同目录及子目录下的文件
        if not entry.startswith(skill_dir):
            continue
        # 计算相对路径（去掉 SKILL.md 所在目录前缀）
        rel_path = entry[len(skill_dir):] if skill_dir else entry

        try:
            content = zf.read(entry)
        except Exception:
            continue

        file_type = guess_file_type(rel_path)

        # Upsert node_file
        stmt = select(NodeFile).where(
            NodeFile.node_definition_id == node.id,
            NodeFile.path == rel_path,
        )
        result = await session.execute(stmt)
        existing_file = result.scalar_one_or_none()

        if existing_file:
            existing_file.content = content
            existing_file.file_type = file_type
        else:
            session.add(NodeFile(
                node_definition_id=node.id,
                path=rel_path,
                file_type=file_type,
                content=content,
            ))

    zf.close()
    await session.commit()
    await session.refresh(node)
    return node


def _extract_zip_to_dir(
    zf: zipfile.ZipFile,
    skill_dir: str,
    target_dir: Path,
) -> None:
    """将 ZIP 中 SKILL.md 所在目录下的所有文件解压到 target_dir

    Args:
        zf: 已打开的 ZipFile
        skill_dir: SKILL.md 所在的目录前缀，如 "resume-generator/" 或 ""
        target_dir: 目标目录，如 extensions/nodes/resume-generator/
    """
    target_dir.mkdir(parents=True, exist_ok=True)

    for entry in zf.namelist():
        if entry.endswith("/"):
            continue
        if entry.startswith("__MACOSX"):
            continue
        # 只处理 SKILL.md 同目录及子目录下的文件
        if not entry.startswith(skill_dir):
            continue

        # 计算相对路径
        rel_path = entry[len(skill_dir):] if skill_dir else entry
        if not rel_path:  # 跳过空路径
            continue

        # 构建目标路径并确保安全（防止 zip slip）
        dest = (target_dir / rel_path).resolve()
        if not str(dest).startswith(str(target_dir.resolve())):
            logger.warning(f"[NodeUpload] Skipping unsafe path: {rel_path}")
            continue

        # 创建父目录
        dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            with zf.open(entry) as src, open(dest, "wb") as dst:
                dst.write(src.read())
        except Exception as e:
            logger.warning(f"[NodeUpload] Failed to extract {rel_path}: {e}")
