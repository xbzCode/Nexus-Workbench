import os
from dotenv import load_dotenv

# 加载 .env 文件（优先从项目根目录查找）
_load_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_load_dir, ".env"))

# === LLM 配置 ===
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_BASE = os.getenv("LLM_API_BASE", "")
LLM_MODEL = os.getenv("LLM_MODEL", "default")

# === 路径配置 ===
BASE_DIR = _load_dir
DATA_DIR = os.path.join(BASE_DIR, "data")
WEB_DIR = os.path.join(BASE_DIR, "web")
EXTENSION_DIR = os.path.join(BASE_DIR, "extention")
WORKSPACE_DIR = os.path.join(DATA_DIR, "workspaces")
STORE_FILE = os.path.join(DATA_DIR, "store.json")

# === CodeBuddy 配置 ===
CODEBUDDY_PATH = os.getenv("CODEBUDDY_PATH", "cbc")

# === 服务配置 ===
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
