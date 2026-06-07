"""匹配服务单元测试

注意：_keyword_match 已被 LLM 语义匹配替代（100% LLM 驱动），
关键词匹配测试已移除。当前测试覆盖 match() 主流程的降级逻辑。
"""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.match_service import match


def _make_workflow(name: str, description: str = "", category: str = "", dag: dict | None = None):
    """快速构建 Workflow mock 对象，id 为真实 UUID"""
    wf = MagicMock()
    wf.id = uuid.uuid4()
    wf.name = name
    wf.description = description
    wf.category = category
    wf.dag = dag or {"nodes": [], "edges": []}
    return wf


class TestMatchFallback:
    """匹配降级测试"""

    @pytest.mark.asyncio
    async def test_no_workflows_falls_to_bare_agent(self):
        """没有工作流时降级为裸 Agent"""
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().all.return_value = []
        mock_session.execute.return_value = mock_result

        result = await match("生成微前端架构图", mock_session, uuid.uuid4())
        assert result.mode == "bare_agent"
