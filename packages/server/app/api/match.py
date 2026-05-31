"""匹配 API — POST /api/match"""

import logging
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import TEMP_USER_ID, get_session
from app.schemas.base import APIResponse
from app.schemas.match import MatchRequest, MatchResult
from app.services import match_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("", response_model=APIResponse[MatchResult])
async def match(body: MatchRequest, session: AsyncSession = Depends(get_session)):
    """根据用户自然语言输入匹配工作流

    三档降级：已有工作流匹配 → 动态组装 → 裸Agent
    """
    try:
        result = await match_service.match(body.user_input, session, TEMP_USER_ID)
        return APIResponse(data=result)
    except Exception as e:
        logger.error(f"[Match API] Unhandled error: {e}", exc_info=True)
        return APIResponse(data=MatchResult(
            mode="bare_agent",
            reasoning=f"匹配过程异常，降级为裸 Agent：{str(e)[:100]}",
        ))
