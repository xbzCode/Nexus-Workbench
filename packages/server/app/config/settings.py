"""Pydantic Settings — 从环境变量/.env 加载配置"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://agentflow:agentflow123@localhost:5432/agentflow"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # LLM
    LLM_API_KEY: str = "your-api-key"
    LLM_BASE_URL: str = "https://api.openai.com/v1/"
    LLM_MODEL: str = "gpt-4o"
    LLM_TEMPERATURE: float = 1.0
    LLM_TOP_P: float = 0.2
    LLM_MAX_TOKENS: int = 6000
    LLM_TIMEOUT: float = 120.0  # LLM 请求超时（秒），部分端点响应较慢需加大

    # Match / Assembly
    ASSEMBLY_CONFIDENCE_THRESHOLD: float = 0.7  # 动态组装置信度阈值（0-1）

    # CodeBuddy
    CODEBUDDY_PATH: str = "codebuddy"
    WORKSPACE_DIR: str = "./workspace"

    # Extensions
    EXTENSIONS_DIR: str = ""  # 扩展目录绝对路径，为空时自动推断

    # App
    DEBUG: bool = False
    APP_NAME: str = "AgentFlow"
    API_PREFIX: str = "/api"
    LOG_LEVEL: str = "INFO"  # 日志级别: DEBUG | INFO | WARNING | ERROR
    LOG_DIR: str = "logs"   # 日志文件目录

    @property
    def is_llm_configured(self) -> bool:
        """LLM 是否已配置（排除占位符值）"""
        key = self.LLM_API_KEY.strip()
        return bool(key) and key not in ("your-api-key", "None", "none", "null", "")


settings = Settings()
