"""自验证执行器 — 运行节点配置的 validation.commands

流程：
1. 读取 NodeDefinition.validation.commands
2. subprocess.run 逐条执行
3. 收集输出
4. 失败 → 触发 rollback

迭代2: 实现基本逻辑，与真实 NodeDefinition 的集成在迭代5完成
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass
class ValidationResult:
    """验证结果"""
    passed: bool
    command: str
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    error: str | None = None


async def run_validation(commands: list[str], cwd: str | None = None) -> list[ValidationResult]:
    """执行验证命令列表

    Args:
        commands: 验证命令列表，如 ["npm run lint", "npm test"]
        cwd: 执行目录

    Returns:
        每条命令的验证结果
    """
    results: list[ValidationResult] = []

    for cmd in commands:
        result = await _run_single_command(cmd, cwd)
        results.append(result)
        if not result.passed:
            break  # 遇到失败即停止

    return results


async def _run_single_command(cmd: str, cwd: str | None = None) -> ValidationResult:
    """执行单条验证命令"""
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        return ValidationResult(
            passed=proc.returncode == 0,
            command=cmd,
            exit_code=proc.returncode,
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
        )
    except asyncio.TimeoutError:
        return ValidationResult(
            passed=False,
            command=cmd,
            error="Command timed out (300s)",
        )
    except Exception as e:
        return ValidationResult(
            passed=False,
            command=cmd,
            error=str(e),
        )


def all_passed(results: list[ValidationResult]) -> bool:
    """检查所有验证命令是否通过"""
    return all(r.passed for r in results)
