"""应用日志配置 — 控制台 + 文件双输出

初始化方式：在 main.py lifespan 中调用 setup_logging()
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(log_level: str = "INFO", log_dir: str = "logs") -> None:
    """配置应用日志

    Args:
        log_level: 日志级别，如 "INFO", "DEBUG", "WARNING"
        log_dir: 日志文件目录，相对于 server 工作目录
    """
    level = getattr(logging, log_level.upper(), logging.INFO)

    # 确保日志目录存在
    log_path = Path(log_dir)
    log_path.mkdir(exist_ok=True)

    # 根 logger 配置
    root = logging.getLogger()
    root.setLevel(level)

    # 清除已有 handler（避免重复）
    root.handlers.clear()

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 1. 控制台 handler
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(formatter)
    root.addHandler(console)

    # 2. 文件 handler — app.log（轮转：10MB × 5 个备份）
    file_handler = RotatingFileHandler(
        log_path / "app.log",
        encoding="utf-8",
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    # 3. 抑制第三方库的噪音日志
    for noisy in ("sqlalchemy.engine", "httpx", "httpcore", "openai._base_client"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger(__name__).info("[Logging] 日志系统初始化完成: level=%s, dir=%s", log_level, log_dir)
