"""AST 条件求值 — 安全解析条件表达式

白名单：
  - 比较运算符: ==, !=, <, >, <=, >=, in, not in, is, is not
  - 逻辑运算符: and, or, not
  - 属性访问: output.status, output.detail.code
  - 字面量: 字符串, 数字, True, False, None
  - 内置函数: len, str, int, float, bool

禁止：
  - import, exec, eval, __import__
  - 函数定义 (def, lambda)
  - 属性赋值
  - 下标访问之外的调用
  - 任意函数调用（仅白名单函数）

变量：
  - output: 上游节点的输出 dict
"""

from __future__ import annotations

import ast
from typing import Any


class _DotDict(dict):
    """支持属性访问的 dict，用于条件求值中的 output.status 等语法"""

    def __getattr__(self, key: str) -> Any:
        try:
            value = self[key]
            if isinstance(value, dict) and not isinstance(value, _DotDict):
                value = _DotDict(value)
                self[key] = value
            return value
        except KeyError:
            raise AttributeError(f"'dict' object has no attribute '{key}'")


class ConditionError(Exception):
    """条件表达式安全检查失败"""
    pass


# 内置函数白名单
SAFE_BUILTINS = {
    "len": len,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "True": True,
    "False": False,
    "None": None,
}

# 条件内置函数
CONDITION_BUILTINS = {
    "success": lambda output: output.get("status") == "completed",
    "failed": lambda output: output.get("status") == "failed",
    "has_key": lambda output, k: k in output,
}


class _ASTValidator(ast.NodeVisitor):
    """AST 安全检查器，拒绝不安全的节点"""

    _FORBIDDEN_TYPES = [
        ast.Import, ast.ImportFrom,
        ast.Global, ast.Nonlocal,
        ast.FunctionDef, ast.AsyncFunctionDef,
        ast.ClassDef, ast.Lambda,
        ast.Assign, ast.AugAssign, ast.AnnAssign,
        ast.Delete, ast.Try, ast.With, ast.AsyncWith,
    ]
    # ast.Exec was removed in Python 3.13
    if hasattr(ast, "Exec"):
        _FORBIDDEN_TYPES.append(ast.Exec)

    FORBIDDEN_NODES = tuple(_FORBIDDEN_TYPES)

    def __init__(self) -> None:
        self.errors: list[str] = []

    def visit(self, node: ast.AST) -> None:
        # 检查禁止的节点类型
        if isinstance(node, self.FORBIDDEN_NODES):
            self.errors.append(f"禁止使用: {type(node).__name__}")
            return

        # 检查函数调用 — 只允许白名单函数
        if isinstance(node, ast.Call):
            func_name = self._get_func_name(node.func)
            if func_name and func_name not in CONDITION_BUILTINS and func_name not in SAFE_BUILTINS:
                self.errors.append(f"禁止调用函数: {func_name}")
                return

        # 检查属性访问 — 禁止 __dunder__
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                self.errors.append(f"禁止访问私有属性: {node.attr}")
                return

        # 检查名称引用
        if isinstance(node, ast.Name):
            if node.id.startswith("_"):
                self.errors.append(f"禁止引用: {node.id}")
                return

        self.generic_visit(node)

    def _get_func_name(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        return None


def _validate_condition(expr: str) -> None:
    """校验条件表达式的安全性"""
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ConditionError(f"条件表达式语法错误: {e}")

    validator = _ASTValidator()
    validator.visit(tree)
    if validator.errors:
        raise ConditionError("; ".join(validator.errors))


def evaluate_condition(condition: str, output: dict[str, Any]) -> bool:
    """安全求值条件表达式

    Args:
        condition: 条件表达式，如 "output.status == 'completed'"
        output: 上游节点的输出 dict

    Returns:
        条件是否为 True

    Raises:
        ConditionError: 表达式不安全或语法错误
    """
    _validate_condition(condition)

    # 将 output 包装为 DotDict，支持属性访问
    dot_output = _DotDict(output) if isinstance(output, dict) else output

    # 构建安全的执行命名空间
    safe_ns: dict[str, Any] = {
        "output": dot_output,
        **CONDITION_BUILTINS,
        **SAFE_BUILTINS,
        "__builtins__": {},
    }

    try:
        result = eval(condition, safe_ns)  # noqa: S307 — 已通过 AST 白名单校验
    except Exception as e:
        raise ConditionError(f"条件求值失败: {e}")

    return bool(result)
