"""DAG 执行引擎 — 支持 Mock 模式和真实 Adapter 模式

流程：
1. 校验 DAG → 拓扑排序得到执行层级
2. 逐层执行，同层串行（避免并发 CodeBuddy 进程过多）
3. 每个节点：
   - compute_input → evaluate_conditions → execute_node → emit_events
   - Mock 模式：asyncio.sleep(0.5) + 返回 {"status": "completed"}
   - Adapter 模式：通过 Adapter Registry 路由到对应实现
4. 支持审批（ApprovalNeededEvent/QuestionDetectedEvent）→ 暂停等待用户 → resume
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from app.core.dag.model import DAGContext
from app.core.dag.serializer import dag_from_definition
from app.core.dag.validate import DAGValidationError
from app.core.events.bus import Event, EventBus
from app.core.scheduler.condition import ConditionError, evaluate_condition
from app.core.scheduler.data_flow import compute_node_input
from app.core.scheduler.topo_sort import topo_sort
from app.schemas.workflow import DAGDefinition, NodeInstance

logger = logging.getLogger(__name__)


class DAGExecutionError(Exception):
    """DAG 执行错误"""
    pass


async def execute_dag(
    dag: DAGDefinition,
    event_bus: EventBus,
    workflow_input: dict[str, Any] | None = None,
    # 以下参数用于 Adapter 模式
    task_id: uuid.UUID | None = None,
    workspace_dir: str | None = None,
    mock_mode: bool = True,
) -> dict[str, dict[str, Any]]:
    """执行 DAG

    Args:
        dag: DAG 定义
        event_bus: 事件总线
        workflow_input: 工作流输入
        task_id: 任务ID（Adapter 模式需要，用于更新 DB）
        workspace_dir: 工作目录（Adapter 模式需要）
        mock_mode: True=Mock 执行，False=真实 Adapter 执行

    Returns:
        每个节点的输出 {node_id: output_dict}
    """
    # 1. 校验 + 构建 context
    ctx = dag_from_definition(dag)
    event_bus.emit(Event(event_type="dag:validation_passed", data={"node_count": len(dag.nodes)}, task_id=task_id))

    # 2. 拓扑排序
    levels = topo_sort(ctx)
    event_bus.emit(Event(event_type="dag:topo_sorted", data={"levels": [[nid for nid in lv] for lv in levels]}, task_id=task_id))

    # 3. 逐层执行（同层串行，避免 CodeBuddy 进程过多）
    node_outputs: dict[str, dict[str, Any]] = {}
    skipped_nodes: set[str] = set()

    # 构建 node_id → NodeInstance 查找表
    node_map: dict[str, NodeInstance] = {n.id: n for n in dag.nodes}

    # Adapter 模式下需要的 DB session factory
    bg_session_factory = None
    if not mock_mode and task_id:
        from app.config.database import async_session_factory
        bg_session_factory = async_session_factory

    for level_idx, level in enumerate(levels):
        event_bus.emit(Event(
            event_type="dag:level_started",
            data={"level": level_idx, "nodes": level},
            task_id=task_id,
        ))

        for node_id in level:
            if node_id in skipped_nodes:
                continue

            # ── 暂停检查点 ──
            if task_id:
                from app.services.task_service import is_task_paused
                if is_task_paused(task_id):
                    logger.info(f"[DAG] Task {task_id} paused at node={node_id}, stopping execution loop")
                    event_bus.emit(Event(
                        event_type="dag:execution_paused",
                        data={"paused_at_node": node_id, "level": level_idx},
                        task_id=task_id,
                    ))
                    return node_outputs

            try:
                if mock_mode:
                    result = await _execute_node_mock(ctx, node_id, node_outputs, workflow_input, event_bus, skipped_nodes, task_id=task_id)
                else:
                    result = await _execute_node_via_adapter(
                        ctx, node_id, node_outputs, workflow_input, event_bus, skipped_nodes,
                        task_id=task_id,
                        workspace_dir=workspace_dir,
                        node_map=node_map,
                        bg_session_factory=bg_session_factory,
                    )
                node_outputs[node_id] = result
            except Exception as e:
                node_outputs[node_id] = {"status": "failed", "summary": str(e)}
                event_bus.emit(Event(
                    event_type="dag:node_failed",
                    data={"node_id": node_id, "error": str(e)},
                    source=node_id,
                    task_id=task_id,
                ))
                # Adapter 模式下更新 DB
                if not mock_mode and task_id and bg_session_factory:
                    await _update_task_status(task_id, "failed", {"error": str(e)}, bg_session_factory)
                return node_outputs

        event_bus.emit(Event(
            event_type="dag:level_completed",
            data={"level": level_idx, "nodes": level},
            task_id=task_id,
        ))

    event_bus.emit(Event(event_type="dag:execution_completed", data={"outputs": list(node_outputs.keys())}, task_id=task_id))

    # Adapter 模式下更新 DB
    if not mock_mode and task_id and bg_session_factory:
        await _update_task_status(task_id, "completed", node_outputs, bg_session_factory)

    return node_outputs


# ── Mock 执行 ──

async def _execute_node_mock(
    ctx: DAGContext,
    node_id: str,
    node_outputs: dict[str, dict[str, Any]],
    workflow_input: dict[str, Any] | None,
    event_bus: EventBus,
    skipped_nodes: set[str],
    task_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Mock 执行单个节点（迭代2 遗留，仅用于无 Adapter 的测试）"""
    event_bus.emit(Event(event_type="dag:node_started", data={"node_id": node_id}, source=node_id, task_id=task_id))

    # 1. 评估条件边
    should_execute = _evaluate_incoming_conditions(ctx, node_id, node_outputs, skipped_nodes)
    if not should_execute:
        event_bus.emit(Event(
            event_type="dag:node_skipped",
            data={"node_id": node_id, "reason": "条件不满足"},
            source=node_id,
            task_id=task_id,
        ))
        skipped_nodes.add(node_id)
        return {"status": "skipped", "summary": "条件边不满足，跳过执行"}

    # 2. 计算输入
    node_input = compute_node_input(ctx, node_id, node_outputs, workflow_input)

    # 3. Mock 执行
    event_bus.emit(Event(
        event_type="dag:node_executing",
        data={"node_id": node_id, "input": node_input},
        source=node_id,
        task_id=task_id,
    ))

    await asyncio.sleep(0.5)

    node = ctx.get_node(node_id)
    definition_id = node.definition_id if node else "unknown"

    output = {
        "status": "completed",
        "summary": f"Mock executed: {definition_id}",
        "detail": {"input_received": node_input},
    }

    event_bus.emit(Event(
        event_type="dag:node_completed",
        data={"node_id": node_id, "output": output},
        source=node_id,
        task_id=task_id,
    ))

    return output


# ── Adapter 执行 ──

async def _execute_node_via_adapter(
    ctx: DAGContext,
    node_id: str,
    node_outputs: dict[str, dict[str, Any]],
    workflow_input: dict[str, Any] | None,
    event_bus: EventBus,
    skipped_nodes: set[str],
    *,
    task_id: uuid.UUID | None = None,
    workspace_dir: str | None = None,
    node_map: dict[str, NodeInstance] | None = None,
    bg_session_factory=None,
) -> dict[str, Any]:
    """通过真实 Adapter 执行单个节点"""
    event_bus.emit(Event(event_type="dag:node_started", data={"node_id": node_id}, source=node_id, task_id=task_id))

    # 1. 评估条件边
    should_execute = _evaluate_incoming_conditions(ctx, node_id, node_outputs, skipped_nodes)
    if not should_execute:
        event_bus.emit(Event(
            event_type="dag:node_skipped",
            data={"node_id": node_id, "reason": "条件不满足"},
            source=node_id,
            task_id=task_id,
        ))
        skipped_nodes.add(node_id)
        return {"status": "skipped", "summary": "条件边不满足，跳过执行"}

    # 2. 计算输入
    node_input = compute_node_input(ctx, node_id, node_outputs, workflow_input)

    # 3. 获取节点实例
    node_instance = node_map.get(node_id) if node_map else None
    if not node_instance:
        raise DAGExecutionError(f"节点实例不存在: {node_id}")

    # 4. 获取节点定义（从 DB）
    from app.services.node_service import get_node, get_node_by_name
    async with bg_session_factory() as session:
        # 优先按 UUID 查找，失败则按 name 查找
        try:
            node_def = await get_node(session, uuid.UUID(node_instance.definition_id))
        except (ValueError, Exception):
            node_def = None
        if not node_def:
            node_def = await get_node_by_name(session, node_instance.definition_id)
    if not node_def:
        raise DAGExecutionError(f"节点定义不存在: {node_instance.definition_id}")

    # 5. 合并配置
    config = {**(node_def.default_config or {}), **node_instance.config}

    # 6. 获取 Adapter
    from app.adapters.registry import get_adapter, list_adapters
    adapter_type = node_def.adapter_type or "codebuddy"
    adapter = get_adapter(adapter_type)
    if not adapter:
        raise DAGExecutionError(
            f"未注册的 adapter_type: {adapter_type}，可用: {list(list_adapters().keys())}"
        )

    # 6.5 执行 pre_hook 钩子
    if node_instance.hooks:
        pre_hooks = [h for h in node_instance.hooks if h.get("type") in ("on_start", "pre_hook")]
        for hook in pre_hooks:
            hook_name = hook.get("name", "unnamed")
            event_bus.emit(Event(
                event_type="node:hook_started",
                data={"node_id": node_id, "hook_name": hook_name, "hook_type": "pre_hook"},
                source=node_id,
                task_id=task_id,
            ))
            event_bus.emit(Event(
                event_type="node:hook_completed",
                data={"node_id": node_id, "hook_name": hook_name, "hook_type": "pre_hook"},
                source=node_id,
                task_id=task_id,
            ))

    # 6.6 Skill 节点 workspace 准备
    # 如果节点有 resources.skill_entry，则是 skill 节点，需要准备工作环境
    is_skill_node = _is_skill_node(node_def)
    # 解析 source_dir（DB 存的是相对路径，需要转为绝对路径）
    resolved_source_dir = _resolve_source_dir(node_def.source_dir)
    if is_skill_node and workspace_dir:
        await _prepare_skill_workspace(node_def, workspace_dir, node_input, resolved_source_dir)
        await _install_pip_requirements(node_def, resolved_source_dir)

    # 7. 构建 Adapter 配置
    adapter_config = {
        "prompt_template": config.get("prompt_template", "{input}"),
        "input_data": node_input,
        "allowed_tools": config.get("allowed_tools", ""),
        "workspace": workspace_dir or os.path.join(".", "workspace"),
    }

    # 7.1 skill 节点：传递 skill_dir + node_files + 用短 prompt 引导 Agent 读取指令文件
    if is_skill_node:
        adapter_config["skill_dir"] = resolved_source_dir
        # 加载 node_files 并放入 adapter_config
        if bg_session_factory:
            async with bg_session_factory() as fs:
                from app.models.node import NodeFile as NF
                from sqlalchemy import select as sa_select
                result = await fs.execute(
                    sa_select(NF).where(NF.node_definition_id == node_def.id)
                )
                node_files = list(result.scalars().all())
                adapter_config["node_files"] = [
                    {"path": f.path, "content": f.content}
                    for f in node_files
                ]
        # 用短 prompt 引导 Agent 读取 task-instructions.md
        adapter_config["prompt_template"] = (
            "请阅读并执行 .codebuddy/task-instructions.md 中的指令，然后执行 skill。"
            "Read and follow .codebuddy/task-instructions.md, then execute the skill. "
            "用户输入 / User input: {input}"
        )

    # 8. 创建 TaskStep
    if task_id and bg_session_factory:
        async with bg_session_factory() as step_session:
            from app.models.task import TaskStep
            step = TaskStep(
                task_id=task_id,
                node_id=node_id,
                node_definition_id=node_def.id,
                status="running",
                input_data=node_input,
            )
            step_session.add(step)
            await step_session.commit()
            await step_session.refresh(step)
            step_id = step.id

    # 9. 启动 Adapter 会话
    logger.info(f"[DAG] Starting adapter session for node={node_id}, adapter={adapter_type}")
    session_id = await adapter.start_session(adapter_config)

    # 10. 收集事件
    output = {}
    approval_count = 0
    progress_texts = []
    thinking_texts = []

    from app.adapters.events import (
        AgentThinkingEvent, ApprovalNeededEvent, QuestionDetectedEvent,
        ProgressUpdateEvent, ExecutionCompletedEvent,
    )

    async for event in adapter.on_event(session_id):
        if isinstance(event, AgentThinkingEvent):
            thinking_texts.append(event.content)
            event_bus.emit(Event(
                event_type="node:thinking",
                data={"node_id": node_id, "content": event.content[:200]},
                source=node_id,
                task_id=task_id,
            ))

        elif isinstance(event, ProgressUpdateEvent):
            progress_texts.append(event.content)
            event_bus.emit(Event(
                event_type="node:progress",
                data={"node_id": node_id, "content": event.content[:200]},
                source=node_id,
                task_id=task_id,
            ))

        elif isinstance(event, QuestionDetectedEvent):
            # Agent 提问 → LLM 分类 → 创建审批 → 等待用户 → resume
            approval_count += 1
            question_text = event.question[:500]
            logger.info(f"[DAG] Agent question: {question_text[:100]}")
            event_bus.emit(Event(
                event_type="node:question",
                data={"node_id": node_id, "question": question_text,
                      "timestamp": datetime.now(timezone.utc).isoformat()},
                source=node_id,
                task_id=task_id,
            ))
            # 调用 LLM 分类提问类型
            classification = await _classify_approval_type(question_text)
            approval_type = classification.get("type", "input")
            approval_options = classification.get("options") or event.options
            logger.info(f"[DAG] Approval classified: type={approval_type}, options={approval_options}")
            # 创建审批
            approval_id = await _create_and_wait_approval(
                task_id=task_id,
                node_id=node_id,
                step_id=step_id if task_id else None,
                source="agent",
                approval_type=approval_type,
                title=f"Agent 提问: {node_id}",
                description=question_text,
                options=approval_options,
                bg_session_factory=bg_session_factory,
                event_bus=event_bus,
            )
            # 获取审批结果
            result = await _wait_for_approval_db(approval_id, bg_session_factory)
            user_answer = ""
            if result:
                user_answer = result.get("answer", result.get("choice", ""))
                if not user_answer and result.get("approved"):
                    user_answer = "确认，请继续执行"
            if not user_answer:
                user_answer = "请继续执行"
            # Resume
            await adapter.resume_session(session_id, user_answer)

        elif isinstance(event, ApprovalNeededEvent):
            # 高风险操作审批 — type=confirm
            approval_count += 1
            approval_id = await _create_and_wait_approval(
                task_id=task_id,
                node_id=node_id,
                step_id=step_id if task_id else None,
                source="agent",
                approval_type="confirm",
                title=f"Agent 审批: {node_id}",
                description=event.approval.get("description", ""),
                options=event.approval.get("options"),
                bg_session_factory=bg_session_factory,
                event_bus=event_bus,
            )
            result = await _wait_for_approval_db(approval_id, bg_session_factory)
            approved = result and result.get("approved", True)
            if approved:
                await adapter.resume_session(session_id, "用户已确认，请继续执行")
            else:
                raise DAGExecutionError("用户拒绝了 Agent 操作")

        elif isinstance(event, ExecutionCompletedEvent):
            output = event.output

    # 11. 构建输出
    result_text = "\n".join(progress_texts) if progress_texts else ""
    result_thinking = "\n".join(thinking_texts) if thinking_texts else ""
    summary = result_text or result_thinking or "节点执行完成"

    final_output = {
        "status": "completed",
        "summary": summary[:500],
    }
    if result_text:
        final_output["text"] = result_text
    if result_thinking:
        final_output["thinking"] = result_thinking
    if output.get("result"):
        final_output["result"] = output["result"]
    if output.get("cost_usd"):
        final_output["cost_usd"] = output["cost_usd"]

    # 12. 执行 post_hook 钩子
    if node_instance.hooks:
        post_hooks = [h for h in node_instance.hooks if h.get("type") in ("on_success", "on_failure", "post_hook")]
        for hook in post_hooks:
            # on_failure 只在失败时执行，其他总是执行
            hook_type = hook.get("type", "post_hook")
            if hook_type == "on_failure" and final_output.get("status") != "failed":
                continue
            if hook_type == "on_success" and final_output.get("status") == "failed":
                continue
            hook_name = hook.get("name", "unnamed")
            event_bus.emit(Event(
                event_type="node:hook_started",
                data={"node_id": node_id, "hook_name": hook_name, "hook_type": "post_hook"},
                source=node_id,
                task_id=task_id,
            ))
            event_bus.emit(Event(
                event_type="node:hook_completed",
                data={"node_id": node_id, "hook_name": hook_name, "hook_type": "post_hook"},
                source=node_id,
                task_id=task_id,
            ))

    # 13. 更新 TaskStep
    if task_id and bg_session_factory:
        async with bg_session_factory() as step_session:
            from app.models.task import TaskStep
            step = await step_session.get(TaskStep, step_id)
            if step:
                step.status = "completed"
                step.output_data = final_output
                step.approval_count = approval_count
                step.completed_at = datetime.now(timezone.utc)
                await step_session.commit()

    event_bus.emit(Event(
        event_type="dag:node_completed",
        data={"node_id": node_id, "output": final_output},
        source=node_id,
        task_id=task_id,
    ))

    return final_output


# ── 辅助方法 ──

def _evaluate_incoming_conditions(
    ctx: DAGContext,
    node_id: str,
    node_outputs: dict[str, dict[str, Any]],
    skipped_nodes: set[str],
) -> bool:
    """评估入边条件"""
    in_edges = ctx.get_in_edges(node_id)
    if not in_edges:
        return True

    has_condition = any(e.condition for e in in_edges)
    if not has_condition:
        return not all(e.source_id in skipped_nodes for e in in_edges)

    for edge in in_edges:
        if edge.source_id in skipped_nodes:
            continue
        if edge.condition is None:
            return True
        source_output = node_outputs.get(edge.source_id, {})
        try:
            if evaluate_condition(edge.condition, source_output):
                return True
        except ConditionError:
            continue

    return False


async def _create_and_wait_approval(
    *,
    task_id: uuid.UUID | None,
    node_id: str,
    step_id: uuid.UUID | None,
    source: str,
    approval_type: str,
    title: str,
    description: str,
    options: list | None = None,
    bg_session_factory=None,
    event_bus: EventBus | None = None,
) -> uuid.UUID:
    """创建审批记录，返回 approval_id，并通过事件总线推送通知"""
    if not task_id or not bg_session_factory:
        return uuid.uuid4()

    async with bg_session_factory() as session:
        from app.models.approval import Approval
        from app.models.task import Task

        # 从 Task 反查 user_id
        task = await session.get(Task, task_id)
        if not task:
            raise DAGExecutionError(f"Task 不存在: {task_id}")

        approval = Approval(
            task_id=task_id,
            step_id=step_id,
            user_id=task.user_id,
            source=source,
            type=approval_type,
            title=title,
            description=description,
            options=options,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        await session.refresh(approval)

        # 推送审批创建事件
        if event_bus:
            event_bus.emit(Event(
                event_type="approval:created",
                data={
                    "approval_id": str(approval.id),
                    "task_id": str(task_id),
                    "node_id": node_id,
                    "type": approval_type,
                    "title": title,
                    "description": description,
                },
                source=node_id,
                task_id=task_id,
            ))

        return approval.id


async def _wait_for_approval_db(
    approval_id: uuid.UUID,
    bg_session_factory=None,
    timeout: float = 600.0,
) -> dict | None:
    """轮询 DB 等待审批结果（超时自动批准）"""
    import time
    start = time.time()

    while time.time() - start < timeout:
        if not bg_session_factory:
            await asyncio.sleep(1)
            continue

        async with bg_session_factory() as session:
            from app.models.approval import Approval
            approval = await session.get(Approval, approval_id)
            if approval and approval.status in ("approved", "rejected"):
                return approval.result or {"approved": approval.status == "approved"}

        await asyncio.sleep(1)

    # 超时自动批准
    if bg_session_factory:
        async with bg_session_factory() as session:
            from app.models.approval import Approval
            approval = await session.get(Approval, approval_id)
            if approval:
                approval.status = "approved"
                approval.result = {"approved": True, "auto": True, "reason": "timeout"}
                await session.commit()

    return {"approved": True, "auto": True}


async def _update_task_status(
    task_id: uuid.UUID,
    status: str,
    output_data: dict | None,
    bg_session_factory,
) -> None:
    """更新任务状态"""
    async with bg_session_factory() as session:
        from app.models.task import Task
        task = await session.get(Task, task_id)
        if task:
            task.status = status
            task.output_data = output_data
            if status in ("completed", "failed", "cancelled"):
                task.completed_at = datetime.now(timezone.utc)
            await session.commit()


# ── Skill 节点 workspace 准备 ──

# task-instructions.md 模板（引导 Agent 正确读取并执行 skill）
TASK_INSTRUCTIONS_TEMPLATE = """# AgentFlow Skill Node — 任务指令 / Task Instructions

你正在 AgentFlow 工作流中执行一个 Skill 节点。请严格按以下步骤操作：
You are executing a skill-based node in an AgentFlow workflow. Follow these steps IN ORDER:

## 步骤 1 / Step 1
使用 Read 工具读取当前工作区的 `.codebuddy/node-config.json`。
Use the Read tool to read `.codebuddy/node-config.json` in the current workspace.
该文件包含 `skill_path`、`skill_entry`、`skill_dir` 和 `input_data`。

## 步骤 2 / Step 2
使用 Read 工具读取配置中 `skill_path/skill_entry` 指向的 skill 文件，并严格按照其指令执行。
Use the Read tool to read the skill file at `skill_path/skill_entry` from the config.
Follow its instructions EXACTLY.

## 步骤 3 / Step 3
执行 skill。将所有 `${SKILL_DIR}` 替换为配置中的 `skill_dir` 值。
如果 skill 需要用户选择且你处于自动模式，使用默认/推荐选项。

## 关键规则 / Critical Rules
- 不要使用 Skill 工具来调用 skill — 使用 Read 工具读取 SKILL.md 内容
- 不要搜索 skill — 精确路径在 node-config.json 中
- 不要跳过读取 node-config.json — 始终从步骤 1 开始
- 严格按照加载的 skill 工作流执行，不要自行发挥
- 执行 bash 命令时，将 SKILL_DIR 替换为配置中的实际路径
- Do NOT use the Skill tool to invoke skills — use Read tool to load SKILL.md content
- Do NOT search for the skill — the exact path is in node-config.json
- Do NOT skip reading node-config.json — always start from Step 1
- Follow the loaded skill workflow exactly, do NOT improvise
"""


def _is_skill_node(node_def) -> bool:
    """判断节点是否为 skill 节点（有 resources.skill_entry）"""
    resources = node_def.resources or {}
    return bool(resources.get("skill_entry"))


async def _prepare_skill_workspace(
    node_def,
    workspace_dir: str,
    input_data: dict,
    resolved_source_dir: str | None,
) -> None:
    """为 skill 节点准备工作空间

    写入两个文件到 workspace/.codebuddy/：
    1. node-config.json — 包含 skill_path、skill_dir、input_data
    2. task-instructions.md — Agent 启动后的第一步指令
    """
    import json as json_mod
    resources = node_def.resources or {}

    if not resolved_source_dir:
        logger.warning(f"[DAG] Skill node {node_def.name} has no resolvable source_dir, skipping workspace prep")
        return

    codebuddy_dir = os.path.join(workspace_dir, ".codebuddy")
    os.makedirs(codebuddy_dir, exist_ok=True)

    # 1. 写入 node-config.json
    config_path = os.path.join(codebuddy_dir, "node-config.json")
    node_config = {
        "skill_name": node_def.name,
        "skill_path": resolved_source_dir,
        "skill_dir": resolved_source_dir,
        "skill_entry": resources.get("skill_entry", "SKILL.md"),
        "input_data": input_data,
    }
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json_mod.dump(node_config, f, ensure_ascii=False, indent=2)
        logger.info(f"[DAG] Skill node-config written: {config_path}")
    except (TypeError, ValueError) as e:
        logger.error(f"[DAG] Failed to serialize node-config.json: {e}, input_data keys={list(input_data.keys())}")
        # 降级：去掉 input_data 中不可序列化的值
        safe_config = {k: v for k, v in node_config.items() if k != "input_data"}
        safe_config["input_data"] = str(input_data)
        with open(config_path, "w", encoding="utf-8") as f:
            json_mod.dump(safe_config, f, ensure_ascii=False, indent=2)
        logger.info(f"[DAG] Skill node-config written (fallback): {config_path}")

    # 2. 写入 task-instructions.md
    instructions_path = os.path.join(codebuddy_dir, "task-instructions.md")
    with open(instructions_path, "w", encoding="utf-8") as f:
        f.write(TASK_INSTRUCTIONS_TEMPLATE)

    logger.info(f"[DAG] Task instructions written: {instructions_path}")


async def _install_pip_requirements(node_def, resolved_source_dir: str | None) -> None:
    """安装 skill 节点声明的 pip 依赖

    使用 subprocess.Popen + 线程执行，避免 Windows + uvicorn (SelectorEventLoop)
    下 asyncio.create_subprocess_exec 抛 NotImplementedError。
    """
    import sys
    import subprocess

    resources = node_def.resources or {}
    req_file = resources.get("pip_requirements", "")
    if not req_file or not resolved_source_dir:
        return

    # 解析为绝对路径
    if not os.path.isabs(req_file):
        req_file = os.path.join(resolved_source_dir, req_file)

    if not os.path.isfile(req_file):
        logger.info(f"[DAG] pip requirements file not found: {req_file}")
        return

    logger.info(f"[DAG] Installing pip requirements: {req_file}")

    def _run_pip():
        return subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req_file],
            capture_output=True,
            timeout=120,
        )

    try:
        loop = asyncio.get_event_loop()
        proc = await loop.run_in_executor(None, _run_pip)
        if proc.returncode != 0:
            err_text = proc.stderr.decode("utf-8", errors="replace")[:500]
            logger.warning(f"[DAG] pip install failed (rc={proc.returncode}): {err_text}")
        else:
            logger.info(f"[DAG] pip install completed for {node_def.name}")
    except subprocess.TimeoutExpired:
        logger.warning(f"[DAG] pip install timed out for {node_def.name}")
    except Exception as e:
        logger.warning(f"[DAG] pip install error: {e}")


def _resolve_source_dir(source_dir: str | None) -> str | None:
    """将 DB 中的 source_dir（相对路径）解析为绝对路径

    source_dir 存的是相对于 extensions/nodes/ 的路径（如 "architecture-diagram"），
    如果已经是绝对路径（兼容旧数据），直接返回。
    """
    if not source_dir:
        return None

    if os.path.isabs(source_dir):
        if os.path.isdir(source_dir):
            return source_dir
        logger.warning(f"[DAG] source_dir is absolute but not found: {source_dir}")
        return None

    # 相对路径 → 通过 extension_sync 的 get_extensions_dir() 解析
    from app.services.extension_sync import get_extensions_dir
    ext_dir = get_extensions_dir()
    resolved = os.path.join(str(ext_dir), source_dir)
    if os.path.isdir(resolved):
        return resolved

    logger.warning(f"[DAG] Cannot resolve source_dir: {source_dir} → {resolved}")
    return None


# ── LLM 审批类型分类 ──

async def _classify_approval_type(question_text: str) -> dict[str, Any]:
    """调用 LLM 判断 Agent 提问的审批类型

    Returns:
        {"type": "choice"|"input"|"confirm", "options": [...], "reasoning": "..."}
    """
    try:
        from app.core.llm.client import achat
        from app.config.settings import settings

        prompt = f"""分析以下 Agent 提问，判断用户应该如何回应。

Agent 提问：
{question_text}

请判断这个问题属于哪种类型，返回 JSON：

类型说明：
- "choice"：Agent 给用户提供了明确的选项（如"你想用方案A还是方案B？"、"请选择..."）
  需要提取选项列表
- "input"：Agent 要求用户输入具体内容（如"请输入..."、"请描述..."），没有给选项
- "confirm"：Agent 在征求确认或许可（如"是否继续？"、"确认执行？"）

返回格式：
{{
  "type": "choice|input|confirm",
  "options": [
    {{"label": "选项描述", "value": "唯一值"}}
  ],
  "reasoning": "简短说明为什么这样分类"
}}

规则：
- 如果问题中包含选择意味（"还是"、"或者"、"哪种"、"哪个"），但选择项不明确，仍然归为 input
- 只有 Agent 明确列举了 2 个及以上选项时，才归为 choice
- options 数组中 value 用简短英文标识
- 对于 confirm 类型，options 为空数组
- 只返回 JSON，不要其他内容"""

        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=300,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[DAG] _classify_approval_type: LLM 不可用，降级为 input")
            return {"type": "input", "options": [], "reasoning": "LLM 不可用"}

        # 提取 JSON
        if "```" in content:
            parts = content.split("```")
            for p in parts:
                p = p.strip()
                if p.startswith("json"):
                    p = p[4:]
                if p.startswith("{"):
                    content = p
                    break

        result = json.loads(content)
        logger.info(f"[DAG] Approval classified: {result.get('type')}, reason={result.get('reasoning')}")
        return result

    except Exception as e:
        logger.warning(f"[DAG] _classify_approval_type failed: {e}, 降级为 input")
        return {"type": "input", "options": [], "reasoning": f"分类异常: {str(e)[:50]}"}
