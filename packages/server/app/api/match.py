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

    # definition_id 是 NodeDefinition 的 UUID 主键，用 id 字段匹配
    id_map: dict[str, str] = {}
    db_result = await session.execute(
        select(NodeDefinition.id, NodeDefinition.display_name).where(
            NodeDefinition.id.in_(def_ids)  # type: ignore[arg-type]
        )
    )
    for node_id, display_name in db_result.all():
        id_map[str(node_id)] = display_name

    for node in result.dag.nodes:
        if node.definition_id and node.definition_id in id_map:
            node.display_name = id_map[node.definition_id]


@router.post("")
async def match(body: MatchRequest, session: AsyncSession = Depends(get_session)):
    """根据用户自然语言输入匹配工作流

    支持 Team 范围匹配：如果指定 team_id，仅在 Team 内匹配；
    未指定则先 LLM 智能匹配 Team，再在 Team 范围内匹配工作流/节点；
    Team 匹配失败则降级为全局匹配。

    四档降级：Team匹配 → Team内Workflow匹配 → Team内动态组装 → bare-Agent
    """
    try:
        result = await match_service.match(
            body.user_input, session, TEMP_USER_ID, team_id=body.team_id
        )
        await _enrich_match_dag(result, session)
        return APIResponse(data=result)
    except Exception as e:
        logger.error(f"[Match API] Unhandled error: {e}", exc_info=True)
        return APIResponse(data=MatchResult(
            mode="bare_agent",
            reasoning=f"匹配过程异常，降级为裸 Agent：{str(e)[:100]}",
        ))
