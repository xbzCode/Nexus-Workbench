"""端到端 API 集成测试

需要先启动服务：uvicorn app.main:app --port 8000
然后运行：pytest tests/e2e/ -v
"""

import time
import uuid

import httpx
import pytest

BASE = "http://localhost:8000/api"
UID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(scope="module")
def ts():
    """时间戳后缀，避免唯一约束冲突"""
    return str(int(time.time()))


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE, timeout=10) as c:
        yield c


def _create_wf(client, ts, name_suffix="", **overrides):
    payload = {
        "name": f"e2e-wf-{ts}{name_suffix}",
        "description": "e2e test workflow",
        "user_id": UID,
        "dag": {
            "nodes": [
                {"id": "A", "definition_id": "n1"},
                {"id": "B", "definition_id": "n2"},
            ],
            "edges": [{"source_id": "A", "target_id": "B"}],
        },
    }
    payload.update(overrides)
    return client.post("/workflows", json=payload)


# ── Workflow CRUD ──


class TestWorkflowCRUD:
    def test_create_workflow(self, client, ts):
        r = _create_wf(client, ts)
        assert r.status_code == 201
        data = r.json()["data"]
        assert data["name"] == f"e2e-wf-{ts}"
        assert len(data["dag"]["nodes"]) == 2

    def test_get_workflow(self, client, ts):
        r = _create_wf(client, ts, name_suffix="-get")
        wf_id = r.json()["data"]["id"]
        r2 = client.get(f"/workflows/{wf_id}")
        assert r2.status_code == 200
        assert r2.json()["data"]["name"] == f"e2e-wf-{ts}-get"

    def test_update_workflow(self, client, ts):
        r = _create_wf(client, ts, name_suffix="-upd")
        wf_id = r.json()["data"]["id"]
        r2 = client.put(f"/workflows/{wf_id}", json={"description": "updated"})
        assert r2.status_code == 200

    def test_list_workflows(self, client):
        r = client.get("/workflows")
        assert r.status_code == 200
        assert isinstance(r.json()["data"], list)

    def test_cyclic_dag_rejected(self, client, ts):
        r = client.post("/workflows", json={
            "name": f"cyclic-wf-{ts}",
            "user_id": UID,
            "dag": {
                "nodes": [
                    {"id": "A", "definition_id": "n1"},
                    {"id": "B", "definition_id": "n2"},
                    {"id": "C", "definition_id": "n3"},
                ],
                "edges": [
                    {"source_id": "A", "target_id": "B"},
                    {"source_id": "B", "target_id": "C"},
                    {"source_id": "C", "target_id": "A"},
                ],
            },
        })
        assert r.status_code == 400


# ── Task CRUD + Execution ──


class TestTaskExecution:
    def test_create_and_start_task(self, client, ts):
        # 创建 workflow
        r = _create_wf(client, ts, name_suffix="-task")
        wf_id = r.json()["data"]["id"]

        # 创建 task
        r2 = client.post("/tasks", json={
            "title": f"e2e-task-{ts}",
            "workflow_id": wf_id,
        })
        assert r2.status_code == 201
        task_id = r2.json()["data"]["id"]

        # 启动 task
        r3 = client.post(f"/tasks/{task_id}/start")
        assert r3.status_code == 200
        assert r3.json()["data"]["status"] == "running"

        # 等待执行完成（重试最多5秒）
        for _ in range(10):
            time.sleep(0.5)
            r4 = client.get(f"/tasks/{task_id}")
            if r4.json()["data"]["status"] in ("completed", "failed"):
                break
        assert r4.json()["data"]["status"] == "completed"

    def test_list_tasks(self, client):
        r = client.get("/tasks")
        assert r.status_code == 200
        assert isinstance(r.json()["data"], list)


# ── NodeDefinition ──


class TestNodeDefinition:
    def test_create_node(self, client, ts):
        r = client.post("/nodes", json={
            "name": f"test-node-{ts}",
            "display_name": "Test Node E2E",
            "author_id": UID,
            "adapter_type": "codebuddy",
            "default_config": {"prompt_template": "Do task"},
        })
        assert r.status_code == 201
        assert r.json()["data"]["name"] == f"test-node-{ts}"


# ── Approval ──


class TestApproval:
    def test_create_and_resolve_approval(self, client, ts):
        # 先创建 workflow + task
        r = _create_wf(client, ts, name_suffix="-approval")
        wf_id = r.json()["data"]["id"]
        r2 = client.post("/tasks", json={
            "title": f"e2e-approval-{ts}",
            "workflow_id": wf_id,
        })
        task_id = r2.json()["data"]["id"]

        # 创建 approval
        r3 = client.post("/approvals", json={
            "task_id": task_id,
            "user_id": UID,
            "source": "workflow",
            "title": "Approve step A?",
        })
        assert r3.status_code == 201
        approval_id = r3.json()["data"]["id"]

        # 解析 approval
        r4 = client.post(f"/approvals/{approval_id}/resolve", json={
            "status": "approved",
            "result": {"approved": True},
        })
        assert r4.status_code == 200


# ── Snapshot ──


class TestSnapshot:
    def test_create_snapshot(self, client, ts):
        # 先创建 workflow + task
        r = _create_wf(client, ts, name_suffix="-snapshot")
        wf_id = r.json()["data"]["id"]
        r2 = client.post("/tasks", json={
            "title": f"e2e-snapshot-{ts}",
            "workflow_id": wf_id,
        })
        task_id = r2.json()["data"]["id"]

        # 创建 snapshot
        r3 = client.post("/snapshots", json={
            "task_id": task_id,
            "type": "manual",
            "git_commit_hash": "abc123def456abc123def456abc123def456abcd",
        })
        assert r3.status_code == 201
