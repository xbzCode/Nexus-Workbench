"""节点注册中心 API"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
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
    session: AsyncSession = Depends(get_session),
):
    items = await node_service.list_nodes(session, category)
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


@router.put("/{node_id}")
async def update_node(
    node_id: str, body: NodeDefUpdate, session: AsyncSession = Depends(get_session)
):
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    updated = await node_service.update_node(session, node, body)
    return APIResponse(data=_to_response(updated))


@router.delete("/{node_id}")
async def delete_node(node_id: str, session: AsyncSession = Depends(get_session)):
    node = await node_service.get_node(session, uuid.UUID(node_id))
    if not node:
        raise HTTPException(404, "Node not found")
    await node_service.delete_node(session, node)
    return APIResponse(message="Deleted")
