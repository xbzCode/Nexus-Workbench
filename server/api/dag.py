"""DAG 引擎测试 API — 手动触发 DAG 执行验证"""

from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from server.models.schemas import DAGDefinition
from server.services.store import store
from server.core.dag import validate_dag, has_cycle
from server.core.scheduler import topological_sort, evaluate_condition
from server.core.executor import execute_dag

router = APIRouter(prefix="/api/dag", tags=["dag"])


class DagRequest(BaseModel):
    dag: dict = {}
    input: dict = {}
    condition: Optional[str] = None
    output: dict = {}


@router.post("/validate")
async def validate(req: DagRequest):
    """校验 DAG 定义"""
    dag = DAGDefinition(**req.dag)
    errors = validate_dag(dag, store.nodes)
    return {"valid": len(errors) == 0, "errors": errors, "has_cycle": has_cycle(dag)}


@router.post("/topological-sort")
async def topo_sort(req: DagRequest):
    """拓扑排序"""
    dag = DAGDefinition(**req.dag)
    levels = topological_sort(dag)
    return {"levels": levels}


@router.post("/evaluate-condition")
async def eval_condition(req: DagRequest):
    """条件求值测试"""
    result = evaluate_condition(req.condition, req.output)
    return {"result": result}


@router.post("/execute")
async def execute(req: DagRequest):
    """执行 DAG（Mock）"""
    dag = DAGDefinition(**req.dag)
    input_data = req.input

    errors = validate_dag(dag, store.nodes)
    if errors:
        raise HTTPException(400, f"DAG 校验失败: {errors}")

    result = await execute_dag(dag, input_data, store.nodes)
    return {"outputs": result}
