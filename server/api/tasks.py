"""任务 API — 创建/启动/取消/查询任务"""

import asyncio
import logging
import os
import traceback

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from server.services.task_runner import create_task, start_task, cancel_task, get_task_detail
from server.services.store import store

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class CreateTaskRequest(BaseModel):
    title: str = ""
    intent: str = ""
    workflow_id: str = ""
    input_data: dict = {}


@router.post("")
async def api_create_task(req: CreateTaskRequest):
    """创建任务"""
    try:
        task = await create_task(
            title=req.title, intent=req.intent,
            workflow_id=req.workflow_id or None,
            input_data=req.input_data,
        )
        return task.model_dump()
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("")
async def api_list_tasks():
    """列出所有任务"""
    return [t.model_dump() for t in store.tasks.values()]


# ============================================================
# 诊断端点（必须在 /{task_id} 之前注册，否则通配路由会先匹配）
# ============================================================


@router.get("/diag/run-test", response_class=PlainTextResponse)
async def api_diag_run_test():
    """诊断：在服务器环境中创建并执行测试任务"""
    lines = []
    wf_id = list(store.workflows.keys())[0] if store.workflows else None
    if not wf_id:
        return "No workflows available!"

    wf = store.workflows[wf_id]
    lines.append(f"Workflow: {wf_id} ({wf.name})")
    lines.append(f"Nodes: {[n.id + ' def=' + n.definition_id for n in wf.dag.nodes]}")

    for n in wf.dag.nodes:
        nd = store.nodes.get(n.definition_id)
        lines.append(f"  Node {n.id}: def_exists={nd is not None}, def_name={nd.name if nd else 'N/A'}")

    try:
        task = await create_task(
            title="diag_test",
            intent="diag",
            workflow_id=wf_id,
            input_data={"requirement": "你好"},
        )
        lines.append(f"Task created: {task.id}")
    except Exception as e:
        lines.append(f"create_task FAILED: {type(e).__module__}.{type(e).__name__}: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    try:
        result = await start_task(task.id)
        lines.append(f"Task started: {result.status}")
    except Exception as e:
        lines.append(f"start_task FAILED: {type(e).__module__}.{type(e).__name__}: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    for i in range(60):
        await asyncio.sleep(1)
        t = store.tasks.get(task.id)
        if t.status in ("completed", "failed", "cancelled"):
            lines.append(f"Final: {t.status}")
            for s in store.steps.values():
                if s.task_id == task.id:
                    err_str = str(s.error) if s.error else "None"
                    lines.append(f"  {s.node_id}: {s.status} err={err_str[:1000]}")
            break
    else:
        lines.append("TIMEOUT after 60s")

    return "\n".join(lines)


@router.get("/diag/setup-write-wf", response_class=PlainTextResponse)
async def api_diag_setup_write_wf():
    """诊断：创建写文件工作流（code-generation → code-review），返回 workflow_id"""
    from server.models.schemas import Workflow, NodeInstance, EdgeDef, DAGDefinition

    # 检查是否已存在
    for wf in store.workflows.values():
        if wf.name == "file-write-wf":
            return f"Already exists: {wf.id}"

    wf = Workflow(
        name="file-write-wf",
        description="写文件并审查",
        category="development",
        dag=DAGDefinition(
            nodes=[
                NodeInstance(
                    id="n1",
                    definition_id="node_def_code_generation",
                    position={"x": 100, "y": 200},
                ),
                NodeInstance(
                    id="n2",
                    definition_id="node_def_code_review",
                    position={"x": 400, "y": 200},
                    config={"need_approval": True},
                ),
            ],
            edges=[
                EdgeDef(source_id="n1", target_id="n2"),
            ],
        ),
        status="published",
    )
    store.workflows[wf.id] = wf
    store.save()
    return f"Created workflow: {wf.id} (file-write-wf)"


@router.get("/diag/run-write-task", response_class=PlainTextResponse)
async def api_diag_run_write_task():
    """诊断：用写文件工作流创建并执行任务，验证回滚"""
    import os

    # 找写文件工作流
    wf_id = None
    for wf in store.workflows.values():
        if wf.name == "file-write-wf":
            wf_id = wf.id
            break
    if not wf_id:
        return "file-write-wf not found! Call /diag/setup-write-wf first."

    lines = [f"Using workflow: {wf_id}"]

    # 创建任务
    try:
        task = await create_task(
            title="write-file-test",
            intent="创建一个hello.py文件",
            workflow_id=wf_id,
            input_data={"requirement": "在工作目录中创建一个hello.py文件，内容为 print('Hello AgentFlow!')，然后运行它验证输出"},
        )
        lines.append(f"Task created: {task.id}")
        lines.append(f"Workspace: {task.context.variables.get('workspace', 'N/A')}")
    except Exception as e:
        lines.append(f"create_task FAILED: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    # 启动任务
    try:
        result = await start_task(task.id)
        lines.append(f"Task started: {result.status}")
    except Exception as e:
        lines.append(f"start_task FAILED: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    # 等待完成
    for i in range(120):
        await asyncio.sleep(1)
        t = store.tasks.get(task.id)
        if t.status in ("completed", "failed", "cancelled"):
            lines.append(f"Final: {t.status}")
            for s in store.steps.values():
                if s.task_id == task.id:
                    err_str = str(s.error)[:500] if s.error else "None"
                    lines.append(f"  {s.node_id}: {s.status} err={err_str}")
            break
    else:
        lines.append("TIMEOUT after 120s")

    # 检查工作目录中的文件
    ws = task.context.variables.get("workspace", "")
    if ws and os.path.isdir(ws):
        files = os.listdir(ws)
        files = [f for f in files if f != ".git"]
        lines.append(f"Files in workspace: {files}")

        # 检查hello.py
        hello_py = os.path.join(ws, "hello.py")
        if os.path.isfile(hello_py):
            with open(hello_py, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()[:200]
            lines.append(f"hello.py content: {content}")
        else:
            lines.append("hello.py NOT found in workspace")

    # 列出快照
    snapshots = [s for s in store.snapshots.values() if s.task_id == task.id]
    lines.append(f"Snapshots: {len(snapshots)}")
    for snap in snapshots:
        diff_preview = (snap.git_diff or "")[:200] if snap.git_diff else "None"
        lines.append(f"  {snap.type} hash={snap.git_commit_hash[:8]} diff={diff_preview}")

    return "\n".join(lines)


@router.get("/diag/test-rollback/{task_id}")
async def api_diag_test_rollback(task_id: str):
    """诊断：回滚到指定任务的第一个pre_step快照，验证文件恢复（流式输出）"""
    import os
    from server.services.snapshot_service import rollback_to_snapshot

    async def _stream():
        task = store.tasks.get(task_id)
        if not task:
            yield f"Task {task_id} not found!\n"
            return

        yield f"Task: {task_id} status={task.status}\n"
        ws = task.context.variables.get("workspace", "")

        # 列出当前文件
        if ws and os.path.isdir(ws):
            before_files = [f for f in os.listdir(ws) if f != ".git"]
            yield f"Files BEFORE rollback: {before_files}\n"

        # 找第一个pre_step快照
        snapshots = [s for s in store.snapshots.values() if s.task_id == task_id and s.type == "pre_step"]
        if not snapshots:
            yield "No pre_step snapshots found!\n"
            return

        snap = snapshots[0]
        yield f"Rolling back to snapshot: {snap.id[:8]} type={snap.type} hash={snap.git_commit_hash[:8]}\n"

        # 回滚
        try:
            logger.info(f"[test-rollback] Rolling back task={task_id} to snapshot={snap.id[:8]}")
            ok = await rollback_to_snapshot(task_id, snap.id)
            logger.info(f"[test-rollback] Rollback result: {ok}")
            yield f"Rollback result: {ok}\n"
        except Exception as e:
            logger.error(f"[test-rollback] FAILED: {e}")
            yield f"Rollback FAILED: {e}\n"
            yield traceback.format_exc()
            return

        # 检查回滚后的文件
        if ws and os.path.isdir(ws):
            after_files = [f for f in os.listdir(ws) if f != ".git"]
            yield f"Files AFTER rollback: {after_files}\n"

            hello_py = os.path.join(ws, "hello.py")
            if os.path.isfile(hello_py):
                yield "WARNING: hello.py still exists after rollback!\n"
            else:
                yield "SUCCESS: hello.py removed by rollback!\n"

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


@router.get("/diag/test-breakpoint")
async def api_diag_test_breakpoint():
    """诊断：测试断点调试 — 创建任务→设断点→启动→命中→继续→完成（流式输出）"""
    import os
    from server.services.approval import list_pending_approvals, resolve_approval

    async def _stream():
        # 找test_wf（echo节点，执行快）
        wf_id = None
        for wf in store.workflows.values():
            if wf.name == "test_wf":
                wf_id = wf.id
                break
        if not wf_id:
            yield "test_wf not found!\n"
            return

        yield f"Using workflow: {wf_id} (test_wf)\n"

        # 1. 创建任务
        task = await create_task(
            title="breakpoint-test",
            intent="breakpoint test",
            workflow_id=wf_id,
            input_data={"requirement": "你好"},
        )
        logger.info(f"[test-breakpoint] Task created: {task.id}")
        yield f"Task created: {task.id}\n"

        # 2. 在n2设置断点
        task.context.breakpoints.append("n2")
        store.save()
        yield f"Breakpoint set on n2: {task.context.breakpoints}\n"

        # 3. 启动任务
        result = await start_task(task.id)
        logger.info(f"[test-breakpoint] Task started: {result.status}")
        yield f"Task started: {result.status}\n"

        # 4. 等待断点命中（n1执行完，n2被暂停）
        yield "Waiting for breakpoint hit...\n"
        breakpoint_hit = False
        for i in range(60):
            await asyncio.sleep(1)
            t = store.tasks.get(task.id)
            pending = [a for a in store.approvals.values()
                       if a.task_id == task.id and a.status == "pending"]
            if pending:
                logger.info(f"[test-breakpoint] Breakpoint HIT! approval={pending[0].id[:8]}")
                yield f"Breakpoint HIT! Approval found: {pending[0].id[:8]}\n"
                yield f"  Approval title: {pending[0].title}\n"
                yield f"  Task status: {t.status}\n"
                yield f"  n1 status: {t.context.step_states.get('n1', 'N/A')}\n"
                yield f"  n2 status: {t.context.step_states.get('n2', 'N/A')}\n"
                breakpoint_hit = True
                break
            if t.status in ("completed", "failed", "cancelled"):
                yield f"Task finished without hitting breakpoint: {t.status}\n"
                break
            if i % 5 == 0:
                yield f"  ... waiting ({i}s) task_status={t.status}\n"

        if not breakpoint_hit:
            yield "FAILED: Breakpoint was not hit!\n"
            return

        # 5. 选择"继续"（resolve approval with choice=continue）
        approval = pending[0]
        await resolve_approval(approval.id, True, {"approved": True, "choice": "continue"})
        logger.info("[test-breakpoint] Resolved approval with choice=continue")
        yield "Resolved approval with choice=continue\n"

        # 6. 等待任务完成
        yield "Waiting for task completion...\n"
        for i in range(60):
            await asyncio.sleep(1)
            t = store.tasks.get(task.id)
            if t.status in ("completed", "failed", "cancelled"):
                yield f"Final: {t.status}\n"
                for s in store.steps.values():
                    if s.task_id == task.id:
                        err_str = str(s.error)[:200] if s.error else "None"
                        yield f"  {s.node_id}: {s.status} err={err_str}\n"
                break
            if i % 5 == 0:
                yield f"  ... waiting ({i}s) task_status={t.status}\n"
        else:
            yield "TIMEOUT waiting for task completion after continue\n"

        # 7. 验证断点调试结果
        t = store.tasks.get(task.id)
        if t.status == "completed":
            yield "SUCCESS: Breakpoint debug flow works!\n"
            yield f"  n1 completed: {t.context.step_states.get('n1') == 'completed'}\n"
            yield f"  n2 completed: {t.context.step_states.get('n2') == 'completed'}\n"
        else:
            yield f"ISSUE: Task ended with status {t.status}\n"

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


@router.get("/diag/test-matcher", response_class=PlainTextResponse)
async def api_diag_test_matcher():
    """诊断：测试LLM工作流匹配 — 输入意图→匹配→确认→执行"""
    import os

    # 需要至少2个工作流来测试匹配
    wf_count = len(store.workflows)
    lines = [f"Available workflows: {wf_count}"]
    for wf in store.workflows.values():
        lines.append(f"  {wf.id[:8]}: {wf.name} - {wf.description}")

    if wf_count == 0:
        return "No workflows available!"

    # 使用matcher服务匹配
    from server.services.matcher_service import match_workflow
    intent = "帮我写一个Python脚本"
    lines.append(f"\nMatching intent: '{intent}'")

    try:
        match = await match_workflow(intent)
        wf_id = match.get("matched_workflow_id")
        wf_name = match.get("matched_workflow_name")
        confidence = match.get("confidence")
        reasoning = match.get("reasoning")
        lines.append(f"Match result: workflow_id={wf_id[:8] if wf_id else 'None'} name={wf_name}")
        lines.append(f"  confidence={confidence} reasoning={reasoning}")
        if not wf_id:
            lines.append("No match found!")
            return "\n".join(lines)
    except Exception as e:
        lines.append(f"Matcher FAILED: {e}")
        lines.append(traceback.format_exc())
        return "\n".join(lines)

    # 用匹配到的工作流创建任务
    try:
        task = await create_task(
            title="matcher-test",
            intent=intent,
            workflow_id=wf_id,
            input_data={"requirement": "创建一个hello.py，打印Hello World"},
        )
        lines.append(f"\nTask created with matched workflow: {task.id}")
    except Exception as e:
        lines.append(f"create_task FAILED: {e}")
        return "\n".join(lines)

    # 启动
    try:
        result = await start_task(task.id)
        lines.append(f"Task started: {result.status}")
    except Exception as e:
        lines.append(f"start_task FAILED: {e}")
        return "\n".join(lines)

    # 等待完成
    for i in range(120):
        await asyncio.sleep(1)
        t = store.tasks.get(task.id)
        if t.status in ("completed", "failed", "cancelled"):
            lines.append(f"Final: {t.status}")
            for s in store.steps.values():
                if s.task_id == task.id:
                    err_str = str(s.error)[:200] if s.error else "None"
                    lines.append(f"  {s.node_id}: {s.status} err={err_str}")
            break
    else:
        lines.append("TIMEOUT after 120s")

    # 检查workspace
    ws = task.context.variables.get("workspace", "")
    if ws and os.path.isdir(ws):
        files = [f for f in os.listdir(ws) if f != ".git"]
        lines.append(f"Files in workspace: {files}")

    return "\n".join(lines)


# ============================================================
# 任务产出文件
# ============================================================


@router.get("/{task_id}/files")
async def api_list_task_files(task_id: str):
    """列出任务 workspace 中的产出文件"""
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    workspace = task.context.variables.get("workspace", "")
    if not workspace or not os.path.isdir(workspace):
        return {"files": [], "workspace": ""}

    files = []
    for root, dirs, filenames in os.walk(workspace):
        # 跳过 .git 和 .codebuddy 目录
        dirs[:] = [d for d in dirs if d not in (".git", ".codebuddy")]
        for fname in filenames:
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, workspace).replace("\\", "/")
            size = os.path.getsize(full_path)
            files.append({
                "name": fname,
                "path": rel_path,
                "size": size,
                "ext": os.path.splitext(fname)[1].lower(),
            })

    return {"files": files, "workspace": workspace}


@router.get("/{task_id}/files/{file_path:path}")
async def api_download_task_file(task_id: str, file_path: str):
    """下载任务 workspace 中的指定文件"""
    from fastapi.responses import FileResponse

    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    workspace = task.context.variables.get("workspace", "")
    if not workspace:
        raise HTTPException(404, "工作目录不存在")

    # 安全检查：防止路径遍历
    full_path = os.path.normpath(os.path.join(workspace, file_path))
    if not full_path.startswith(os.path.normpath(workspace)):
        raise HTTPException(403, "禁止访问")
    if not os.path.isfile(full_path):
        raise HTTPException(404, "文件不存在")

    return FileResponse(full_path, filename=os.path.basename(file_path))


# ============================================================
# 通用任务端点（通配路由必须放最后）
# ============================================================


@router.get("/{task_id}")
async def api_get_task(task_id: str):
    """获取任务详情"""
    try:
        return await get_task_detail(task_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{task_id}/start")
async def api_start_task(task_id: str):
    """启动任务"""
    try:
        task = await start_task(task_id)
        return {"status": task.status, "task_id": task.id}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{task_id}/cancel")
async def api_cancel_task(task_id: str):
    """取消任务"""
    try:
        task = await cancel_task(task_id)
        return {"status": task.status, "task_id": task.id}
    except ValueError as e:
        raise HTTPException(400, str(e))
