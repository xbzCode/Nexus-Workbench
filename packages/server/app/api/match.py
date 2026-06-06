"""匹配 API — POST /api/match"""

import copy
import logging
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.models.node import NodeDefinition
from app.schemas.base import APIResponse
from app.schemas.match import MatchRequest, MatchResult
from app.schemas.workflow import DAGDefinition
from app.services import match_service

router = APIRouter()
logger = logging.getLogger(__name__)


async def _enrich_match_dag(result: MatchResult, session: AsyncSession) -> None:
    """为匹配结果的 DAG 节点填充 display_name"""
    if not result.dag or not result.dag.nodes:
        return

    def_ids = {
        n.definition_id for n in result.dag.nodes if n.definition_id
    }
    if not def_ids:
        return

    name_map: dict[str, str] = {}
    db_result = await session.execute(
        select(NodeDefinition.name, NodeDefinition.display_name).where(
            NodeDefinition.name.in_(def_ids)
        )
    )
    for name, display_name in db_result.all():
        name_map[name] = display_name

    for node in result.dag.nodes:
        if node.definition_id and node.definition_id in name_map:
            node.display_name = name_map[node.definition_id]


@router.post("")
async def match(body: MatchRequest, session: AsyncSession = Depends(get_session)):
    """根据用户自然语言输入匹配工作流

    三档降级：已有工作流匹配 → 动态组装 → 裸Agent
    """
    try:
        result = await match_service.match(body.user_input, session, TEMP_USER_ID)
        await _enrich_match_dag(result, session)
        return APIResponse(data=result)
    except Exception as e:
        logger.error(f"[Match API] Unhandled error: {e}", exc_info=True)
        return APIResponse(data=MatchResult(
            mode="bare_agent",
            reasoning=f"匹配过程异常，降级为裸 Agent：{str(e)[:100]}",
        ))
