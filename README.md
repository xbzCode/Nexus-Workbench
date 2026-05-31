# AgentFlow

AI Agent 工作台 — 可视化编排、执行与调试 Agent 工作流

## 快速启动

```bash
# 1. 启动基础设施（需要 Docker）
docker compose up -d

# 2. 后端
cd packages/server
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # 编辑 .env 填入配置

# 数据库迁移
alembic upgrade head

# 启动后端
uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000

# 3. 前端
cd packages/web
pnpm install
pnpm dev
```

启动后访问：
- 前端页面：http://localhost:3000/
- 健康检查：http://localhost:8000/api/health
- API 文档：http://localhost:8000/api/docs

## 环境配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql+asyncpg://agentflow:agentflow123@localhost:5432/agentflow` |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6379/0` |
| `LLM_API_KEY` | LLM API 密钥 | `None` |
| `LLM_BASE_URL` | LLM API 地址 | `https://api.openai.com/v1/` |
| `LLM_MODEL` | 模型名称 | `default` |
| `CODEBUDDY_PATH` | CodeBuddy CLI 路径 | `codebuddy` |
| `WORKSPACE_DIR` | 工作目录 | `./workspace` |
| `DEBUG` | 调试模式 | `false` |

## 项目结构

```
Nexus-Workbench/
├── packages/
│   ├── server/                     ← Python 后端 (FastAPI + SQLAlchemy 2.0)
│   │   ├── app/
│   │   │   ├── main.py            ← FastAPI 入口 + 健康检查
│   │   │   ├── config/            ← Pydantic Settings + DB engine
│   │   │   ├── models/            ← SQLAlchemy ORM 模型（按实体拆文件）
│   │   │   ├── schemas/           ← Pydantic V2 请求/响应 schema
│   │   │   ├── core/              ← 引擎核心
│   │   │   │   ├── dag/           ← DAG 模型 + 校验 + 序列化
│   │   │   │   ├── scheduler/     ← 拓扑排序 + 条件求值 + 数据流
│   │   │   │   ├── executor/      ← 执行引擎 + 自验证 + 回滚
│   │   │   │   └── events/        ← 事件总线
│   │   │   ├── adapters/          ← Agent 适配层（CodeBuddy/Claude/OpenAI/HTTP）
│   │   │   ├── services/          ← 业务逻辑（每个实体一个文件）
│   │   │   └── api/               ← REST API 路由
│   │   ├── migrations/            ← Alembic 数据库迁移
│   │   └── tests/                 ← pytest + async fixture
│   │
│   └── web/                        ← Next.js 15 前端
│       └── src/
│           ├── app/                ← App Router 页面
│           ├── components/         ← UI 组件（按功能域拆目录）
│           ├── lib/                ← API 客户端 + 自动生成类型
│           └── hooks/              ← React Hooks
│
├── extensions/                     ← 扩展：节点定义（SKILL.md）+ 工作流模板
├── doc/                            ← 设计文档
├── docker-compose.yml              ← PostgreSQL 16 + Redis 7
└── pnpm-workspace.yaml
```

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 后端 | FastAPI + Pydantic V2 + SQLAlchemy 2.0 | Python 3.11+ |
| 数据库 | PostgreSQL + Alembic | 16+ |
| 缓存 | Redis | 7+ |
| 前端 | Next.js + React + React Flow + Tailwind | 15 / 19 / 12 / 4 |
| Agent 执行 | CodeBuddy CLI (无头模式) | — |
| LLM 调用 | LiteLLM (OpenAI 兼容) | 1.x |
| API 类型 | OpenAPI → openapi-typescript | 自动生成 |

## 设计文档

| 文档 | 说明 |
|------|------|
| `doc/prd.md` | 产品需求文档 |
| `doc/architecture.md` | 架构设计（数据模型 + 核心流程 + API） |
| `doc/development-plan.md` | 开发计划（9 个迭代） |

## 当前状态

**迭代2 已完成**：DAG 引擎核心（校验/拓扑排序/AST条件求值/数据传递/Mock执行/SSE事件）+ 34 单元测试

**PostgreSQL + API 已验证**：11 表迁移通过，10 项端到端集成测试通过

**迭代3 已完成**：Adapter 层（CodeBuddy CLI 无头模式 + 事件驱动双向交互 + 多轮对话 + 审批暂停/恢复 + stream-json 解析 + 问题检测）+ 54 单元测试（含 20 Adapter 测试）

**迭代4 已完成**：前端骨架（AppShell布局 + 侧边栏导航 + 8路由 + React Flow DAG可视化 + API客户端 + SSE Hook + 状态徽标）+ Next.js build 通过

后端开发详情见 [packages/server/README.md](packages/server/README.md)
