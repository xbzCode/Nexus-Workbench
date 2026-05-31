"""DAG 引擎核心测试 — 环检测/拓扑排序/条件求值/数据传递/执行引擎"""

import asyncio
import pytest

from app.core.dag.model import DAGContext
from app.core.dag.validate import DAGValidationError, validate_dag
from app.core.dag.serializer import dag_from_dict, dag_to_dict
from app.core.scheduler.topo_sort import topo_sort
from app.core.scheduler.condition import ConditionError, evaluate_condition
from app.core.scheduler.data_flow import compute_node_input
from app.core.events.bus import EventBus, Event
from app.core.executor.engine import execute_dag
from app.schemas.workflow import DAGDefinition, NodeInstance, EdgeDef


# ── 环检测 ──

class TestCycleDetection:
    def test_no_cycle(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1"), NodeInstance(id="B", definition_id="n2")],
            edges=[EdgeDef(source_id="A", target_id="B")],
        )
        ctx = validate_dag(dag)  # 不应抛异常
        assert "A" in ctx.node_ids()

    def test_simple_cycle(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1"), NodeInstance(id="B", definition_id="n2")],
            edges=[EdgeDef(source_id="A", target_id="B"), EdgeDef(source_id="B", target_id="A")],
        )
        with pytest.raises(DAGValidationError, match="环"):
            validate_dag(dag)

    def test_self_loop(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1")],
            edges=[EdgeDef(source_id="A", target_id="A")],
        )
        with pytest.raises(DAGValidationError, match="自环"):
            validate_dag(dag)

    def test_three_node_cycle(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
                NodeInstance(id="C", definition_id="n3"),
            ],
            edges=[
                EdgeDef(source_id="A", target_id="B"),
                EdgeDef(source_id="B", target_id="C"),
                EdgeDef(source_id="C", target_id="A"),
            ],
        )
        with pytest.raises(DAGValidationError, match="环"):
            validate_dag(dag)

    def test_duplicate_node_id(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1"), NodeInstance(id="A", definition_id="n2")],
            edges=[],
        )
        with pytest.raises(DAGValidationError, match="重复"):
            validate_dag(dag)

    def test_edge_references_missing_node(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1")],
            edges=[EdgeDef(source_id="A", target_id="B")],
        )
        with pytest.raises(DAGValidationError, match="不存在"):
            validate_dag(dag)


# ── 拓扑排序 ──

class TestTopoSort:
    def test_linear(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
                NodeInstance(id="C", definition_id="n3"),
            ],
            edges=[
                EdgeDef(source_id="A", target_id="B"),
                EdgeDef(source_id="B", target_id="C"),
            ],
        )
        ctx = validate_dag(dag)
        levels = topo_sort(ctx)
        assert levels == [["A"], ["B"], ["C"]]

    def test_parallel(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
                NodeInstance(id="C", definition_id="n3"),
            ],
            edges=[
                EdgeDef(source_id="A", target_id="B"),
                EdgeDef(source_id="A", target_id="C"),
            ],
        )
        ctx = validate_dag(dag)
        levels = topo_sort(ctx)
        assert levels[0] == ["A"]
        assert set(levels[1]) == {"B", "C"}

    def test_diamond(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
                NodeInstance(id="C", definition_id="n3"),
                NodeInstance(id="D", definition_id="n4"),
            ],
            edges=[
                EdgeDef(source_id="A", target_id="B"),
                EdgeDef(source_id="A", target_id="C"),
                EdgeDef(source_id="B", target_id="D"),
                EdgeDef(source_id="C", target_id="D"),
            ],
        )
        ctx = validate_dag(dag)
        levels = topo_sort(ctx)
        assert levels[0] == ["A"]
        assert set(levels[1]) == {"B", "C"}
        assert levels[2] == ["D"]


# ── 条件求值 ──

class TestConditionEval:
    def test_simple_equality(self):
        output = {"status": "completed", "summary": "done"}
        assert evaluate_condition("output.status == 'completed'", output) is True
        assert evaluate_condition("output.status == 'failed'", output) is False

    def test_not_equal(self):
        output = {"status": "completed"}
        assert evaluate_condition("output.status != 'failed'", output) is True

    def test_and_or(self):
        output = {"status": "completed", "change_type": "code"}
        assert evaluate_condition("output.status == 'completed' and output.change_type == 'code'", output) is True
        assert evaluate_condition("output.status == 'failed' or output.change_type == 'code'", output) is True

    def test_builtin_success(self):
        output = {"status": "completed"}
        assert evaluate_condition("success(output)", output) is True

    def test_builtin_failed(self):
        output = {"status": "failed"}
        assert evaluate_condition("failed(output)", output) is True

    def test_builtin_has_key(self):
        output = {"detail": {"code": "hello"}}
        assert evaluate_condition("has_key(output, 'detail')", output) is True
        assert evaluate_condition("has_key(output, 'missing')", output) is False

    def test_dangerous_import(self):
        with pytest.raises(ConditionError):
            evaluate_condition("__import__('os')", {})

    def test_dangerous_private_attr(self):
        with pytest.raises(ConditionError):
            evaluate_condition("output.__class__", {})

    def test_dangerous_lambda(self):
        with pytest.raises(ConditionError):
            evaluate_condition("(lambda: 1)()", {})

    def test_syntax_error(self):
        with pytest.raises(ConditionError, match="语法错误"):
            evaluate_condition("output.status ==", {})


# ── 数据传递 ──

class TestDataFlow:
    def test_semantic_transfer(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(source_id="A", target_id="B")],
        )
        ctx = DAGContext(dag=dag)
        node_outputs = {"A": {"status": "completed", "summary": "code generated", "detail": {"code": "x=1"}}}
        inp = compute_node_input(ctx, "B", node_outputs)
        assert inp["previous_status"] == "completed"
        assert inp["previous_output"] == "code generated"
        assert inp["previous_detail"] == {"code": "x=1"}

    def test_root_node_gets_workflow_input(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1")],
            edges=[],
        )
        ctx = DAGContext(dag=dag)
        inp = compute_node_input(ctx, "A", {}, workflow_input={"task": "fix bug"})
        assert inp["task_input"] == {"task": "fix bug"}

    def test_precise_mapping(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(
                source_id="A", target_id="B",
                data_mapping={"source_code": "$prev.output.detail.code"},
            )],
        )
        ctx = DAGContext(dag=dag)
        node_outputs = {"A": {"output": {"detail": {"code": "print('hello')"}}}}
        inp = compute_node_input(ctx, "B", node_outputs)
        assert inp["source_code"] == "print('hello')"

    def test_workflow_input_mapping(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(
                source_id="A", target_id="B",
                data_mapping={"env": "$workflow.input"},
            )],
        )
        ctx = DAGContext(dag=dag)
        node_outputs = {"A": {"status": "completed"}}
        inp = compute_node_input(ctx, "B", node_outputs, workflow_input={"project": "test"})
        assert inp["env"] == {"project": "test"}


# ── 序列化 ──

class TestSerializer:
    def test_round_trip(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1")],
            edges=[],
        )
        d = dag_to_dict(dag)
        ctx = dag_from_dict(d)
        assert "A" in ctx.node_ids()

    def test_validate_on_deserialize(self):
        bad_dict = {
            "nodes": [{"id": "A", "definition_id": "n1"}],
            "edges": [{"source_id": "A", "target_id": "A"}],
        }
        with pytest.raises(DAGValidationError, match="自环"):
            dag_from_dict(bad_dict)


# ── 事件总线 ──

class TestEventBus:
    @pytest.mark.asyncio
    async def test_subscribe_and_emit(self):
        bus = EventBus()
        queue = bus.subscribe("test_event")
        bus.emit(Event(event_type="test_event", data={"key": "value"}))
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event.event_type == "test_event"
        assert event.data["key"] == "value"

    @pytest.mark.asyncio
    async def test_global_subscribe(self):
        bus = EventBus()
        queue = bus.subscribe()  # 全局订阅
        bus.emit(Event(event_type="any_event", data={"x": 1}))
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event.event_type == "any_event"

    @pytest.mark.asyncio
    async def test_filtered_subscribe(self):
        bus = EventBus()
        queue_a = bus.subscribe("event_a")
        queue_b = bus.subscribe("event_b")
        bus.emit(Event(event_type="event_a", data={}))
        bus.emit(Event(event_type="event_b", data={}))
        a_event = await asyncio.wait_for(queue_a.get(), timeout=1.0)
        assert a_event.event_type == "event_a"
        b_event = await asyncio.wait_for(queue_b.get(), timeout=1.0)
        assert b_event.event_type == "event_b"


# ── Mock 执行引擎 ──

class TestExecuteDAG:
    @pytest.mark.asyncio
    async def test_simple_linear_execution(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(source_id="A", target_id="B")],
        )
        bus = EventBus()
        outputs = await execute_dag(dag, bus, workflow_input={"task": "test"})
        assert outputs["A"]["status"] == "completed"
        assert outputs["B"]["status"] == "completed"

    @pytest.mark.asyncio
    async def test_parallel_execution(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
                NodeInstance(id="C", definition_id="n3"),
            ],
            edges=[
                EdgeDef(source_id="A", target_id="B"),
                EdgeDef(source_id="A", target_id="C"),
            ],
        )
        bus = EventBus()
        outputs = await execute_dag(dag, bus)
        assert all(o["status"] == "completed" for o in outputs.values())

    @pytest.mark.asyncio
    async def test_condition_skips_node(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(source_id="A", target_id="B", condition="output.status == 'failed'")],
        )
        bus = EventBus()
        outputs = await execute_dag(dag, bus)
        # A 正常完成 (status=completed)，条件 output.status=='failed' 为 False → B 被跳过
        assert outputs["A"]["status"] == "completed"
        assert outputs["B"]["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_condition_passes_node(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(source_id="A", target_id="B", condition="success(output)")],
        )
        bus = EventBus()
        outputs = await execute_dag(dag, bus)
        assert outputs["A"]["status"] == "completed"
        assert outputs["B"]["status"] == "completed"

    @pytest.mark.asyncio
    async def test_event_emission(self):
        dag = DAGDefinition(
            nodes=[NodeInstance(id="A", definition_id="n1")],
            edges=[],
        )
        bus = EventBus()
        events: list[Event] = []
        queue = bus.subscribe()

        async def _collect():
            for _ in range(8):  # 预期8个事件（单节点DAG）
                try:
                    e = await asyncio.wait_for(queue.get(), timeout=5.0)
                    events.append(e)
                except asyncio.TimeoutError:
                    break

        collect_task = asyncio.create_task(_collect())
        # 等收集任务先开始
        await asyncio.sleep(0.1)
        await execute_dag(dag, bus)
        await collect_task

        event_types = [e.event_type for e in events]
        assert "dag:validation_passed" in event_types
        assert "dag:node_started" in event_types
        assert "dag:node_completed" in event_types
        assert "dag:execution_completed" in event_types

    @pytest.mark.asyncio
    async def test_data_flow_between_nodes(self):
        dag = DAGDefinition(
            nodes=[
                NodeInstance(id="A", definition_id="n1"),
                NodeInstance(id="B", definition_id="n2"),
            ],
            edges=[EdgeDef(source_id="A", target_id="B")],
        )
        bus = EventBus()
        outputs = await execute_dag(dag, bus, workflow_input={"task": "test"})
        # B 应该收到 A 的语义传递数据
        b_input = outputs["B"]["detail"]["input_received"]
        assert "previous_status" in b_input
        assert b_input["previous_status"] == "completed"
