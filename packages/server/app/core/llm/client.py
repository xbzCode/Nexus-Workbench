"""LLM 统一调用客户端 — 基于 openai SDK

所有 LLM 调用都应通过此模块，避免各服务重复实现 HTTP 调用逻辑。
"""

import json
import logging
import time
from typing import Any

import httpx
from openai import OpenAI

from app.config.settings import settings

logger = logging.getLogger(__name__)

# 统一任务日志入口
from app.config.logging import tlog, task_summary, PHASE_LLM, PHASE_ERROR


def _log_llm_call(
    direction: str,
    caller: str,
    messages: list[dict[str, str]],
    content: str | None,
    *,
    model: str = "",
    elapsed: float = 0.0,
    error: str | None = None,
    extra: dict | None = None,
) -> None:
    """统一记录 LLM 调用日志

    Args:
        direction: "request" | "response" | "error"
        caller: 调用方标识（如 "analyze_agent_output", "match_unified"）
        messages: 发送给 LLM 的消息列表
        content: LLM 返回的文本内容
        model: 使用的模型名
        elapsed: 调用耗时（秒）
        error: 错误信息
        extra: 附加信息
    """
    _tlog = tlog()
    sep = "─" * 40

    if direction == "request":
        _tlog.info("LLM REQUEST | caller=%s | model=%s", caller, model or settings.LLM_MODEL)
        for i, msg in enumerate(messages):
            role = msg.get("role", "?")
            text = msg.get("content", "")
            _tlog.info("LLM PROMPT [%d] | role=%s | len=%d", i, role, len(text))
            _tlog.debug("LLM PROMPT [%d] | role=%s | content=%s", i, role, text[:2000])
        if extra:
            _tlog.info("LLM REQUEST EXTRA | %s", json.dumps(extra, ensure_ascii=False, default=str)[:300])

    elif direction == "response":
        _tlog.info("LLM RESPONSE | caller=%s | model=%s | elapsed=%.2fs | content_len=%d",
                   caller, model or settings.LLM_MODEL, elapsed, len(content or ""))
        if content:
            _tlog.debug("LLM RESPONSE | caller=%s | content=%s", caller, content[:3000])

    elif direction == "error":
        _tlog.warning("LLM ERROR | caller=%s | elapsed=%.2fs | error=%s", caller, elapsed, error)


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
    caller: str = "",
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
    timeout: float | None = None,
) -> str | None:
    """同步调用 LLM，返回 assistant 消息内容"""
    if not settings.is_llm_configured:
        logger.info("[LLM] LLM not configured")
        return None

    caller = caller or _guess_caller()
    _log_llm_call("request", caller, messages, None, extra={"temperature": temperature, "max_tokens": max_tokens})
    t0 = time.monotonic()

    try:
        client = get_client()
        call_args = _build_call_args(
            temperature=temperature, top_p=top_p, max_tokens=max_tokens,
            presence_penalty=presence_penalty, frequency_penalty=frequency_penalty,
        )

        response = client.chat.completions.create(
            model=settings.LLM_MODEL, messages=messages, **call_args,
            stream=False,
            timeout=httpx.Timeout(timeout, connect=5.0) if timeout else None,
        )

        content = response.choices[0].message.content
        result = content.strip() if content else None
        elapsed = time.monotonic() - t0
        _log_llm_call("response", caller, messages, result, elapsed=elapsed)
        return result

    except Exception as e:
        elapsed = time.monotonic() - t0
        _log_llm_call("error", caller, messages, None, elapsed=elapsed, error=str(e))
        logger.warning("[LLM] chat call failed: %s", e)
        return None


async def achat(
    messages: list[dict[str, str]],
    *,
    caller: str = "",
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
    timeout: float | None = None,
) -> str | None:
    """异步调用 LLM，返回 assistant 消息内容"""
    if not settings.is_llm_configured:
        logger.info("[LLM] LLM not configured")
        return None

    caller = caller or _guess_caller()
    _log_llm_call("request", caller, messages, None, extra={"temperature": temperature, "max_tokens": max_tokens})
    t0 = time.monotonic()

    try:
        from openai import AsyncOpenAI

        global _async_client
        if _async_client is None:
            _async_client = AsyncOpenAI(
                api_key=settings.LLM_API_KEY,
                base_url=settings.LLM_BASE_URL,
                max_retries=0,
            )

        call_args = _build_call_args(
            temperature=temperature, top_p=top_p, max_tokens=max_tokens,
            presence_penalty=presence_penalty, frequency_penalty=frequency_penalty,
        )

        response = await _async_client.chat.completions.create(
            model=settings.LLM_MODEL, messages=messages, **call_args,
            stream=False,
            timeout=httpx.Timeout(timeout, connect=5.0) if timeout else None,
        )

        content = response.choices[0].message.content
        result = content.strip() if content else None
        elapsed = time.monotonic() - t0
        _log_llm_call("response", caller, messages, result, elapsed=elapsed)
        return result

    except Exception as e:
        elapsed = time.monotonic() - t0
        _log_llm_call("error", caller, messages, None, elapsed=elapsed, error=f"{type(e).__name__}: {e}")
        logger.warning("[LLM] achat call failed: %s: %s", type(e).__name__, e)
        return None


_async_client: Any = None


def _guess_caller() -> str:
    """推断调用方函数名（当 caller 未显式传入时）"""
    import inspect
    try:
        frame = inspect.currentframe()
        if frame and frame.f_back and frame.f_back.f_back:
            return frame.f_back.f_back.f_code.co_name
    except Exception:
        pass
    return "unknown"
