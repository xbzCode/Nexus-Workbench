"""节点列表 API — 支持 Registry 扫描结果查看和热重载"""

from fastapi import APIRouter, HTTPException

from server.config import EXTENSION_DIR
from server.services.store import store
from server.services.registry import scan_extensions

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("")
async def list_nodes():
    return list(store.nodes.values())


@router.get("/{node_id}")
async def get_node(node_id: str):
    nd = store.nodes.get(node_id)
    if not nd:
        raise HTTPException(404, "Node not found")
    return nd


@router.post("/reload")
async def reload_nodes():
    """热重载：重新扫描 extention/ 目录，合并到 store.nodes"""
    extension_nodes = scan_extensions(EXTENSION_DIR)
    # 更新 store 中的节点定义（不删除用户自定义节点）
    for nid, nd in extension_nodes.items():
        store.nodes[nid] = nd
    store.save()
    return {"reloaded": len(extension_nodes), "total": len(store.nodes)}
