"""Workflow CRUD 服务 — 集成 DAG 校验"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dag.validate import DAGValidationError, validate_dag
from app.models.workflow import Workflow
from app.schemas.workflow import DAGDefinition, WorkflowCreate, WorkflowUpdate


async def list_workflows(session: AsyncSession, user_id: uuid.UUID) -> list[Workflow]:
    result = await session.execute(
        select(Workflow).where(Workflow.user_id == user_id).order_by(Workflow.updated_at.desc())
    )
    return list(result.scalars().all())


async def get_workflow(session: AsyncSession, workflow_id: uuid.UUID) -> Workflow | None:
    return await session.get(Workflow, workflow_id)


async def create_workflow(session: AsyncSession, user_id: uuid.UUID, data: WorkflowCreate) -> Workflow:
    # 校验 DAG（如果提供了）
    if data.dag:
        validate_dag(data.dag)

    dag_dict = data.dag.model_dump() if data.dag else None
    wf = Workflow(
        user_id=user_id,
        name=data.name,
        description=data.description,
        category=data.category,
        dag=dag_dict,
        input_schema=data.input_schema,
        output_schema=data.output_schema,
    )
    session.add(wf)
    await session.commit()
    await session.refresh(wf)
    return wf


async def update_workflow(session: AsyncSession, workflow: Workflow, data: WorkflowUpdate) -> Workflow:
    update_data = data.model_dump(exclude_unset=True)

    # 如果更新了 DAG，先校验
    if "dag" in update_data and update_data["dag"] is not None:
        dag = DAGDefinition(**update_data["dag"])
        validate_dag(dag)
        update_data["dag"] = dag.model_dump()

    for key, value in update_data.items():
        setattr(workflow, key, value)
    await session.commit()
    await session.refresh(workflow)
    return workflow


async def delete_workflow(session: AsyncSession, workflow: Workflow) -> None:
    await session.delete(workflow)
    await session.commit()
