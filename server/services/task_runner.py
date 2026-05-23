"""任务执行器 — DAG 引擎 + CodeBuddy Adapter 串联"""

import asyncio
import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)

from server.models.schemas import (
    Task, TaskStep, StepState, TaskStatus, ExecutionContext,
    Workflow, NodeInstance, Approval, ApprovalSource,
)
from server.services.store import store
from server.services.snapshot_service import init_git_repo, create_snapshot
from server.services.approval import create_approval, resolve_approval
from server.services.registry import get_launcher_skill_content
from server.config import WORKSPACE_DIR
from server.adapters.codebuddy import codebuddy_adapter
from server.adapters.events import (
    AgentThinkingEvent, ApprovalNeededEvent,
    ProgressUpdateEvent, ExecutionCompletedEvent,
)
from server.core.scheduler import topological_sort, evaluate_condition, resolve_data_mapping
from server.core.events import event_bus


async def create_task(title: str, intent: str, workflow_id: str | None = None,
                      input_data: dict | None = None) -> Task:
    """创建任务"""
    task = Task(
        title=title,
        intent=intent,
        matched_workflow_id=workflow_id,
        input_data=input_data or {},
    )
    # 创建任务工作目录（以 task_id 命名）
    workspace_dir = os.path.join(WORKSPACE_DIR, task.id)
    os.makedirs(workspace_dir, exist_ok=True)
    task.context.variables["workspace"] = workspace_dir

    store.tasks[task.id] = task
    store.save()
    await event_bus.emit("task:created", {"task_id": task.id})
    return task


async def start_task(task_id: str) -> Task:
    """启动任务执行"""
    task = store.tasks.get(task_id)
    if not task:
        raise ValueError(f"任务不存在: {task_id}")

    if task.status != TaskStatus.PENDING:
        raise ValueError(f"任务状态不是 pending: {task.status}")

    task.status = TaskStatus.RUNNING
    task.started_at = datetime.now().isoformat()

    workflow = store.workflows.get(task.matched_workflow_id)
    if not workflow:
        task.status = TaskStatus.FAILED
        store.save()
        raise ValueError(f"工作流不存在: {task.matched_workflow_id}")

    # 为每个 DAG 节点创建 Step
    for node in workflow.dag.nodes:
        step = TaskStep(task_id=task.id, node_id=node.id)
        store.steps[step.id] = step
        task.context.step_states[node.id] = StepState.PENDING

    store.save()
    await event_bus.emit("task:started", {"task_id": task_id})

    # 后台执行 DAG
    asyncio.create_task(_run_dag(task_id))

    return task


async def cancel_task(task_id: str) -> Task:
    """取消任务"""
    task = store.tasks.get(task_id)
    if not task:
        raise ValueError(f"任务不存在: {task_id}")

    task.status = TaskStatus.CANCELLED

    # 终止正在运行的 adapter session
    if task.context.adapter_session_id:
        await codebuddy_adapter.terminate(task.context.adapter_session_id)
        task.context.adapter_session_id = None

    store.save()
    await event_bus.emit("task:cancelled", {"task_id": task_id})
    return task


async def get_task_detail(task_id: str) -> dict:
    """获取任务详情（含步骤列表+快照+审批）"""
    task = store.tasks.get(task_id)
    if not task:
        raise ValueError(f"任务不存在: {task_id}")

    steps = [s for s in store.steps.values() if s.task_id == task_id]
    approvals = [a for a in store.approvals.values() if a.task_id == task_id and a.status == "pending"]
    snapshots = [s for s in store.snapshots.values() if s.task_id == task_id]

    return {
        "task": task.model_dump(),
        "steps": [s.model_dump() for s in steps],
        "pending_approvals": [a.model_dump() for a in approvals],
        "snapshots": [s.model_dump() for s in snapshots],
    }


async def _run_dag(task_id: str):
    """执行 DAG（后台任务）"""
    task = store.tasks.get(task_id)
    if not task:
        return

    workflow = store.workflows.get(task.matched_workflow_id)
    if not workflow:
        return

    dag = workflow.dag
    levels = topological_sort(dag)
    node_map: dict[str, NodeInstance] = {n.id: n for n in dag.nodes}

    # 边查找表
    edges_to: dict[str, list] = {}
    for e in dag.edges:
        edges_to.setdefault(e.target_id, []).append(e)

    all_outputs: dict[str, dict] = {}

    # 初始化 Git 仓库（使用 task 的工作目录）
    workspace_dir = task.context.variables.get("workspace", os.path.join(WORKSPACE_DIR, task_id))
    try:
        await init_git_repo(workspace_dir)
    except Exception as e:
        logger.warning(f"Git init failed: {e}")  # Git 不可用时跳过快照功能

    try:
        for level_idx, level_nodes in enumerate(levels):
            await event_bus.emit("dag:level_started", {
                "task_id": task_id, "level": level_idx, "nodes": level_nodes,
            })

            # 串行执行同层节点（避免并发 CodeBuddy 进程过多）
            for node_id in level_nodes:
                if task.status in (TaskStatus.CANCELLED, TaskStatus.FAILED):
                    return

                node = node_map[node_id]
                step = _find_step(task_id, node_id)

                # 检查断点
                if node_id in task.context.breakpoints:
                    await event_bus.emit("task:breakpoint_hit", {
                        "task_id": task_id, "node_id": node_id,
                    })
                    # 暂停等待用户操作（通过 Approval 机制）
                    if step:
                        step.debug_info = {"breakpoint": True, "node_id": node_id}
                        store.save()
                    # 创建一个 debug approval 等待用户
                    approval = await create_approval(
                        task_id=task_id,
                        step_id=step.id if step else "",
                        source=ApprovalSource.WORKFLOW,
                        approval_type="choice",
                        title=f"断点命中: {node_id}",
                        description=f"执行到断点节点 {node_id}，请选择操作",
                        options=[
                            {"label": "继续", "value": "continue"},
                            {"label": "单步", "value": "step"},
                            {"label": "取消", "value": "cancel"},
                        ],
                    )
                    # 等待用户处理断点
                    result = await _wait_for_approval(approval.id, task_id)
                    if result and result.get("choice") == "cancel":
                        task.status = TaskStatus.CANCELLED
                        store.save()
                        return
                    elif result and result.get("choice") == "step":
                        # 单步：当前节点执行，下一个节点设断点
                        task.context.breakpoints.remove(node_id)
                        # 找下一个节点并设断点
                        _set_next_breakpoint(task, node_id, edges_to, node_map)
                        store.save()

                # 检查条件
                should_run = _should_run_node(node_id, edges_to, all_outputs)
                if not should_run:
                    if step:
                        step.status = StepState.SKIPPED
                    task.context.step_states[node_id] = StepState.SKIPPED
                    all_outputs[node_id] = {"_skipped": True}
                    continue

                # 计算输入
                node_input = _compute_input(node_id, edges_to, all_outputs, task.input_data, dag)

                # Pre-step 快照
                if step:
                    try:
                        snap = await create_snapshot(task_id, step.id, "pre_step")
                        if snap:
                            step.snapshot_id = snap.id
                    except Exception:
                        pass

                # 检查节点是否需要 Approval（workflow 级别）
                node_def = store.nodes.get(node.definition_id)
                merged_config = {**(node_def.default_config if node_def else {}), **node.config}
                need_workflow_approval = merged_config.get("need_approval", False)

                # 执行节点
                try:
                    output = await _execute_node_via_adapter(
                        task, node, step, node_input, need_workflow_approval
                    )
                    all_outputs[node_id] = output
                except Exception as e:
                    import traceback
                    tb = traceback.format_exc()
                    error_msg = str(e) or repr(e) or type(e).__name__
                    # 将 traceback 放入 message 以便前端直接看到
                    full_msg = f"{error_msg}\n---TRACEBACK---\n{tb}" if error_msg else tb
                    all_outputs[node_id] = {"_error": error_msg}
                    if step:
                        step.status = StepState.FAILED
                        step.error = {"message": full_msg}
                    task.context.step_states[node_id] = StepState.FAILED
                    task.status = TaskStatus.FAILED
                    store.save()
                    logger.error(f"Node {node_id} failed: {error_msg}", exc_info=True)
                    await event_bus.emit("task:failed", {"task_id": task_id, "error": error_msg})
                    return

                # Post-step 快照
                if step:
                    try:
                        await create_snapshot(task_id, step.id, "post_step")
                    except Exception:
                        pass

        # 全部完成
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.now().isoformat()
        task.output_data = all_outputs
        store.save()
        await event_bus.emit("task:completed", {"task_id": task_id})

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        error_msg = str(e) or repr(e) or type(e).__name__
        task.status = TaskStatus.FAILED
        store.save()
        logger.error(f"DAG execution failed: {error_msg}\n{tb}", exc_info=True)
        await event_bus.emit("task:failed", {"task_id": task_id, "error": error_msg, "traceback": tb})


async def _prepare_skill_workspace(node_def, workspace_dir: str, input_data: dict) -> str | None:
    """为 skill 节点准备工作空间：生成 node-config.json + launcher skill

    返回 launcher skill 的目录路径，如果不是 skill 节点则返回 None。
    """
    from server.models.schemas import NodeResources

    resources: NodeResources = node_def.resources
    if not resources or not resources.skill_entry:
        return None

    source_dir = node_def.source_dir
    if not source_dir or not os.path.isdir(source_dir):
        logger.warning(f"[TaskRunner] Node {node_def.name} has skill_entry but no valid source_dir")
        return None

    # 1. 写入 node-config.json
    config_path = os.path.join(workspace_dir, ".codebuddy", "node-config.json")
    os.makedirs(os.path.dirname(config_path), exist_ok=True)

    node_config = {
        "skill_name": node_def.name,
        "skill_path": source_dir,
        "skill_dir": source_dir,  # 供 ${SKILL_DIR} 替换使用
        "skill_entry": resources.skill_entry,
        "input_data": input_data,
    }
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(node_config, f, ensure_ascii=False, indent=2)

    # 2. 写入 launcher skill
    launcher_dir = os.path.join(workspace_dir, ".codebuddy", "skills", "_agentflow")
    os.makedirs(launcher_dir, exist_ok=True)

    launcher_path = os.path.join(launcher_dir, "SKILL.md")
    with open(launcher_path, "w", encoding="utf-8") as f:
        f.write(get_launcher_skill_content())

    return launcher_dir


async def _install_pip_requirements(node_def, workspace_dir: str):
    """安装节点声明的 pip 依赖"""
    from server.models.schemas import NodeSetup, NodeResources

    # 优先从 setup.pip_requirements 取，其次从 resources.pip_requirements 取
    req_file = ""
    setup: NodeSetup = node_def.setup
    resources: NodeResources = node_def.resources

    if setup and setup.pip_requirements:
        req_file = setup.pip_requirements
    elif resources and resources.pip_requirements:
        req_file = resources.pip_requirements

    if not req_file:
        return

    # 解析为绝对路径（相对于 source_dir）
    source_dir = node_def.source_dir
    if not os.path.isabs(req_file) and source_dir:
        req_file = os.path.join(source_dir, req_file)

    if not os.path.exists(req_file):
        logger.warning(f"[TaskRunner] pip requirements file not found: {req_file}")
        return

    logger.info(f"[TaskRunner] Installing pip requirements from: {req_file}")
    try:
        import subprocess
        result = subprocess.run(
            ["pip", "install", "-r", req_file],
            capture_output=True, text=True, timeout=120,
            encoding="utf-8", errors="replace",
        )
        if result.returncode != 0:
            logger.warning(f"[TaskRunner] pip install failed: {result.stderr[:500]}")
        else:
            logger.info(f"[TaskRunner] pip install completed for {node_def.name}")
    except Exception as e:
        logger.warning(f"[TaskRunner] pip install error: {e}")


async def _execute_node_via_adapter(task: Task, node: NodeInstance,
                                     step: TaskStep | None, input_data: dict,
                                     need_workflow_approval: bool = False) -> dict:
    """通过 CodeBuddy Adapter 执行单个节点"""
    # 获取节点定义
    node_def = store.nodes.get(node.definition_id)
    if not node_def:
        raise ValueError(f"节点定义不存在: {node.definition_id}")

    # 合并配置：定义默认配置 + 节点实例配置
    config = {**node_def.default_config, **node.config}

    # 更新步骤状态
    if step:
        step.status = StepState.RUNNING
        step.started_at = datetime.now().isoformat()
        step.input_data = input_data
    task.context.step_states[node.id] = StepState.RUNNING
    task.context.current_step_id = node.id
    store.save()

    await event_bus.emit("dag:node_started", {"task_id": task.id, "node_id": node.id})

    # 获取任务的工作目录
    workspace_dir = task.context.variables.get("workspace", os.path.join(WORKSPACE_DIR, task.id))

    # 安装 pip 依赖（如果有）
    await _install_pip_requirements(node_def, workspace_dir)

    # 检查是否是 skill 节点，如果是则准备工作空间
    is_skill_node = node_def.resources and node_def.resources.skill_entry
    if is_skill_node:
        launcher_dir = await _prepare_skill_workspace(node_def, workspace_dir, input_data)
        if launcher_dir:
            # skill 节点：修改 prompt 让 launcher skill 接管
            logger.info(f"[TaskRunner] Skill node detected: {node_def.name}, launcher at {launcher_dir}")

    # 构建 Adapter 配置
    adapter_config = {
        "prompt_template": config.get("prompt_template", "{input}"),
        "input_data": input_data,
        "allowed_tools": config.get("allowed_tools", ""),
        "workspace": workspace_dir,
    }

    # 如果是 skill 节点，追加 system_prompt 提示 CodeBuddy 使用 launcher skill
    # 并注入 skill_dir 供 adapter 设置 SKILL_DIR 环境变量
    if is_skill_node:
        adapter_config["skill_dir"] = node_def.source_dir
        adapter_config["system_prompt_append"] = (
            "CRITICAL: This is a skill-based node. You MUST read and follow .codebuddy/skills/_agentflow/SKILL.md as your FIRST action. "
            "Do NOT use the Skill tool. Do NOT search for the skill. "
            "Use the Read tool to read .codebuddy/node-config.json first, then read the skill file at the path it specifies. "
            "The SKILL_DIR environment variable is already set — replace ${SKILL_DIR} with its value in any bash commands. "
            "If the skill requires user choices and you are in automated mode, use default/recommended options."
        )

    # 启动 CodeBuddy 会话
    logger.info(f"[Adapter] Starting session for node={node.id}, workspace={workspace_dir}")
    try:
        session_id = await codebuddy_adapter.start_session(adapter_config)
    except Exception as e:
        import traceback
        logger.error(f"[Adapter] start_session FAILED: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        raise
    task.context.adapter_session_id = session_id
    store.save()

    # 收集事件，等待完成
    output = {}
    approval_count = 0
    progress_texts = []  # 累积所有进度文本
    thinking_texts = []  # 累积思考内容

    try:
        async for event in codebuddy_adapter.on_event(session_id):
            if isinstance(event, AgentThinkingEvent):
                thinking_texts.append(event.content)
                await event_bus.emit("node:thinking", {
                    "task_id": task.id, "node_id": node.id, "content": event.content[:200],
                })
            elif isinstance(event, ProgressUpdateEvent):
                progress_texts.append(event.content)
                await event_bus.emit("node:progress", {
                    "task_id": task.id, "node_id": node.id, "content": event.content[:200],
                })
            elif isinstance(event, ApprovalNeededEvent):
                approval_count += 1
                # Agent 级审批：创建审批记录等待用户处理
                approval = await create_approval(
                    task_id=task.id,
                    step_id=step.id if step else "",
                    source=ApprovalSource.AGENT,
                    approval_type="confirm",
                    title=f"Agent 审批: {node.id}",
                    description=f"节点 {node.id} 执行中需要确认操作",
                    context_data={"session_id": session_id, "node_id": node.id},
                )
                await event_bus.emit("node:approval", {
                    "task_id": task.id, "node_id": node.id, "approval_id": approval.id,
                })
                # 等待用户处理审批（resolve_approval 会自动将结果回传给 CodeBuddy）
                await _wait_for_approval(approval.id, task.id)
            elif isinstance(event, ExecutionCompletedEvent):
                output = event.output
    except Exception as e:
        import traceback
        logger.error(f"[Adapter] on_event FAILED: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        raise

    task.context.adapter_session_id = None

    # 节点执行完成后，如果需要 workflow 级审批
    if need_workflow_approval and step:
        approval = await create_approval(
            task_id=task.id,
            step_id=step.id,
            source=ApprovalSource.WORKFLOW,
            approval_type="confirm",
            title=f"节点完成确认: {node.id}",
            description=f"节点 {node.id} 执行完成，请确认结果",
        )
        await event_bus.emit("node:workflow_approval", {
            "task_id": task.id, "node_id": node.id, "approval_id": approval.id,
        })
        result = await _wait_for_approval(approval.id, task.id)
        if result and not result.get("approved", True):
            raise RuntimeError("用户拒绝了节点执行结果")

    # 构建有意义的输出：优先用 text，其次 thinking
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
    # 保留原始 output 中的有用字段（如 cost）
    if output.get("result"):
        final_output["result"] = output["result"]
    if output.get("cost_usd"):
        final_output["cost_usd"] = output["cost_usd"]
    # 更新步骤
    if step:
        step.status = StepState.COMPLETED
        step.output_data = final_output
        step.completed_at = datetime.now().isoformat()
        step.approval_count = approval_count
    task.context.step_states[node.id] = StepState.COMPLETED
    store.save()

    await event_bus.emit("dag:node_completed", {
        "task_id": task.id, "node_id": node.id, "output": final_output,
    })

    return final_output


async def _wait_for_approval(approval_id: str, task_id: str, timeout: float = 600) -> dict | None:
    """等待审批结果（轮询方式，超时10分钟自动批准）"""
    import time
    start = time.time()
    while time.time() - start < timeout:
        approval = store.approvals.get(approval_id)
        if not approval:
            return None
        if approval.status in ("approved", "rejected"):
            return approval.result or {"approved": approval.status == "approved"}
        await asyncio.sleep(1)

    # 超时自动批准
    await resolve_approval(approval_id, True, {"approved": True, "auto": True, "reason": "timeout"})
    return {"approved": True, "auto": True}


def _set_next_breakpoint(task: Task, current_node_id: str, edges_to: dict, node_map: dict):
    """为下一个节点设置断点（单步执行时用）"""
    # 找当前节点的下游节点
    for target_id in node_map:
        if target_id not in task.context.step_states or task.context.step_states.get(target_id) in (StepState.PENDING,):
            # 找还没执行的节点
            if target_id != current_node_id and target_id not in task.context.breakpoints:
                task.context.breakpoints.append(target_id)
                break


def _find_step(task_id: str, node_id: str) -> TaskStep | None:
    """查找步骤"""
    for s in store.steps.values():
        if s.task_id == task_id and s.node_id == node_id:
            return s
    return None


def _should_run_node(node_id: str, edges_to: dict, all_outputs: dict) -> bool:
    incoming = edges_to.get(node_id, [])
    if not incoming:
        return True
    for e in incoming:
        source_out = all_outputs.get(e.source_id, {})
        if not evaluate_condition(e.condition, source_out):
            return False
    return True


def _compute_input(node_id: str, edges_to: dict, all_outputs: dict,
                   workflow_input: dict, dag) -> dict:
    from server.models.schemas import DAGDefinition
    incoming = edges_to.get(node_id, [])
    if not incoming:
        return workflow_input
    merged = {}
    for e in incoming:
        source_out = all_outputs.get(e.source_id, {})
        # 无显式 data_mapping 时，自动提取上游的关键输出
        if not e.data_mapping:
            smart_input = {}
            if source_out.get("text"):
                smart_input["previous_output"] = source_out["text"]
            elif source_out.get("summary"):
                smart_input["previous_output"] = source_out["summary"]
            smart_input["previous_status"] = source_out.get("status", "unknown")
            if source_out.get("result"):
                smart_input["previous_result"] = source_out["result"]
            merged.update(smart_input)
        else:
            mapped = resolve_data_mapping(e.data_mapping, source_out, all_outputs, workflow_input)
            merged.update(mapped)
    return merged
