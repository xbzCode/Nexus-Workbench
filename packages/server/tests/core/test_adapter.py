"""Adapter 层单元测试"""

import pytest
from app.adapters.events import (
    AdapterEvent, AgentThinkingEvent, ApprovalNeededEvent,
    QuestionDetectedEvent, ProgressUpdateEvent, ExecutionCompletedEvent,
)
from app.adapters.base import AgentHarnessAdapter
from app.adapters.registry import (
    register_adapter, get_adapter, list_adapters, init_adapters,
)


class TestAdapterEvents:
    """事件类型测试"""

    def test_base_event(self):
        e = AdapterEvent()
        assert isinstance(e, AdapterEvent)

    def test_thinking_event(self):
        e = AgentThinkingEvent(content="thinking...")
        assert e.content == "thinking..."
        assert isinstance(e, AdapterEvent)

    def test_approval_event(self):
        e = ApprovalNeededEvent(approval={"type": "confirm"})
        assert e.approval["type"] == "confirm"

    def test_question_event(self):
        e = QuestionDetectedEvent(question="确认执行？", options=["是", "否"])
        assert e.question == "确认执行？"
        assert len(e.options) == 2

    def test_progress_event(self):
        e = ProgressUpdateEvent(content="downloading...", progress=0.5)
        assert e.progress == 0.5

    def test_completed_event(self):
        e = ExecutionCompletedEvent(output={"status": "ok"})
        assert e.output["status"] == "ok"


class TestAdapterRegistry:
    """注册表测试"""

    def test_init_registers_codebuddy(self):
        init_adapters()
        adapters = list_adapters()
        assert "codebuddy" in adapters
        assert adapters["codebuddy"] == "CodeBuddyAdapter"

    def test_get_adapter(self):
        init_adapters()
        adapter = get_adapter("codebuddy")
        assert adapter is not None
        assert isinstance(adapter, AgentHarnessAdapter)

    def test_get_unknown_adapter(self):
        init_adapters()
        assert get_adapter("unknown") is None

    def test_register_custom_adapter(self):
        class DummyAdapter(AgentHarnessAdapter):
            async def start_session(self, config): pass
            async def send_input(self, session_id, input_data): pass
            async def on_event(self, session_id): pass
            async def respond(self, session_id, approval_id, response): pass
            async def terminate(self, session_id): pass

        dummy = DummyAdapter()
        register_adapter("dummy", dummy)
        assert get_adapter("dummy") is dummy
        assert "dummy" in list_adapters()


class TestQuestionDetection:
    """问题检测逻辑测试"""

    def _make_adapter(self):
        from app.adapters.codebuddy import CodeBuddyAdapter
        return CodeBuddyAdapter()

    def test_short_text_not_question(self):
        a = self._make_adapter()
        assert not a._detect_question("ok")

    def test_chinese_question_mark(self):
        a = self._make_adapter()
        assert a._detect_question("这个方案是否可行？")

    def test_english_question(self):
        a = self._make_adapter()
        assert a._detect_question("Would you like to proceed?")

    def test_long_statement_not_question(self):
        a = self._make_adapter()
        # 长文本但没有问号和疑问词
        assert not a._detect_question("This is a long statement without any question marks at all")

    def test_chinese_confirm_pattern(self):
        a = self._make_adapter()
        # 中文疑问关键词 + 文本>30字 → 检测为问题
        assert a._detect_question("请确认执行删除操作，这将会影响数据库中的所有记录，请确认是否继续")

    def test_empty_string(self):
        a = self._make_adapter()
        assert not a._detect_question("")


class TestTemplateRender:
    """模板渲染测试"""

    def test_simple_render(self):
        from app.adapters.codebuddy import _render_template
        result = _render_template("Hello {input.name}", {"name": "World"}, "/tmp")
        assert result == "Hello World"

    def test_nested_render(self):
        from app.adapters.codebuddy import _render_template
        result = _render_template("Task: {input.task.name}", {"task": {"name": "deploy"}}, "/tmp")
        assert result == "Task: deploy"

    def test_missing_key_fallback(self):
        from app.adapters.codebuddy import _render_template
        result = _render_template("Hello {input.missing}", {}, "/tmp")
        assert result == "Hello "

    def test_workspace_var(self):
        from app.adapters.codebuddy import _render_template
        result = _render_template("Dir: {workspace}", {}, "/my/workspace")
        assert result == "Dir: /my/workspace"
