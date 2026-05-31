"""LLM 统一调用客户端 — 基于 openai SDK

所有 LLM 调用都应通过此模块，避免各服务重复实现 HTTP 调用逻辑。
"""

import logging
from typing import Any

import httpx
from openai import OpenAI

from app.config.settings import settings

logger = logging.getLogger(__name__)

# 模块级单例客户端（延迟初始化）
_client: OpenAI | None = None


def get_client() -> OpenAI:
    """获取 OpenAI 客户端单例"""
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL,
            max_retries=0,  # 不重试，超时由调用方控制
        )
    return _client


def _build_call_args(
    *,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
) -> dict[str, Any]:
    """构建 chat.completions.create 的额外参数"""
    return {
        "temperature": temperature if temperature is not None else settings.LLM_TEMPERATURE,
        "top_p": top_p if top_p is not None else settings.LLM_TOP_P,
        "max_tokens": max_tokens if max_tokens is not None else settings.LLM_MAX_TOKENS,
        "presence_penalty": presence_penalty,
        "frequency_penalty": frequency_penalty,
    }


def chat(
    messages: list[dict[str, str]],
    *,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
    timeout: float | None = None,
) -> str | None:
    """同步调用 LLM，返回 assistant 消息内容

    Args:
        messages: OpenAI 格式消息列表，如 [{"role": "user", "content": "..."}]
        temperature: 覆盖默认 temperature
        top_p: 覆盖默认 top_p
        max_tokens: 覆盖默认 max_tokens
        timeout: 请求超时（秒）

    Returns:
        LLM 返回的文本内容，失败返回 None
    """
    if not settings.is_llm_configured:
        logger.info("[LLM] LLM not configured")
        return None

    try:
        client = get_client()
        call_args = _build_call_args(
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            presence_penalty=presence_penalty,
            frequency_penalty=frequency_penalty,
        )

        response = client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=messages,
            **call_args,
            stream=False,
            timeout=httpx.Timeout(timeout, connect=5.0) if timeout else None,
        )

        content = response.choices[0].message.content
        return content.strip() if content else None

    except Exception as e:
        logger.warning(f"[LLM] chat call failed: {e}")
        return None


async def achat(
    messages: list[dict[str, str]],
    *,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
    timeout: float | None = None,
) -> str | None:
    """异步调用 LLM，返回 assistant 消息内容

    使用 openai SDK 的异步接口，参数同 chat()。
    """
    if not settings.is_llm_configured:
        logger.info("[LLM] LLM not configured")
        return None

    try:
        from openai import AsyncOpenAI

        # 异步客户端单例
        global _async_client
        if _async_client is None:
            _async_client = AsyncOpenAI(
                api_key=settings.LLM_API_KEY,
                base_url=settings.LLM_BASE_URL,
                max_retries=0,  # 不重试，超时由调用方控制
            )

        call_args = _build_call_args(
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            presence_penalty=presence_penalty,
            frequency_penalty=frequency_penalty,
        )

        response = await _async_client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=messages,
            **call_args,
            stream=False,
            timeout=httpx.Timeout(timeout, connect=5.0) if timeout else None,
        )

        content = response.choices[0].message.content
        return content.strip() if content else None

    except Exception as e:
        logger.warning(f"[LLM] achat call failed: {type(e).__name__}: {e}", exc_info=True)
        return None


_async_client: Any = None
