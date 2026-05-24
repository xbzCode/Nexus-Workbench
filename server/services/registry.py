"""节点注册中心 — 扫描 extention/ 目录，自动发现节点"""

import logging
import os
from typing import Optional

from server.config import EXTENSION_DIR, DEFAULT_ALLOWED_TOOLS
from server.models.schemas import NodeDefinition, NodeResources, NodeSetup

logger = logging.getLogger(__name__)

# launcher skill 模板（写入 .codebuddy/skills/_agentflow/SKILL.md）
LAUNCHER_SKILL_CONTENT = """\
# AgentFlow Node Launcher — MANDATORY FIRST STEP

You are executing a skill-based node in an AgentFlow workflow. You MUST follow these steps IN ORDER:

## Step 1: Read Configuration
Use the Read tool to read `.codebuddy/node-config.json`. This contains:
- `skill_path`: the directory containing the skill
- `skill_entry`: the main skill file (e.g. SKILL.md)
- `skill_dir`: same as skill_path, used for ${SKILL_DIR} substitution
- `input_data`: the input for this task

## Step 2: Load Skill Instructions
Use the Read tool to read the file at `{skill_path}/{skill_entry}`.
This is the actual skill — follow its instructions exactly.

## Step 3: Execute the Skill
- Replace all `${SKILL_DIR}` references with the `skill_dir` value from config
- All relative paths should be resolved relative to `skill_path`
- If the skill asks the user questions and you are in headless/automated mode, use recommended/default options automatically
- Input data comes from `input_data` in the config

## CRITICAL RULES
1. Do NOT use the "Skill" tool to invoke skills — use Read tool to load the SKILL.md file content
2. Do NOT search for the skill — the exact path is in node-config.json, just read it
3. Do NOT skip reading node-config.json — always start from Step 1
4. Follow the loaded skill's workflow exactly, do NOT improvise
5. When running bash commands with ${SKILL_DIR}, always substitute the actual path first
"""


def scan_extensions(extension_dir: str | None = None) -> dict[str, NodeDefinition]:
    """扫描 extention/ 下所有含 node.yaml 或 SKILL.md 的子目录，
    返回 {node_id: NodeDefinition}。

    优先级：
    1. 有 node.yaml → 精确加载
    2. 只有 SKILL.md → 自动生成默认 NodeDefinition
    3. 两者都无 → 跳过
    """
    ext_dir = extension_dir or EXTENSION_DIR
    nodes: dict[str, NodeDefinition] = {}

    if not os.path.isdir(ext_dir):
        logger.warning(f"Extension directory not found: {ext_dir}")
        return nodes

    for subdir_name in sorted(os.listdir(ext_dir)):
        subdir_path = os.path.join(ext_dir, subdir_name)
        if not os.path.isdir(subdir_path):
            continue

        # 跳过以 . 开头的目录和 __ 开头的目录
        if subdir_name.startswith(".") or subdir_name.startswith("__"):
            continue

        yaml_path = os.path.join(subdir_path, "node.yaml")
        skill_path = os.path.join(subdir_path, "SKILL.md")

        if os.path.exists(yaml_path):
            node_def = _load_node_yaml(yaml_path, subdir_path)
            if node_def:
                nodes[node_def.id] = node_def
                logger.info(f"[Registry] Loaded node from node.yaml: {node_def.name} ({node_def.id})")
        elif os.path.exists(skill_path):
            node_def = _auto_register_skill(subdir_path, subdir_name)
            if node_def:
                nodes[node_def.id] = node_def
                logger.info(f"[Registry] Auto-registered from SKILL.md: {node_def.name} ({node_def.id})")

    return nodes


def _load_node_yaml(yaml_path: str, source_dir: str) -> Optional[NodeDefinition]:
    """从 node.yaml 加载节点定义"""
    try:
        import yaml
    except ImportError:
        logger.error("[Registry] PyYAML not installed. Run: pip install pyyaml")
        return None

    try:
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not data:
            return None
        return _dict_to_node_def(data, source_dir)
    except Exception as e:
        logger.error(f"[Registry] Failed to load {yaml_path}: {e}")
        return None


def _auto_register_skill(source_dir: str, dir_name: str) -> Optional[NodeDefinition]:
    """从 SKILL.md 自动生成 NodeDefinition"""
    skill_path = os.path.join(source_dir, "SKILL.md")
    if not os.path.exists(skill_path):
        return None

    # 尝试从 SKILL.md 的 frontmatter 中提取元数据
    name = dir_name
    display_name = dir_name.replace("-", " ").replace("_", " ").title()
    description = f"Auto-registered skill from {dir_name}"

    try:
        with open(skill_path, "r", encoding="utf-8") as f:
            content = f.read()

        # 解析 YAML frontmatter
        if content.startswith("---"):
            end = content.find("---", 3)
            if end > 0:
                frontmatter = content[3:end].strip()
                for line in frontmatter.split("\n"):
                    if line.startswith("name:"):
                        name = line.split(":", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("description:"):
                        desc = line.split(":", 1)[1].strip().strip('"').strip("'")
                        if desc:
                            description = desc[:200]
    except Exception:
        pass

    node_id = f"node_ext_{dir_name}"

    # 自动检测 requirements.txt
    pip_requirements = ""
    req_path = os.path.join(source_dir, "requirements.txt")
    if os.path.exists(req_path):
        pip_requirements = "requirements.txt"

    return NodeDefinition(
        id=node_id,
        name=name,
        display_name=display_name,
        description=description,
        category="extension",
        adapter_type="codebuddy",
        default_config={
            "prompt_template": "{input}",
            "allowed_tools": DEFAULT_ALLOWED_TOOLS,
        },
        resources=NodeResources(
            skill_entry="SKILL.md",
            pip_requirements=pip_requirements,
        ),
        setup=NodeSetup(
            pip_requirements=pip_requirements,
        ),
        source_dir=source_dir,
    )


def _dict_to_node_def(data: dict, source_dir: str) -> Optional[NodeDefinition]:
    """将解析后的 dict 转为 NodeDefinition"""
    meta = data.get("meta", data)  # 允许顶层或 meta section
    execution = data.get("execution", {})
    resources_data = execution.get("resources", {})
    setup_data = data.get("setup", execution.get("setup", {}))

    name = meta.get("name", "")
    if not name:
        return None

    # 生成 ID
    node_id = meta.get("id", f"node_ext_{name}")

    # 构建 resources
    resources = NodeResources(
        skill_entry=resources_data.get("skill_entry", ""),
        pip_requirements=resources_data.get("pip_requirements", ""),
    )

    # 构建 setup
    setup = NodeSetup(
        pip_requirements=setup_data.get("pip_requirements", ""),
    )

    # 构建 default_config
    default_config = {}
    if execution.get("prompt_template"):
        default_config["prompt_template"] = execution["prompt_template"]
    elif resources_data.get("skill_entry"):
        # skill 节点没有显式 prompt_template 时，用 {input} 避免 CodeBuddy 误解为要调用 Skill 工具
        default_config["prompt_template"] = "{input}"
    if execution.get("allowed_tools"):
        default_config["allowed_tools"] = execution["allowed_tools"]
    if execution.get("need_approval") is not None:
        default_config["need_approval"] = execution["need_approval"]
    if execution.get("system_prompt_append"):
        default_config["system_prompt_append"] = execution["system_prompt_append"]

    return NodeDefinition(
        id=node_id,
        name=name,
        display_name=meta.get("display_name", name),
        description=meta.get("description", ""),
        category=meta.get("category", "extension"),
        adapter_type=execution.get("adapter_type", "codebuddy"),
        default_config=default_config,
        input_schema=data.get("input_schema", {}),
        output_schema=data.get("output_schema", {}),
        config_schema=data.get("config_schema", {}),
        resources=resources,
        setup=setup,
        source_dir=source_dir,
    )


def get_launcher_skill_content() -> str:
    """返回 launcher skill 的内容"""
    return LAUNCHER_SKILL_CONTENT
