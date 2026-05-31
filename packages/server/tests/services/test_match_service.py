"""匹配服务单元测试 — 关键词匹配（不依赖 LLM）

测试用例参考真实业务场景和现有节点能力：
- 架构图生成（architecture-diagram）
- PPT生成（ppt-master）
- 知识漫画（baoyu-comic）
- 封面图（baoyu-cover-image）
- 需求细化（refine-requirements）
"""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.match_service import _keyword_match, match


def _make_workflow(name: str, description: str = "", category: str = "", dag: dict | None = None):
    """快速构建 Workflow mock 对象，id 为真实 UUID"""
    wf = MagicMock()
    wf.id = uuid.uuid4()
    wf.name = name
    wf.description = description
    wf.category = category
    wf.dag = dag or {"nodes": [], "edges": []}
    return wf


class TestKeywordMatch:
    """关键词匹配测试 — 用真实业务场景"""

    def test_match_architecture_diagram_workflow(self):
        """真实用例：用户输入'生成微前端架构图'匹配'架构图生成'工作流"""
        workflows = [
            _make_workflow("架构图生成", "生成技术架构图，支持微服务、微前端、云基础设施等"),
            _make_workflow("PPT生成", "AI驱动的PPT制作系统"),
        ]
        result = _keyword_match("生成微前端架构图", workflows)
        assert result is not None
        assert result.mode == "matched"
        assert result.workflow_name == "架构图生成"

    def test_match_ppt_workflow(self):
        """真实用例：用户输入'做个河南美食的ppt'匹配'PPT生成'工作流"""
        workflows = [
            _make_workflow("架构图生成", "生成技术架构图"),
            _make_workflow("PPT生成", "AI驱动的PPT制作系统"),
        ]
        result = _keyword_match("做个河南美食的ppt", workflows)
        assert result is not None
        assert result.mode == "matched"
        assert result.workflow_name == "PPT生成"

    def test_match_comic_workflow(self):
        """真实用例：用户输入'画一个量子计算漫画'匹配'知识漫画'工作流"""
        workflows = [
            _make_workflow("知识漫画", "创建原创知识漫画，支持多种画风"),
            _make_workflow("架构图生成", "生成技术架构图"),
        ]
        result = _keyword_match("画一个量子计算漫画", workflows)
        assert result is not None
        assert result.workflow_name == "知识漫画"

    def test_match_cover_workflow(self):
        """真实用例：用户输入'给我的文章生成封面图'匹配'封面图生成'工作流"""
        workflows = [
            _make_workflow("封面图生成", "生成文章封面图，多种调色板和渲染风格"),
            _make_workflow("PPT生成", "AI驱动的PPT制作系统"),
        ]
        result = _keyword_match("给我的文章生成封面图", workflows)
        assert result is not None
        assert result.workflow_name == "封面图生成"

    def test_partial_match_name(self):
        """部分匹配：用户输入'架构图'匹配'架构图生成'"""
        workflows = [
            _make_workflow("架构图生成", "生成技术架构图"),
        ]
        result = _keyword_match("架构图", workflows)
        assert result is not None
        assert result.confidence >= 0.6

    def test_description_match(self):
        """描述匹配：用户输入'微前端'匹配描述中包含'微前端'的工作流"""
        workflows = [
            _make_workflow("可视化工具", "生成微前端架构图和系统拓扑"),
            _make_workflow("部署工具", "自动部署到生产环境"),
        ]
        result = _keyword_match("微前端", workflows)
        assert result is not None
        assert result.workflow_name == "可视化工具"

    def test_no_match_vague_input(self):
        """不匹配：模糊输入不匹配任何工作流"""
        workflows = [
            _make_workflow("架构图生成", "生成技术架构图"),
        ]
        result = _keyword_match("帮我写一首诗", workflows)
        assert result is None

    def test_empty_workflows(self):
        """空工作流列表返回 None"""
        result = _keyword_match("生成微前端架构图", [])
        assert result is None


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

    @pytest.mark.asyncio
    async def test_matching_returns_workflow(self):
        """匹配到工作流时返回 matched（跳过 LLM，直接测关键词匹配路径）"""
        wf = _make_workflow("架构图生成", "生成技术架构图")
        result = _keyword_match("生成微前端架构图", [wf])
        assert result is not None
        assert result.mode == "matched"
        assert result.workflow_name == "架构图生成"
