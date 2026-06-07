"""DAG 执行引擎 — 支持 Mock 模式和真实 Adapter 模式

流程：
1. 校验 DAG → 拓扑排序得到执行层级
2. 逐层执行，同层串行（避免并发 CodeBuddy 进程过多）
3. 每个节点：
   - compute_input → evaluate_conditions → execute_node → emit_events
   - Mock 模式：asyncio.sleep(0.5) + 返回 {"status": "completed"}
   - Adapter 模式：通过 Adapter Registry 路由到对应实现
4. 支持审批：
   - ToolUseEvent（工具调用）→ LLM 风险评估 → 高风险则暂停等待用户确认 → resume
   - ExecutionCompletedEvent 后调用 LLM 分析 Agent 输出是否包含提问
     → 如有提问：创建审批 → 等待用户 → resume → 继续循环
     → 如无提问：正常完成节点
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

# 任务执行调试日志（写入 task_execution.log）
def _tlog() -> logging.Logger:
    from app.config.logging import get_task_logger
    return get_task_logger()


class DAGExecutionError(Exception):
    """DAG 执行错误"""
    pass


class DAGExecutionPaused(Exception):
    """DAG 执行暂停（等待审批超时，用户需手动恢复）"""
    def __init__(self, message: str = "审批超时，任务已暂停", approval_id=None):
        super().__init__(message)
        self.approval_id = approval_id


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
                # Adapter 模式下先更新 DB，再发事件
                if not mock_mode and task_id and bg_session_factory:
                    await _update_task_status(task_id, "failed", {"error": str(e)}, bg_session_factory)
                event_bus.emit(Event(
                    event_type="dag:node_failed",
                    data={"node_id": node_id, "error": str(e)},
                    source=node_id,
                    task_id=task_id,
                ))
                return node_outputs

        event_bus.emit(Event(
            event_type="dag:level_completed",
            data={"level": level_idx, "nodes": level},
            task_id=task_id,
        ))

    # Adapter 模式下先更新 DB，再发事件（确保前端收到事件时 DB 已更新）
    if not mock_mode and task_id and bg_session_factory:
        await _update_task_status(task_id, "completed", node_outputs, bg_session_factory)

    event_bus.emit(Event(event_type="dag:execution_completed", data={"outputs": list(node_outputs.keys())}, task_id=task_id))

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
    tlog = _tlog()
    tlog.info("─" * 60)
    tlog.info("NODE START | task_id=%s | node_id=%s", task_id, node_id)
    event_bus.emit(Event(event_type="dag:node_started", data={"node_id": node_id}, source=node_id, task_id=task_id))

    # 1. 评估条件边
    should_execute = _evaluate_incoming_conditions(ctx, node_id, node_outputs, skipped_nodes)
    if not should_execute:
        tlog.info("NODE SKIPPED | task_id=%s | node_id=%s | reason=条件不满足", task_id, node_id)
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
    tlog.info("NODE INPUT | task_id=%s | node_id=%s | input=%s",
              task_id, node_id, json.dumps(node_input, ensure_ascii=False, default=str)[:500])

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
    tlog.info("NODE DEF | task_id=%s | node_id=%s | def_name=%s | def_id=%s | adapter=%s | is_skill=%s",
              task_id, node_id, node_def.name, node_def.id, node_def.adapter_type,
              bool((node_def.resources or {}).get("skill_entry")))

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
        await _prepare_skill_workspace(node_def, workspace_dir, node_input, resolved_source_dir, node_id)
        await _install_pip_requirements(node_def, resolved_source_dir)

    # 7. 构建 Adapter 配置
    adapter_config = {
        "prompt_template": config.get("prompt_template", "{input}"),
        "input_data": node_input,
        "allowed_tools": config.get("allowed_tools", ""),
        "workspace": workspace_dir or os.path.join(".", "workspace"),
    }

    # 7.1 skill 节点：写入引导指令，让 Agent 读取 node-config.json 后定位并执行 SKILL.md
    # MVP 版本已验证可行的模式：短 prompt → Agent 读 task-instructions.md → 读 node-config.json
    # → 获取 skill_path（绝对路径）→ 读 SKILL.md → 执行
    if is_skill_node and resolved_source_dir:
        # skill_dir 指向 workspace 本地路径（node_files 已把 SKILL.md 等复制到 .codebuddy/）
        adapter_config["skill_dir"] = os.path.join(workspace_dir, ".codebuddy")
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
        # 用短 prompt 引导 Agent 读取指令文件，长 prompt 通过 cbc -p 传递会被截断
        adapter_config["prompt_template"] = (
            "Read and follow .codebuddy/task-instructions.md, then execute the skill. "
            "User input: {input}"
        )

    # 8. 创建 TaskStep
    step_id: uuid.UUID | None = None
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
    tlog.info("ADAPTER START | task_id=%s | node_id=%s | adapter=%s | workspace=%s",
              task_id, node_id, adapter_type, adapter_config.get("workspace"))
    tlog.debug("ADAPTER CONFIG | prompt_template=%s",
               str(adapter_config.get("prompt_template", ""))[:200])
    session_id = await adapter.start_session(adapter_config)
    tlog.info("ADAPTER SESSION | task_id=%s | node_id=%s | session_id=%s",
              task_id, node_id, session_id)

    # 10. 收集事件 + 审批循环
    # Adapter 层不再做提问检测，所有 agent text 统一作为 ProgressUpdateEvent。
    # 每轮 on_event 结束后（收到 ExecutionCompletedEvent），调用 LLM 分析本轮输出
    # 是否包含提问。如有则创建审批、等待用户、resume，继续下一轮。
    from app.adapters.events import (
        AgentThinkingEvent, ToolUseEvent,
        ProgressUpdateEvent, ExecutionCompletedEvent,
    )

    output: dict[str, Any] = {}
    approval_count = 0
    all_progress_texts: list[str] = []
    all_thinking_texts: list[str] = []

    round_num = 0
    while True:
        round_num += 1
        round_progress: list[str] = []
        round_thinking: list[str] = []
        output = {}
        tlog.info("ROUND START | task_id=%s | node_id=%s | round=%d",
                  task_id, node_id, round_num)

        async for event in adapter.on_event(session_id):
            if isinstance(event, AgentThinkingEvent):
                round_thinking.append(event.content)
                tlog.debug("EVENT THINKING | task_id=%s | node_id=%s | round=%d | len=%d | preview=%s",
                           task_id, node_id, round_num, len(event.content), event.content[:100])
                event_bus.emit(Event(
                    event_type="node:thinking",
                    data={"node_id": node_id, "content": event.content[:200]},
                    source=node_id,
                    task_id=task_id,
                ))

            elif isinstance(event, ProgressUpdateEvent):
                round_progress.append(event.content)
                tlog.debug("EVENT PROGRESS | task_id=%s | node_id=%s | round=%d | len=%d | preview=%s",
                           task_id, node_id, round_num, len(event.content), event.content[:100])
                event_bus.emit(Event(
                    event_type="node:progress",
                    data={"node_id": node_id, "content": event.content[:200]},
                    source=node_id,
                    task_id=task_id,
                ))

            elif isinstance(event, ToolUseEvent):
                # 工具调用 → LLM 风险评估 → 高风险则创建审批
                tlog.info("EVENT TOOL_USE | task_id=%s | node_id=%s | round=%d | tool=%s | input=%s",
                          task_id, node_id, round_num, event.tool_name,
                          json.dumps(event.tool_input, ensure_ascii=False, default=str)[:200])
                risk = await _assess_tool_risk(event.tool_name, event.tool_input)
                tlog.info("TOOL RISK | task_id=%s | node_id=%s | tool=%s | risk=%s",
                          task_id, node_id, event.tool_name,
                          risk.get("risk_level") if risk else "safe")
                if risk and risk.get("risk_level") == "high":
                    approval_count += 1
                    event_bus.emit(Event(
                        event_type="node:risky_tool",
                        data={
                            "node_id": node_id,
                            "tool_name": event.tool_name,
                            "tool_input_summary": json.dumps(event.tool_input, ensure_ascii=False)[:200],
                            "risk_level": "high",
                        },
                        source=node_id,
                        task_id=task_id,
                    ))
                    approval_id = await _create_and_wait_approval(
                        task_id=task_id,
                        node_id=node_id,
                        step_id=step_id,
                        source="agent",
                        approval_type="confirm",
                        title=risk.get("title", f"Agent 请求执行: {event.tool_name}"),
                        description=risk.get("description", ""),
                        options=None,
                        context_data={
                            "tool_name": event.tool_name,
                            "tool_input": event.tool_input,
                            "risk_reasoning": risk.get("reasoning", ""),
                            "node_id": node_id,
                        },
                        bg_session_factory=bg_session_factory,
                        event_bus=event_bus,
                    )
                    result = await _wait_for_approval_db(approval_id, bg_session_factory)
                    if result is None:
                        raise DAGExecutionPaused("审批超时，任务已暂停", approval_id=approval_id)
                    approved = result and result.get("approved", True)
                    if approved:
                        await adapter.resume_session(session_id, "用户已确认，请继续执行")
                    else:
                        raise DAGExecutionError("用户拒绝了 Agent 操作")

            elif isinstance(event, ExecutionCompletedEvent):
                output = event.output

        # 累积本轮文本
        all_progress_texts.extend(round_progress)
        all_thinking_texts.extend(round_thinking)

        tlog.info("ROUND SUMMARY | task_id=%s | node_id=%s | round=%d | progress_chunks=%d | thinking_chunks=%d | output=%s",
                  task_id, node_id, round_num, len(round_progress), len(round_thinking),
                  json.dumps(output, ensure_ascii=False, default=str)[:200])

        # 11. 分析 Agent 输出是否包含提问
        # 同时检查 progress（text 块）和 thinking（推理模型的思考块），
        # 因为 deepseek-reasoner 等推理模型可能将全部输出放在 thinking 块中
        round_text = "\n".join(round_progress)
        round_thinking_text = "\n".join(round_thinking)
        # 以 progress 为主，thinking 为补充（避免推理模型的输出全在 thinking 中）
        analysis_text = round_text if round_text else round_thinking_text
        tlog.info("ANALYZE QUESTION | task_id=%s | node_id=%s | round=%d | text_len=%d | thinking_len=%d | preview=%s",
                  task_id, node_id, round_num, len(round_text), len(round_thinking_text), analysis_text[:300])
        analysis = await _analyze_agent_output(analysis_text)
        tlog.info("ANALYZE RESULT | task_id=%s | node_id=%s | round=%d | analysis=%s",
                  task_id, node_id, round_num,
                  json.dumps(analysis, ensure_ascii=False, default=str) if analysis else "None")

        if analysis and analysis.get("is_question"):
            # Agent 在提问，创建审批等待用户回答
            approval_count += 1
            approval_type = analysis.get("type", "input")
            approval_options = analysis.get("options")
            question_text = analysis.get("question", round_text[:500])

            logger.info(f"[DAG] Agent question detected: type={approval_type}, text={question_text[:100]}")
            event_bus.emit(Event(
                event_type="node:question",
                data={"node_id": node_id, "question": question_text[:500],
                      "timestamp": datetime.now(timezone.utc).isoformat()},
                source=node_id,
                task_id=task_id,
            ))

            approval_id = await _create_and_wait_approval(
                task_id=task_id,
                node_id=node_id,
                step_id=step_id,
                source="agent",
                approval_type=approval_type,
                title=f"Agent 提问: {node_id}",
                description=question_text,
                options=approval_options,
                context_data={
                    "node_id": node_id,
                    "question": question_text,
                    "agent_progress": "\n".join(all_progress_texts[-5:]) if all_progress_texts else "",
                    "analysis": analysis,
                },
                bg_session_factory=bg_session_factory,
                event_bus=event_bus,
            )
            result = await _wait_for_approval_db(approval_id, bg_session_factory)
            if result is None:
                raise DAGExecutionPaused("审批超时，任务已暂停", approval_id=approval_id)
            user_answer = ""
            if result:
                user_answer = result.get("answer", result.get("choice", ""))
                if not user_answer and result.get("approved"):
                    user_answer = "确认，请继续执行"
            if not user_answer:
                user_answer = "请继续执行"
            # Resume adapter session，然后 continue 回到 while True 重新收集事件
            await adapter.resume_session(session_id, user_answer)
            continue
        else:
            # Agent 未提问，正常完成
            tlog.info("ROUND COMPLETE | task_id=%s | node_id=%s | round=%d | no_question_detected",
                      task_id, node_id, round_num)
            break

    # 12. 构建输出
    tlog.info("NODE COMPLETED | task_id=%s | node_id=%s | approval_count=%d | progress_chunks=%d | thinking_chunks=%d",
              task_id, node_id, approval_count, len(all_progress_texts), len(all_thinking_texts))
    result_text = "\n".join(all_progress_texts) if all_progress_texts else ""
    result_thinking = "\n".join(all_thinking_texts) if all_thinking_texts else ""
    summary = result_text or result_thinking or "节点执行完成"
    tlog.info("NODE OUTPUT | task_id=%s | node_id=%s | text_len=%d | thinking_len=%d | summary=%s",
              task_id, node_id, len(result_text), len(result_thinking), summary[:200])

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
    context_data: dict | None = None,
    bg_session_factory=None,
    event_bus: EventBus | None = None,
) -> uuid.UUID:
    """创建审批记录，返回 approval_id，并通过事件总线推送通知"""
    tlog = _tlog()
    if not task_id or not bg_session_factory:
        tlog.warning("APPROVAL SKIPPED | task_id=%s | node_id=%s | reason=no_task_id_or_session_factory",
                     task_id, node_id)
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
            context_data=context_data,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        await session.refresh(approval)

        tlog.info("APPROVAL CREATED | task_id=%s | node_id=%s | approval_id=%s | type=%s | title=%s | desc=%s",
                  task_id, node_id, approval.id, approval_type, title, description[:200])

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
    """轮询 DB 等待审批结果（超时暂停任务，等待用户手动恢复）"""
    import time
    tlog = _tlog()
    start = time.time()
    tlog.info("APPROVAL WAIT | approval_id=%s | timeout=%ds", approval_id, timeout)

    while time.time() - start < timeout:
        if not bg_session_factory:
            await asyncio.sleep(1)
            continue

        async with bg_session_factory() as session:
            from app.models.approval import Approval
            approval = await session.get(Approval, approval_id)
            if approval and approval.status in ("approved", "rejected"):
                elapsed = time.time() - start
                tlog.info("APPROVAL RESOLVED | approval_id=%s | status=%s | elapsed=%.1fs | result=%s",
                          approval_id, approval.status, elapsed,
                          json.dumps(approval.result, ensure_ascii=False, default=str)[:200])
                return approval.result or {"approved": approval.status == "approved"}

        await asyncio.sleep(1)

    # 超时暂停 — 不自动通过，等待用户手动恢复
    tlog.warning("APPROVAL TIMEOUT | approval_id=%s | timeout=%ds", approval_id, timeout)
    if bg_session_factory:
        async with bg_session_factory() as session:
            from app.models.approval import Approval
            approval = await session.get(Approval, approval_id)
            if approval and approval.status == "pending":
                approval.status = "paused"
                approval.result = {"paused": True, "reason": "timeout", "message": "等待用户响应超时，任务已暂停"}
                await session.commit()

    return None


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

def _build_task_instructions() -> str:
    """构建 task-instructions.md 内容（引导 Agent 正确读取并执行 skill）

    所有 skill 文件（SKILL.md, references/, assets/ 等）已通过 node_files
    复制到 workspace/.codebuddy/ 目录，Agent 无需访问外部路径。
    """
    return """# AgentFlow Skill Node — Task Instructions

You are executing a skill-based node in an AgentFlow workflow. Follow these steps IN ORDER:

## Step 1
Use the Read tool to read `.codebuddy/node-config.json` in the current workspace.
This file contains `skill_path`, `skill_entry`, `skill_dir`, and `input_data`.

## Step 2
Use the Read tool to read the skill file at `.codebuddy/{skill_entry}` from the config.
Follow its instructions EXACTLY.

## Step 3
Execute the skill. All skill files (references/, assets/, templates/) are in `.codebuddy/`.
Replace `${SKILL_DIR}` with `.codebuddy` when resolving paths.

## Path Resolution Rules
- All skill files are in the `.codebuddy/` directory within the current workspace
- `skill_path` and `skill_dir` point to `.codebuddy/`
- Relative paths in SKILL.md (e.g., `references/xxx`, `assets/xxx`) should be resolved as `.codebuddy/references/xxx`, `.codebuddy/assets/xxx`

## Critical Rules
- Do NOT use the Skill tool to invoke skills — use Read tool to load SKILL.md content
- Do NOT search for the skill — the exact path is in node-config.json
- Do NOT skip reading node-config.json — always start from Step 1
- Follow the loaded skill workflow exactly, do NOT improvise
- All paths are within the current workspace directory
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
    node_id: str,
) -> None:
    """为 skill 节点准备工作空间

    在 workspace/.codebuddy/ 下写入配置、指令和 SKILL.md 文件。
    node_files 已将 references/、assets/、templates/ 等复制到 .codebuddy/，
    但 SKILL.md 存于 node_definitions.skill_md 字段，需单独写入。
    skill_path/skill_dir 指向 workspace 本地路径，Agent 无需访问外部目录。
    """
    import json as json_mod
    resources = node_def.resources or {}

    if not resolved_source_dir:
        logger.warning(f"[DAG] Skill node {node_def.name} has no resolvable source_dir, skipping workspace prep")
        return

    # 配置目录：统一使用 .codebuddy/
    config_dir = os.path.join(workspace_dir, ".codebuddy")
    os.makedirs(config_dir, exist_ok=True)

    # 1. 写入 node-config.json
    #    skill_path/skill_dir 指向 workspace 本地路径（node_files 已把所有文件复制到此）
    config_path = os.path.join(config_dir, "node-config.json")
    node_config = {
        "skill_name": node_def.name,
        "skill_path": config_dir,
        "skill_dir": config_dir,
        "skill_entry": resources.get("skill_entry", "SKILL.md"),
        "input_data": input_data,
    }
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json_mod.dump(node_config, f, ensure_ascii=False, indent=2)
        logger.info(f"[DAG] Skill node-config written: {config_path}, skill_path={resolved_source_dir}")
    except (TypeError, ValueError) as e:
        logger.error(f"[DAG] Failed to serialize node-config.json: {e}, input_data keys={list(input_data.keys())}")
        # 降级：去掉 input_data 中不可序列化的值
        safe_config = {k: v for k, v in node_config.items() if k != "input_data"}
        safe_config["input_data"] = str(input_data)
        with open(config_path, "w", encoding="utf-8") as f:
            json_mod.dump(safe_config, f, ensure_ascii=False, indent=2)
        logger.info(f"[DAG] Skill node-config written (fallback): {config_path}")

    # 2. 写入 SKILL.md（内容来自 DB 的 node_definitions.skill_md）
    #    node_files 表不包含 SKILL.md（syncer 显式跳过），需单独写入
    skill_md_content = getattr(node_def, "skill_md", None)
    if skill_md_content:
        skill_md_path = os.path.join(config_dir, "SKILL.md")
        with open(skill_md_path, "w", encoding="utf-8") as f:
            f.write(skill_md_content)
        logger.info(f"[DAG] SKILL.md written: {skill_md_path} ({len(skill_md_content)} chars)")

    # 3. 写入 task-instructions.md
    instructions_path = os.path.join(config_dir, "task-instructions.md")
    with open(instructions_path, "w", encoding="utf-8") as f:
        f.write(_build_task_instructions())

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


# ── LLM Agent 输出分析 ──

async def _analyze_agent_output(agent_text: str) -> dict[str, Any] | None:
    """调用 LLM 分析 Agent 输出是否包含提问，并返回结构化类型数据

    一次 LLM 调用完成「是否提问」+「提问类型分类」，避免正则匹配的误判。

    Args:
        agent_text: Agent 本轮输出的文本（多个 ProgressUpdateEvent 拼接）

    Returns:
        None — 文本为空或无需分析（短文本/纯陈述）
        {"is_question": False} — LLM 判定不是提问
        {"is_question": True, "type": ..., "question": ..., "options": [...], "reasoning": ...}
    """
    # ── 快速排除：空文本/极短文本不需要调用 LLM ──
    if not agent_text or len(agent_text.strip()) < 10:
        return None

    # ── 快速排除：纯陈述性文本启发式 ──
    # 如果文本中完全没有问号，且没有任何疑问倾向词，大概率不是提问
    has_question_mark = "？" in agent_text or "?" in agent_text
    _hint_words = ["请选择", "请确认", "请问", "是否", "你想", "你希望", "哪个", "哪种",
                   "would you", "should i", "do you want", "please choose"]
    has_hint = any(w in agent_text.lower() for w in _hint_words)
    if not has_question_mark and not has_hint and len(agent_text) < 80:
        return None

    try:
        from app.core.llm.client import achat
        from app.config.settings import settings

        prompt = f"""分析以下 AI Agent 的输出，判断它是否在向用户提问/请求指示。

Agent 输出：
<<<AGENT_OUTPUT_START>>>
{agent_text[:2000]}
<<<AGENT_OUTPUT_END>>>

请判断并返回 JSON：

判断规则：
1. is_question = true 的情况：
   - Agent 明确向用户提问（如"你想用哪种方案？"、"请确认是否继续"）
   - Agent 列出了选项让用户选择（如"方案A还是方案B？"）
   - Agent 要求用户提供信息（如"请输入项目名称"）
   - Agent 请求许可/确认（如"是否继续执行？"）
   - Agent 要求排序/优先级排列（如"按重要性排序"）

2. is_question = false 的情况：
   - Agent 只是在陈述进度或结果（如"已完成XX"、"正在执行YY"）
   - Agent 在解释或描述某事（如"这是因为..."、"该文件包含..."）
   - Agent 输出的是总结性文字（如"任务执行完毕"、"生成了以下文件"）
   - 文中的问号只是修辞用法或反问（如"为什么不呢？"）而非真正需要用户回答

类型说明（仅 is_question=true 时需要）：
- "choice"：Agent 给了2个及以上明确选项让用户选择
- "input"：Agent 要求用户输入具体内容，没有给选项
- "confirm"：Agent 在征求确认或许可（是/否）
- "ranking"：Agent 要求用户对多个选项排序/排优先级

返回格式：
{{
  "is_question": true/false,
  "type": "choice|input|confirm|ranking",
  "question": "提取出的核心问题（简短摘要，不超过100字）",
  "options": [
    {{"label": "选项描述", "value": "唯一值"}}
  ],
  "reasoning": "简短说明判断依据"
}}

规则：
- options 仅在 type 为 choice 或 ranking 时填充，其他类型为空数组
- options 中 value 用简短英文标识
- question 应该是 Agent 真正需要用户回答的问题，而非简单截取原文
- 只返回 JSON，不要其他内容"""

        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=400,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[DAG] _analyze_agent_output: LLM 不可用，降级为无提问")
            return None

        # ── 提取 JSON ──
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

        # 校验必要字段
        if not isinstance(result, dict) or "is_question" not in result:
            logger.warning(f"[DAG] _analyze_agent_output: LLM 返回格式异常: {content[:200]}")
            return None

        is_q = result.get("is_question", False)
        extra = ""
        if is_q:
            rtype = result.get("type", "")
            rquestion = str(result.get("question", ""))[:80]
            extra = f", type={rtype}, question={rquestion}"
        logger.info(
            f"[DAG] Agent output analyzed: is_question={is_q}{extra}"
            f", reasoning={str(result.get('reasoning', ''))[:80]}"
        )
        return result

    except json.JSONDecodeError as e:
        logger.warning(f"[DAG] _analyze_agent_output: JSON 解析失败: {e}")
        return None
    except Exception as e:
        logger.warning(f"[DAG] _analyze_agent_output: 分析异常: {e}")
        return None


# ── LLM 工具风险评估 ──

# 已知安全的工具（不需要 LLM 评估）
_SAFE_TOOLS = frozenset({
    "Read", "Write", "Edit", "MultiEdit",
    "List", "Search", "Grep", "Glob", "GlobTool",
    "LS", "FileRead", "FileWrite",
})


async def _assess_tool_risk(tool_name: str, tool_input: dict) -> dict[str, Any] | None:
    """调用 LLM 评估工具调用的风险等级

    已知安全的工具直接放行，Bash 及未知工具调用 LLM 做语义风险判断。

    Args:
        tool_name: 工具名称（如 "Bash", "Read"）
        tool_input: 工具参数

    Returns:
        None — 安全，无需审批
        {"risk_level": "low"} — 低风险，记录但不阻塞
        {"risk_level": "high", "type": "confirm", "title": "...", "description": "..."} — 需要审批
    """
    # 1. 已知安全的工具直接放行
    if tool_name in _SAFE_TOOLS:
        return None

    # 2. 非 Bash 且不在安全列表中的工具 — 低风险放行（避免 LLM 调用开销）
    #    未来可根据需要扩展更多工具的风险评估
    if tool_name != "Bash":
        return None

    # 3. Bash 命令 — 调用 LLM 做语义风险评估
    command = str(tool_input.get("command", ""))
    if not command or len(command.strip()) < 3:
        return None

    try:
        from app.core.llm.client import achat
        from app.config.settings import settings

        prompt = f"""评估以下 Bash 命令的风险等级。这是 AI Agent 在自动化工作流中执行的命令。

命令：
<<<COMMAND_START>>>
{command[:1500]}
<<<COMMAND_END>>>

请判断该命令的风险等级，返回 JSON：

风险等级说明：
- "safe"：只读操作或完全无害的命令（如 ls、cat、echo、pwd、which、find、grep、wc、head、tail、curl 纯下载）
- "low"：低风险修改操作（如创建文件/目录、复制文件、安装包、git 操作、设置环境变量）
- "high"：高风险操作，可能导致不可逆的数据丢失或系统变更，需要用户审批：
  - 删除文件/目录（rm、rmdir、del）
  - 格式化/覆盖写入（mkfs、dd、> 覆盖重要文件）
  - 权限修改（chmod 777 等）
  - 危险的管道操作（curl | bash、wget | sh）
  - 强制推送到远程仓库（git push --force）
  - 终止系统进程（kill -9 系统进程）
  - 任何递归/批量删除操作

返回格式：
{{
  "risk_level": "safe|low|high",
  "reasoning": "简短说明判断依据（不超过50字）"
}}

规则：
- 只返回 JSON，不要其他内容
- 如果命令是复合命令（&&、||、; 连接），只要其中任一部分是 high 风险，整体就是 high
- 不确定时，倾向于 low 而非 high（宁可漏判也不误判）"""

        content = await achat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=200,
            timeout=settings.LLM_TIMEOUT,
        )
        if not content:
            logger.warning("[DAG] _assess_tool_risk: LLM 不可用，降级为放行")
            return None

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
        risk_level = result.get("risk_level", "safe")
        reasoning = result.get("reasoning", "")

        logger.info(f"[DAG] Tool risk assessed: {tool_name} risk={risk_level}, cmd={command[:80]}, reasoning={reasoning}")

        if risk_level == "high":
            return {
                "risk_level": "high",
                "type": "confirm",
                "title": f"高风险操作: {command[:60]}",
                "description": f"Agent 请求执行以下命令:\n```\n{command[:500]}\n```\n\n风险评估: {reasoning}",
            }
        elif risk_level == "low":
            return {"risk_level": "low", "reasoning": reasoning}
        # safe — 无需审批
        return None

    except json.JSONDecodeError as e:
        logger.warning(f"[DAG] _assess_tool_risk: JSON 解析失败: {e}")
        return None
    except Exception as e:
        logger.warning(f"[DAG] _assess_tool_risk: 评估异常: {e}")
        return None
