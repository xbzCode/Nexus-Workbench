"""DAG 序列化/反序列化 — JSONB ↔ DAGDefinition ↔ DAGContext"""

from __future__ import annotations

from app.core.dag.model import DAGContext
from app.core.dag.validate import DAGValidationError, validate_dag
from app.schemas.workflow import DAGDefinition


def dag_to_dict(dag: DAGDefinition) -> dict:
    """DAGDefinition → JSONB 字典"""
    return dag.model_dump()


def dag_from_dict(data: dict, *, validate: bool = True) -> DAGContext:
    """JSONB 字典 → DAGContext

    Args:
        data: JSONB 字典
        validate: 是否执行校验（默认 True）

    Returns:
        DAGContext

    Raises:
        DAGValidationError: 校验不通过
    """
    dag = DAGDefinition(**data)
    if validate:
        return validate_dag(dag)
    return DAGContext(dag=dag)


def dag_from_definition(dag: DAGDefinition, *, validate: bool = True) -> DAGContext:
    """DAGDefinition → DAGContext"""
    if validate:
        return validate_dag(dag)
    return DAGContext(dag=dag)
