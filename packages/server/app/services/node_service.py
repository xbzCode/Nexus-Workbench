"""NodeDefinition CRUD 服务"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import NodeDefinition, NodeValidation
from app.schemas.node import NodeDefCreate, NodeDefUpdate


async def list_nodes(session: AsyncSession, category: str | None = None) -> list[NodeDefinition]:
    stmt = select(NodeDefinition).order_by(NodeDefinition.name)
    if category:
        stmt = stmt.where(NodeDefinition.category == category)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_node(session: AsyncSession, node_id: uuid.UUID) -> NodeDefinition | None:
    return await session.get(NodeDefinition, node_id)


async def get_node_by_name(session: AsyncSession, name: str) -> NodeDefinition | None:
    """按 name 查询节点定义"""
    stmt = select(NodeDefinition).where(NodeDefinition.name == name)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_node(session: AsyncSession, user_id: uuid.UUID, data: NodeDefCreate) -> NodeDefinition:
    node = NodeDefinition(
        author_id=user_id,
        name=data.name,
        display_name=data.display_name,
        description=data.description,
        category=data.category,
        adapter_type=data.adapter_type,
        config_schema=data.config_schema,
        input_schema=data.input_schema,
        output_schema=data.output_schema,
        default_config=data.default_config,
        skill_md=data.skill_md,
    )
    session.add(node)
    await session.flush()

    if data.validation:
        validation = NodeValidation(
            node_definition_id=node.id,
            commands=data.validation.commands,
            auto_rollback=data.validation.auto_rollback,
            max_retries=data.validation.max_retries,
            retry_backoff=data.validation.retry_backoff,
        )
        session.add(validation)

    await session.commit()
    await session.refresh(node)
    return node


async def update_node(session: AsyncSession, node: NodeDefinition, data: NodeDefUpdate) -> NodeDefinition:
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(node, key, value)
    await session.commit()
    await session.refresh(node)
    return node


async def delete_node(session: AsyncSession, node: NodeDefinition) -> None:
    await session.delete(node)
    await session.commit()
