"""节点公共逻辑 — SKILL.md 解析、文件类型判断、资源检测、路径解析

供 extension_sync / node_service / executor 复用，消除重复代码。
"""

import logging
import os
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


# ── 扩展目录 ──


def get_extensions_dir() -> Path:
    """获取扩展目录的绝对路径

    优先使用 settings.EXTENSIONS_DIR（支持环境变量覆盖），
    为空时自动推断：从 server 包向上一级找项目根目录下的 extensions/nodes。
    """
    from app.config.settings import settings

    ext_dir_str = settings.EXTENSIONS_DIR.strip()
    if ext_dir_str:
        ext_dir = Path(ext_dir_str)
        if not ext_dir.is_absolute():
            ext_dir = Path.cwd() / ext_dir
        return ext_dir

    # 自动推断：server_dir=packages/server/app/services → 上 4 级到项目根
    server_dir = Path(__file__).resolve().parent.parent.parent  # packages/server
    project_root = server_dir.parent.parent  # Nexus-Workbench-main
    ext_dir = project_root / "extensions" / "nodes"

    if not ext_dir.exists():
        logger.warning(
            f"[NodeCommon] Auto-inferred extensions dir does not exist: {ext_dir}. "
            f"Set EXTENSIONS_DIR in .env to override."
        )
    return ext_dir


def resolve_source_dir(source_dir: str | None) -> str | None:
    """将 DB 中存储的相对 source_dir 解析为绝对路径

    source_dir 存储的是相对于 extensions/nodes/ 的路径（如 "architecture-diagram"），
    如果已经是绝对路径（兼容旧数据），直接返回。

    Returns:
        绝对路径字符串，或 None（source_dir 为空或解析失败时）
    """
    if not source_dir:
        return None

    if os.path.isabs(source_dir):
        if os.path.isdir(source_dir):
            return source_dir
        logger.warning(f"[NodeCommon] source_dir is absolute but not found: {source_dir}")
        return None

    ext_dir = get_extensions_dir()
    resolved = os.path.join(str(ext_dir), source_dir)
    if os.path.isdir(resolved):
        return resolved

    logger.warning(f"[NodeCommon] Cannot resolve source_dir: {source_dir} → {resolved}")
    return None


# ── SKILL.md 解析 ──


def parse_skill_md_text(text: str) -> dict | None:
    """解析 SKILL.md 文本的 YAML frontmatter，返回结构化字段

    Args:
        text: SKILL.md 完整文本

    Returns:
        dict with keys:
            name, display_name, description, category, team, version,
            skill_md_text, frontmatter
        解析失败返回 None
    """
    if not text.startswith("---"):
        return None

    parts = text.split("---", 2)
    if len(parts) < 3:
        return None

    yaml_text = parts[1].strip()
    try:
        frontmatter = yaml.safe_load(yaml_text)
    except yaml.YAMLError:
        return None

    if not frontmatter or not isinstance(frontmatter, dict):
        return None

    name = frontmatter.get("name")
    if not name:
        return None

    return {
        "name": name,
        "display_name": frontmatter.get("display_name", name.replace("-", " ").title()),
        "description": frontmatter.get("description", ""),
        "category": frontmatter.get("category"),
        "team": frontmatter.get("team"),
        "version": str(frontmatter.get("version", "1.0.0")),
        "skill_md_text": text,
        "frontmatter": frontmatter,
    }


def parse_skill_md(skill_md_path: Path) -> dict | None:
    """从文件路径解析 SKILL.md

    Args:
        skill_md_path: SKILL.md 文件路径

    Returns:
        同 parse_skill_md_text 返回值
    """
    try:
        text = skill_md_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"[NodeCommon] Cannot read {skill_md_path}: {e}")
        return None

    result = parse_skill_md_text(text)
    if not result:
        logger.warning(f"[NodeCommon] Failed to parse SKILL.md at {skill_md_path}")
    return result


# ── 文件类型 & 资源检测 ──


def guess_file_type(rel_path: str) -> str:
    """根据文件路径/后缀猜测文件类型

    Args:
        rel_path: 相对于节点目录的文件路径（如 "templates/report.md"）

    Returns:
        文件类型字符串：template / script / config / skill / asset / other
    """
    fname = rel_path.rsplit("/", 1)[-1]
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


def detect_resources(source_dir: Path) -> dict:
    """检测节点目录下的资源文件

    Returns:
        dict: {"skill_entry": "SKILL.md", "pip_requirements": "requirements.txt"} 或 {}
    """
    resources = {}

    if (source_dir / "SKILL.md").exists():
        resources["skill_entry"] = "SKILL.md"

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
            logger.warning(f"[NodeCommon] Failed to parse node.yaml in {source_dir}: {e}")

    if not resources.get("pip_requirements") and (source_dir / "requirements.txt").exists():
        resources["pip_requirements"] = "requirements.txt"

    return resources
