"""应用日志配置 — 控制台 + 文件双输出 + 任务执行调试日志

初始化方式：在 main.py lifespan 中调用 setup_logging()

日志策略：
- Console：只输出应用关键信息和任务摘要（一行），第三方库 WARNING+
- File (app.log)：记录应用日志，第三方库 WARNING+
- File (task_execution.log)：所有任务执行日志的全局汇总
- File (tasks/{task_id}.log)：每个任务独立日志文件，方便快速排查

两条日志通道（不双写）：
- logger（应用日志）：记录应用生命周期，输出到 console + app.log
- tlog（任务日志）：记录任务执行链路，输出到 task_execution.log + tasks/{id}.log
  - 不冒泡到 root，不会淹没控制台
  - 关键事件通过 task_summary() 输出一行摘要到控制台

任务日志视觉区分：
- 使用阶段标签（MATCH / TASK / NODE / LLM / APPROVAL / RESULT / ERROR）
- ═══ 标记任务级边界（TASK START/END）
- ─── 标记节点级边界（NODE START/END）

Per-Task 日志机制：
- 使用 ContextVar 在 asyncio 上下文中传递 current_task_id
- PerTaskFileHandler 检查 ContextVar，将日志路由到对应任务文件
- 任务开始时 set_current_task_id()，结束时 close_task_log() 释放文件句柄
"""

import logging
import threading
import sys
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path

# 第三方库 logger — 仅设 WARNING 级别，通过 propagate 传播到 root handler
_NOISY_LOGGERS = ("sqlalchemy.engine", "httpx", "httpcore", "openai._base_client")

# ── 任务上下文：用于按任务路由日志 ──
_current_task_id: ContextVar[str | None] = ContextVar("current_task_id", default=None)


def set_current_task_id(task_id: str | None) -> None:
    """设置当前任务的 task_id（在后台 asyncio.Task 开头调用）

    设置后，所有通过 tlog() 输出的日志会自动路由到
    logs/tasks/{task_id}.log 文件。
    """
    _current_task_id.set(task_id)


def get_current_task_id() -> str | None:
    """获取当前上下文中的 task_id"""
    return _current_task_id.get()


def close_task_log(task_id: str) -> None:
    """关闭指定任务的日志文件句柄（任务结束时调用，释放文件锁）"""
    handler = _get_per_task_handler()
    if handler:
        handler.close_task_file(task_id)


def get_task_log_path(task_id: str) -> Path | None:
    """获取指定任务的日志文件路径"""
    handler = _get_per_task_handler()
    if handler:
        path = handler.get_task_log_path(task_id)
        if path and path.exists():
            return path
    return None


# ── 阶段标签 ──

PHASE_MATCH = "MATCH"
PHASE_TASK = "TASK"
PHASE_NODE = "NODE"
PHASE_LLM = "LLM"
PHASE_ADAPTER = "ADAPTER"
PHASE_APPROVAL = "APPROVAL"
PHASE_RESULT = "RESULT"
PHASE_ERROR = "ERROR"

# 分隔线
_THICK = "═" * 60
_THIN = "─" * 60


# ── tlog: 统一任务日志入口 ──

def tlog() -> logging.Logger:
    """获取任务执行日志 logger

    所有任务执行链路的日志都应通过此函数获取，确保：
    - 日志写入 task_execution.log（全局汇总）
    - 日志写入 tasks/{task_id}.log（按任务拆分）
    - 不冒泡到 root logger，不会淹没控制台
    """
    return logging.getLogger("task_execution")


# 兼容旧代码
get_task_logger = tlog


def task_summary(message: str, *args) -> None:
    """输出任务摘要到控制台（通过 root logger）

    用于关键事件的一行摘要，出现在控制台但不写入任务日志文件。
    与 tlog() 是两个独立通道，不构成双写。
    """
    logging.getLogger().info(message, *args)


def phase_header(phase: str, detail: str = "") -> None:
    """记录阶段开始分隔线（写入任务日志文件）

    ═══ 用于任务级边界（TASK START/END）
    ─── 用于节点级边界（NODE START/END）
    """
    _tlog = tlog()
    if phase in (PHASE_TASK, PHASE_MATCH):
        _tlog.info(_THICK)
        _tlog.info("  %s  %s", phase, detail)
        _tlog.info(_THICK)
    else:
        _tlog.info(_THIN)
        _tlog.info("  %s  %s", phase, detail)
        _tlog.info(_THIN)


def phase_footer(phase: str, detail: str = "") -> None:
    """记录阶段结束分隔线"""
    _tlog = tlog()
    if phase in (PHASE_TASK, PHASE_MATCH):
        _tlog.info(_THICK)
        _tlog.info("  %s END  %s", phase, detail)
        _tlog.info(_THICK)
    else:
        _tlog.info(_THIN)
        _tlog.info("  %s END  %s", phase, detail)
        _tlog.info(_THIN)


# ── Per-Task 文件 Handler ──

_per_task_handler: "PerTaskFileHandler | None" = None


class PerTaskFileHandler(logging.Handler):
    """按任务 ID 路由日志到独立文件

    从 ContextVar 获取当前 task_id，将日志写入 logs/tasks/{task_id}.log。
    无 task_id 上下文时跳过（由 task_execution.log 兜底）。
    """

    def __init__(self, tasks_dir: Path, **kwargs):
        super().__init__(**kwargs)
        self._tasks_dir = tasks_dir
        self._tasks_dir.mkdir(exist_ok=True)
        self._handlers: dict[str, logging.FileHandler] = {}
        self._lock = threading.Lock()
        self._fmt: logging.Formatter | None = None

    def emit(self, record: logging.LogRecord) -> None:
        task_id = get_current_task_id()
        if not task_id:
            return
        handler = self._get_handler(task_id)
        if handler:
            try:
                record.getMessage()
                handler.emit(record)
            except Exception:
                self.handleError(record)

    def _get_handler(self, task_id: str) -> logging.FileHandler | None:
        with self._lock:
            if task_id not in self._handlers:
                try:
                    path = self._tasks_dir / f"{task_id}.log"
                    h = logging.FileHandler(path, encoding="utf-8")
                    h.setFormatter(self._fmt or logging.Formatter())
                    self._handlers[task_id] = h
                except Exception:
                    return None
            return self._handlers[task_id]

    def close_task_file(self, task_id: str) -> None:
        with self._lock:
            handler = self._handlers.pop(task_id, None)
            if handler:
                try:
                    handler.close()
                except Exception:
                    pass

    def get_task_log_path(self, task_id: str) -> Path | None:
        return self._tasks_dir / f"{task_id}.log"

    def setFormatter(self, fmt: logging.Formatter) -> None:
        self._fmt = fmt
        super().setFormatter(fmt)
        with self._lock:
            for h in self._handlers.values():
                h.setFormatter(fmt)

    def close(self) -> None:
        with self._lock:
            for handler in self._handlers.values():
                try:
                    handler.close()
                except Exception:
                    pass
            self._handlers.clear()
        super().close()


def _get_per_task_handler() -> PerTaskFileHandler | None:
    return _per_task_handler


# ── 日志初始化 ──

def _close_handlers(logger: logging.Logger) -> None:
    """安全关闭 logger 上的所有 handler（释放文件句柄）"""
    for handler in logger.handlers[:]:
        try:
            handler.close()
        except Exception:
            pass
    logger.handlers.clear()


def setup_logging(log_level: str = "INFO", log_dir: str = "logs") -> None:
    """配置应用日志

    Args:
        log_level: 应用日志级别，如 "INFO", "DEBUG", "WARNING"
        log_dir: 日志文件目录，相对于 server 工作目录
    """
    global _per_task_handler

    level = getattr(logging, log_level.upper(), logging.INFO)

    log_path = Path(log_dir)
    log_path.mkdir(exist_ok=True)

    # ── 关闭旧 handler ──
    root = logging.getLogger()
    _close_handlers(root)
    for name in _NOISY_LOGGERS:
        _close_handlers(logging.getLogger(name))
    _close_handlers(logging.getLogger("task_execution"))

    root.setLevel(level)

    # 1. 控制台 — 精简格式（只显示时间+级别+消息，不显示 logger name）
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%H:%M:%S",
    ))
    root.addHandler(console)

    # 2. app.log — 完整格式
    file_handler = RotatingFileHandler(
        log_path / "app.log", encoding="utf-8",
        maxBytes=10 * 1024 * 1024, backupCount=5,
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    root.addHandler(file_handler)

    # 3. 第三方库降噪
    for name in _NOISY_LOGGERS:
        noisy_logger = logging.getLogger(name)
        noisy_logger.setLevel(logging.WARNING)
        noisy_logger.propagate = True

    # 4. 任务执行日志
    _setup_task_execution_log(log_path)

    logging.getLogger(__name__).info("[Logging] 日志系统初始化完成: level=%s, dir=%s", log_level, log_dir)


def _setup_task_execution_log(log_path: Path) -> None:
    """配置任务执行调试日志

    两个输出目标：
    1. task_execution.log — 全局汇总
    2. tasks/{task_id}.log — 按任务拆分

    不冒泡到 root logger，不会淹没控制台。
    关键事件通过 task_summary() 输出一行摘要。
    """
    global _per_task_handler

    task_logger = logging.getLogger("task_execution")
    task_logger.setLevel(logging.DEBUG)
    task_logger.propagate = False  # 不冒泡到 root，避免控制台被淹没

    task_formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 1. 全局汇总
    task_file = RotatingFileHandler(
        log_path / "task_execution.log", encoding="utf-8",
        maxBytes=10 * 1024 * 1024, backupCount=5,
    )
    task_file.setLevel(logging.DEBUG)
    task_file.setFormatter(task_formatter)
    task_logger.addHandler(task_file)

    # 2. 按任务拆分
    per_task = PerTaskFileHandler(log_path / "tasks")
    per_task.setLevel(logging.DEBUG)
    per_task.setFormatter(task_formatter)
    task_logger.addHandler(per_task)
    _per_task_handler = per_task
