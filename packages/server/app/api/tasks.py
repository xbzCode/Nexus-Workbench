"""任务 API — 含启动/取消/执行"""

import copy
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.models.node import NodeDefinition
from app.models.workflow import Workflow
from app.schemas.base import APIResponse
from app.schemas.task import StepResponse, TaskCreate, TaskResponse
from app.services import task_service

router = APIRouter()

# 诊断日志：直接写文件，避免被 stdout/IDE 终端吞掉
import os as _os
from datetime import datetime as _dt
_DIAG_LOG_PATH = _os.path.join(
    _os.environ.get("LOG_DIR", "logs"),
    f"display_name_diag_{_dt.now().strftime('%Y%m%d')}.log",
)

# 启动期一次性标记：每次模块被加载（uvicorn 启动 / --reload 触发）都会重写此文件
_STARTUP_MARKER = _os.path.join(
    _os.environ.get("LOG_DIR", "logs"),
    "STARTUP_MARKER_TASKS_API.txt",
)
try:
    _os.makedirs(_os.path.dirname(_STARTUP_MARKER) or ".", exist_ok=True)
    with open(_STARTUP_MARKER, "w", encoding="utf-8") as _f:
        _f.write(
            f"tasks.py loaded at {_dt.now().isoformat(timespec='seconds')} | "
            f"pid={_os.getpid()} | python={_os.sys.version.split()[0]}\n"
        )
except Exception:
    pass


def _diag_log(msg: str) -> None:
    """写一行诊断日志到 logs/display_name_diag_YYYYMMDD.log，失败也不抛异常"""
    try:
        _os.makedirs(_os.path.dirname(_DIAG_LOG_PATH) or ".", exist_ok=True)
        with open(_DIAG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{_dt.now().isoformat(timespec='seconds')}] {msg}\n")
    except Exception:
        pass


def _humanize(raw: str | None) -> str:
    """把 'summary_writer' / 'create-dag' 美化为 'Summary Writer'

    规则：下划线/连字符变空格，每个单词首字母大写，去除多余空格。
    """
    if not raw:
        return ""
    cleaned = raw.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return raw
    return " ".join(w.capitalize() for w in cleaned.split())


async def _enrich_dag_display_names(
    dag: dict | None, session: AsyncSession
) -> dict | None:
    """为 DAG 中的节点填充 display_name

    definition_id 是 NodeDefinition.id（UUID 字符串），按 id 查 NodeDefinition。
    查不到时不做 name 兜底（name 会随 SKILL.md 变更而改变，不稳定）。

    填充优先级：
    1) NodeDefinition.display_name（来自 SKILL.md 元数据）
    2) definition_id 走 _humanize 美化（极少发生，仅当节点定义被删时）
    3) node.id 走 _humanize 美化（bare_agent 引擎构造节点）

    任何情况下都写入 display_name。
    """
    if not dag or not dag.get("nodes"):
        return dag

    # 收集所有看起来像 UUID 的 definition_id
    def_ids_raw = {
        n["definition_id"]
        for n in dag["nodes"]
        if n.get("definition_id")
    }
    uuid_ids: list[uuid.UUID] = []
    for v in def_ids_raw:
        try:
            uuid_ids.append(uuid.UUID(v))
        except (ValueError, AttributeError):
            pass

    lookup: dict[str, str] = {}
    if uuid_ids:
        result = await session.execute(
            select(NodeDefinition.id, NodeDefinition.display_name).where(
                NodeDefinition.id.in_(uuid_ids)
            )
        )
        for nid, display_name in result.all():
            lookup[str(nid)] = display_name

    # 深拷贝 DAG，给每个节点加 display_name
    enriched = copy.deepcopy(dag)
    for node in enriched["nodes"]:
        def_id = node.get("definition_id")
        if def_id and def_id in lookup:
            node["display_name"] = lookup[def_id]
        else:
            node["display_name"] = (
                _humanize(def_id) or _humanize(node.get("id")) or "Unnamed Node"
            )

    # 诊断日志：每次 enrichment 都记录一次命中统计
    _diag_log(
        f"[display_name enrich] nodes={len(enriched.get('nodes', []))} "
        f"uuids_parsed={len(uuid_ids)} "
        f"lookup_hits={sum(1 for n in enriched['nodes'] if n.get('definition_id') in lookup)} "
        f"sample_def_ids={list(def_ids_raw)[:3]} "
        f"sample_lookup_keys={list(lookup.keys())[:3]}"
    )
    return enriched


async def _enrich_task(task: Any, session: AsyncSession) -> TaskResponse:
    """将 Task ORM 对象转为 TaskResponse，联查 Workflow 填充 workflow_name 和 dag"""
    resp = TaskResponse.model_validate(task)

    if task.matched_workflow_id:
        wf = await session.get(Workflow, task.matched_workflow_id)
        if wf:
            resp.workflow_name = wf.name
            resp.dag = await _enrich_dag_display_names(wf.dag, session)
    elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
        resp.dag = await _enrich_dag_display_names(task.context["dag"], session)
    elif task.execution_mode == "bare_agent":
        # bare_agent 的 DAG 由引擎在 start_task 时构造，此处不填充
        pass

    return resp


async def _enrich_tasks(tasks: list[Any], session: AsyncSession) -> list[TaskResponse]:
    """批量填充 workflow_name 和 dag（含节点 display_name）"""
    # 收集所有 workflow_id 批量查询，避免 N+1
    wf_ids = {t.matched_workflow_id for t in tasks if t.matched_workflow_id}
    wf_map: dict[uuid.UUID, Workflow] = {}
    if wf_ids:
        result = await session.execute(select(Workflow).where(Workflow.id.in_(wf_ids)))
        for wf in result.scalars().all():
            wf_map[wf.id] = wf

    # 收集所有 DAG 中的 definition_id（UUID 形式），按 id 批量查 NodeDefinition
    all_def_ids_raw: set[str] = set()
    raw_dags: list[dict] = []
    for task in tasks:
        dag = None
        if task.matched_workflow_id and task.matched_workflow_id in wf_map:
            dag = wf_map[task.matched_workflow_id].dag
        elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
            dag = task.context["dag"]
        if dag and dag.get("nodes"):
            raw_dags.append(dag)
            for n in dag["nodes"]:
                if n.get("definition_id"):
                    all_def_ids_raw.add(n["definition_id"])

    lookup: dict[str, str] = {}
    uuid_ids: list[uuid.UUID] = []
    for v in all_def_ids_raw:
        try:
            uuid_ids.append(uuid.UUID(v))
        except (ValueError, AttributeError):
            pass
    if uuid_ids:
        result = await session.execute(
            select(NodeDefinition.id, NodeDefinition.display_name).where(
                NodeDefinition.id.in_(uuid_ids)
            )
        )
        for nid, display_name in result.all():
            lookup[str(nid)] = display_name

    enriched = []
    for task in tasks:
        resp = TaskResponse.model_validate(task)
        if task.matched_workflow_id and task.matched_workflow_id in wf_map:
            wf = wf_map[task.matched_workflow_id]
            resp.workflow_name = wf.name
            if wf.dag:
                enriched_dag = copy.deepcopy(wf.dag)
                for node in enriched_dag.get("nodes", []):
                    def_id = node.get("definition_id")
                    if def_id and def_id in lookup:
                        node["display_name"] = lookup[def_id]
                    else:
                        node["display_name"] = (
                            _humanize(def_id)
                            or _humanize(node.get("id"))
                            or "Unnamed Node"
                        )
                resp.dag = enriched_dag
        elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
            enriched_dag = copy.deepcopy(task.context["dag"])
            for node in enriched_dag.get("nodes", []):
                def_id = node.get("definition_id")
                if def_id and def_id in lookup:
                    node["display_name"] = lookup[def_id]
                else:
                    node["display_name"] = (
                        _humanize(def_id)
                        or _humanize(node.get("id"))
                        or "Unnamed Node"
                    )
            resp.dag = enriched_dag
        # bare_agent: 按设计不展示 pipeline 节点，保持 resp.dag 为 None
        enriched.append(resp)
    return enriched


@router.get("")
async def list_tasks(session: AsyncSession = Depends(get_session)):
    items = await task_service.list_tasks(session, TEMP_USER_ID)
    data = await _enrich_tasks(items, session)
    return APIResponse(data=data)


@router.get("/{task_id}")
async def get_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("", status_code=201)
async def create_task(body: TaskCreate, session: AsyncSession = Depends(get_session)):
    task = await task_service.create_task(session, TEMP_USER_ID, body)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/start")
async def start_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")

    # 获取 DAG：优先从关联工作流，其次从 task.context（动态组装）
    workflow_dag = None
    if task.matched_workflow_id:
        wf = await session.get(Workflow, task.matched_workflow_id)
        if wf and wf.dag:
            workflow_dag = wf.dag
    elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
        workflow_dag = task.context["dag"]

    await task_service.start_task(session, task, workflow_dag)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    await task_service.cancel_task(session, task)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/pause")
async def pause_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    await task_service.pause_task(session, task)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.post("/{task_id}/resume")
async def resume_task(task_id: str, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, uuid.UUID(task_id))
    if not task:
        raise HTTPException(404, "Task not found")

    # 获取 DAG：与 start_task 相同的逻辑
    workflow_dag = None
    if task.matched_workflow_id:
        wf = await session.get(Workflow, task.matched_workflow_id)
        if wf and wf.dag:
            workflow_dag = wf.dag
    elif task.execution_mode == "dynamic_assembly" and task.context and "dag" in task.context:
        workflow_dag = task.context["dag"]

    await task_service.resume_task(session, task, workflow_dag)
    data = await _enrich_task(task, session)
    return APIResponse(data=data)


@router.get("/{task_id}/steps")
async def get_task_steps(task_id: str, session: AsyncSession = Depends(get_session)):
    steps = await task_service.get_task_steps(session, uuid.UUID(task_id))
    data = [StepResponse.model_validate(s) for s in steps]
    return APIResponse(data=data)


@router.get("/{task_id}/files")
async def get_task_files(task_id: str):
    """获取任务 workspace 目录下的产物文件列表（直接读磁盘）"""
    try:
        files = task_service.get_task_files(uuid.UUID(task_id))
        return APIResponse(data=files)
    except Exception as e:
        return APIResponse(data=[], message=f"读取文件列表失败: {str(e)}")


@router.get("/{task_id}/files/{file_path:path}")
async def get_task_file_content(task_id: str, file_path: str, download: bool = False):
    """获取任务 workspace 中指定文件的内容（预览或下载）

    Args:
        task_id: 任务 ID
        file_path: 相对于 workspace 的文件路径
        download: 是否以附件方式下载（默认 inline 预览）
    """
    import mimetypes
    from fastapi.responses import FileResponse

    file_full_path = task_service.get_task_file_path(uuid.UUID(task_id), file_path)

    if not file_full_path or not file_full_path.is_file():
        raise HTTPException(404, f"File not found: {file_path}")

    # 安全校验：确保路径没有逃逸出 workspace
    workspace_dir = task_service.get_task_workspace_dir(uuid.UUID(task_id))
    try:
        file_full_path.resolve().relative_to(workspace_dir.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied: path outside workspace")

    # 推断 MIME 类型
    mime_type, _ = mimetypes.guess_type(file_full_path.name)
    if not mime_type:
        mime_type = "application/octet-stream"

    disposition = "attachment" if download else "inline"
    return FileResponse(
        path=str(file_full_path),
        media_type=mime_type,
        filename=file_full_path.name if download else None,
        content_disposition_type=disposition,
    )
