"""节点注册中心 API"""

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.schemas.base import APIResponse
from app.schemas.node import NodeDefCreate, NodeDefResponse, NodeDefUpdate
from app.services import node_service

router = APIRouter()


def _to_response(node) -> NodeDefResponse:
    """ORM → Pydantic schema"""
    return NodeDefResponse.model_validate(node)


@router.get("")
async def list_nodes(
    category: str | None = Query(None),
    status: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    """查询节点列表

    默认返回所有状态；传 status=published 可只看已发布节点。
    """
    items = await node_service.list_nodes(session, category=category, status=status)
    data = [_to_response(n) for n in items]
    return APIResponse(data=data)


@router.get("/{node_id}")
async def get_node(node_id: str, session: AsyncSession = Depends(get_session)):
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    return APIResponse(data=_to_response(node))


@router.post("", status_code=201)
async def create_node(body: NodeDefCreate, session: AsyncSession = Depends(get_session)):
    node = await node_service.create_node(session, TEMP_USER_ID, body)
    return APIResponse(data=_to_response(node))


@router.post("/upload", status_code=201)
async def upload_node(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    """上传 ZIP 包导入节点

    ZIP 包中必须包含 SKILL.md 文件（YAML frontmatter 格式），
    系统会自动解析并注册为 NodeDefinition，同时同步附件到 node_files 表。
    """
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(400, "请上传 .zip 文件")

    zip_bytes = await file.read()
    if len(zip_bytes) == 0:
        raise HTTPException(400, "上传文件为空")

    try:
        node = await node_service.upload_node_from_zip(session, TEMP_USER_ID, zip_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    return APIResponse(data=_to_response(node), message="节点导入成功")


@router.put("/{node_id}")
async def update_node(
    node_id: str, body: NodeDefUpdate, session: AsyncSession = Depends(get_session)
):
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    updated = await node_service.update_node(session, node, body)
    return APIResponse(data=_to_response(updated))


@router.post("/{node_id}/deprecate")
async def deprecate_node(node_id: str, session: AsyncSession = Depends(get_session)):
    """软删除：将节点标记为 deprecated"""
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    if node.status == "deprecated":
        raise HTTPException(400, "节点已处于停用状态")
    updated = await node_service.deprecate_node(session, node)
    return APIResponse(data=_to_response(updated), message="节点已停用")


@router.post("/{node_id}/restore")
async def restore_node(node_id: str, session: AsyncSession = Depends(get_session)):
    """恢复：将节点从 deprecated 恢复为 published"""
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    if node.status != "deprecated":
        raise HTTPException(400, "只有停用状态的节点才能恢复")
    updated = await node_service.restore_node(session, node)
    return APIResponse(data=_to_response(updated), message="节点已恢复")


@router.get("/{node_id}/references")
async def get_node_references(node_id: str, session: AsyncSession = Depends(get_session)):
    """检查节点引用关系（用于前端判断是否可硬删）"""
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    refs = await node_service.check_node_references(session, node)
    return APIResponse(data={"references": refs, "deletable": len(refs) == 0})


@router.delete("/{node_id}")
async def delete_node(node_id: str, session: AsyncSession = Depends(get_session)):
    """硬删除节点（仅无引用时允许）"""
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")

    refs = await node_service.check_node_references(session, node)
    if refs:
        raise HTTPException(
            409,
            f"节点不可删除，存在引用：{'；'.join(refs)}。请先停用节点。",
        )

    await node_service.delete_node_permanently(session, node)
    return APIResponse(message="节点已永久删除")
