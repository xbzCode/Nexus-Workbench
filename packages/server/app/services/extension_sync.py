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

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import NodeDefinition, NodeFile
from app.config.settings import settings

logger = logging.getLogger(__name__)


def get_extensions_dir() -> Path:
    """获取扩展目录的绝对路径

    优先使用 settings.EXTENSIONS_DIR（支持环境变量覆盖），
    为空时自动推断：从 server 包向上一级找项目根目录下的 extensions/nodes。
    """
    ext_dir_str = settings.EXTENSIONS_DIR.strip()
    if ext_dir_str:
        ext_dir = Path(ext_dir_str)
        if not ext_dir.is_absolute():
            # 相对路径 — 基于 cwd 解析
            ext_dir = Path.cwd() / ext_dir
        return ext_dir

    # 自动推断：server_dir=packages/server/app/services → 上 4 级到项目根
    server_dir = Path(__file__).resolve().parent.parent.parent  # packages/server
    project_root = server_dir.parent.parent  # Nexus-Workbench-main
    ext_dir = project_root / "extensions" / "nodes"

    if not ext_dir.exists():
        logger.warning(
            f"[ExtensionSync] Auto-inferred extensions dir does not exist: {ext_dir}. "
            f"Set EXTENSIONS_DIR in .env to override."
        )
    return ext_dir


def parse_skill_md(skill_md_path: Path) -> dict | None:
    """解析 SKILL.md 的 YAML frontmatter + 全文内容

    Returns:
        dict with keys: name, description, version, display_name, category, skill_md_text
        解析失败返回 None
    """
    try:
        text = skill_md_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"[ExtensionSync] Cannot read {skill_md_path}: {e}")
        return None

    # 提取 YAML frontmatter
    if not text.startswith("---"):
        logger.warning(f"[ExtensionSync] No frontmatter in {skill_md_path}")
        return None

    parts = text.split("---", 2)
    if len(parts) < 3:
        logger.warning(f"[ExtensionSync] Invalid frontmatter format in {skill_md_path}")
        return None

    yaml_text = parts[1].strip()
    try:
        frontmatter = yaml.safe_load(yaml_text)
    except yaml.YAMLError as e:
        logger.warning(f"[ExtensionSync] YAML parse error in {skill_md_path}: {e}")
        return None

    if not frontmatter or not isinstance(frontmatter, dict):
        return None

    name = frontmatter.get("name")
    if not name:
        logger.warning(f"[ExtensionSync] Missing 'name' in frontmatter of {skill_md_path}")
        return None

    description = frontmatter.get("description", "")
    version = str(frontmatter.get("version", "1.0.0"))

    return {
        "name": name,
        "display_name": frontmatter.get("display_name", name.replace("-", " ").title()),
        "description": description,
        "category": frontmatter.get("category"),
        "version": version,
        "skill_md_text": text,
        "frontmatter": frontmatter,
    }


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
            existing.resources = _detect_resources(child)
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
                resources=_detect_resources(child),
                status="published",
            )
            session.add(node)
            logger.info(f"[ExtensionSync] Created node: {node_name}")

        # 同步附件文件（templates/ 等）
        await _sync_node_files(session, child, node_name, existing)

        synced += 1

    if synced > 0:
        await session.commit()

    logger.info(f"[ExtensionSync] Synced {synced} extension nodes")
    return synced


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
            file_type = _guess_file_type(rel_path, fname)

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


def _guess_file_type(rel_path: str, fname: str) -> str:
    """根据文件路径/后缀猜测文件类型"""
    if "template" in rel_path.lower():
        return "template"
    if fname.endswith(".py"):
        return "script"
    if fname.endswith((".json", ".yaml", ".yml", ".toml")):
        return "config"
    if fname.endswith((".ts", ".js", ".tsx", ".jsx")):
        return "script"
    if fname.endswith(".md"):
        return "skill"
    if fname.endswith((".png", ".jpg", ".svg", ".gif")):
        return "asset"
    return "other"


def _detect_resources(source_dir: Path) -> dict:
    """检测节点目录下的资源文件

    Returns:
        dict: {"skill_entry": "SKILL.md", "pip_requirements": "requirements.txt"} 或 {}
    """
    resources = {}

    # 有 SKILL.md → 是 skill 节点
    if (source_dir / "SKILL.md").exists():
        resources["skill_entry"] = "SKILL.md"

    # 有 node.yaml → 优先从 yaml 读取 resource 配置
    yaml_path = source_dir / "node.yaml"
    if yaml_path.exists():
        try:
            data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
            exec_data = data.get("execution", {}) if isinstance(data, dict) else {}
            res_data = exec_data.get("resources", {})
            if res_data.get("skill_entry"):
                resources["skill_entry"] = res_data["skill_entry"]
            if res_data.get("pip_requirements"):
                resources["pip_requirements"] = res_data["pip_requirements"]
        except Exception as e:
            logger.warning(f"[ExtensionSync] Failed to parse node.yaml in {source_dir}: {e}")

    # 检测 requirements.txt
    if not resources.get("pip_requirements") and (source_dir / "requirements.txt").exists():
        resources["pip_requirements"] = "requirements.txt"

    return resources


def resolve_source_dir(source_dir: str | None) -> str | None:
    """将 DB 中存储的相对 source_dir 解析为绝对路径

    source_dir 存储的是相对于 extensions/nodes/ 的路径（如 "architecture-diagram"），
    此函数将其拼接为完整绝对路径。

    Returns:
        绝对路径字符串，或 None（source_dir 为空或解析失败时）
    """
    if not source_dir:
        return None

    # 如果已经是绝对路径（兼容旧数据），直接返回
    if os.path.isabs(source_dir):
        if os.path.isdir(source_dir):
            return source_dir
        logger.warning(f"[ExtensionSync] source_dir is absolute but not found: {source_dir}")
        return None

    # 相对路径 → 基于 extensions/nodes/ 解析
    ext_dir = get_extensions_dir()
    resolved = ext_dir / source_dir
    if resolved.is_dir():
        return str(resolved)

    logger.warning(f"[ExtensionSync] Cannot resolve source_dir: {source_dir} → {resolved}")
    return None
