"""assembly_service 单元测试"""

import pytest

from app.services.assembly_service import _llm_assemble


class TestLLMAssemble:
    """测试 LLM 组装逻辑（LLM 不可用时返回 None）"""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_api_key(self):
        """LLM API key 未配置时返回 None"""
        # 默认 settings.LLM_API_KEY == "your-api-key"
        result = await _llm_assemble("生成架构图", [
            {"name": "architecture-diagram", "display_name": "架构图生成", "description": "生成技术架构图"},
        ])
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_no_nodes(self):
        """节点列表为空时 LLM 无法组装"""
        result = await _llm_assemble("生成架构图", [])
        # 空节点列表 → prompt 里没有可用节点 → LLM 应该返回 can_assemble=false
        # 但因为没配 API key，直接返回 None
        assert result is None
