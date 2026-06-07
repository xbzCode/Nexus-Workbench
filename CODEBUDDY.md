# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## 常用命令

### 基础设施（需要 Docker）
```bash
docker compose up -d              # 启动 PostgreSQL 16 + Redis 7
docker compose down               # 停止
```

### 后端（packages/server/）
```bash
# 环境准备
python -m venv venv
# Windows: .\venv\Scripts\activate  |  Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # 编辑 .env 填入 LLM_API_KEY 等配置

# 数据库迁移
alembic upgrade head               # 执行迁移
alembic revision --autogenerate -m "描述"  # 生成新迁移

# 启动开发服务器
uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000

# 测试
pytest                             # 运行全部测试
pytest tests/core/                 # 仅运行核心引擎测试（不需要 DB）
pytest tests/api/                  # API 集成测试（需要 aiosqlite）
pytest tests/core/dag/test_validate.py -k "test_cycle"  # 运行单个测试

# 安装开发依赖
pip install -e ".[dev]"            # pytest, pytest-asyncio, httpx, aiosqlite
```

### 前端（packages/web/）
```bash
pnpm install                       # 安装依赖
pnpm dev                           # 启动开发服务器 (http://localhost:3000)
pnpm build                         # 生产构建
pnpm lint                          # ESLint 检查
pnpm generate-api                  # 从后端 OpenAPI 生成 TypeScript 类型 (需后端运行)
```

### API 类型同步
后端修改 API schema 后，需在前端重新生成类型：`cd packages/web && pnpm generate-api`

## 架构概览

### 项目定位
AgentFlow 是一个 AI Agent 工作台，采用"人辅助 AI"范式——用户自然语言描述需求，系统自动匹配/组装执行方案，AI 自主执行，人仅在关键点审批决策。

### Monorepo 结构
- `packages/server/` — Python 后端（FastAPI + SQLAlchemy 2.0 async）
- `packages/web/` — Next.js 15 前端（React 19 + React Flow 12 + Tailwind 4）
- `extensions/nodes/` — 扩展节点定义（SKILL.md + 工作流模板），启动时同步到 DB
- `doc/` — 设计文档（PRD、架构、开发计划）

### 后端分层架构

严格分层，数据流方向：**API → Service → Core/Model**

```
app/
├── config/        ← Pydantic Settings + async SQLAlchemy engine + 日志
├── models/        ← SQLAlchemy 2.0 ORM（mapped_column），按实体拆文件（含 team.py）
├── schemas/       ← Pydantic V2 请求/响应 schema，与 model 分离（含 team.py）
├── core/          ← 核心引擎（与业务无关，可独立测试）
│   ├── dag/       ← DAG 模型 + 校验 + 序列化（JSONB ↔ DAGDefinition）
│   ├── scheduler/ ← 拓扑排序 + AST安全条件求值 + 数据流传递
│   ├── executor/  ← 执行引擎（Mock/Adapter双模式 + 审批暂停/恢复 + team_prompt 注入）
│   ├── events/    ← asyncio.Queue 事件总线（按 event_type/task_id 订阅，自动清理泄漏队列）
│   └── llm/       ← OpenAI SDK 统一 LLM 客户端（单例，延迟初始化）
├── adapters/      ← Agent 适配层（适配器模式 + 注册表模式）
├── services/      ← 业务逻辑层（每个实体一个 service 文件，含 team_service.py）
└── api/           ← REST 路由层（FastAPI 路由，含 teams.py，DI 通过 deps.py）
```

### 核心引擎运作流程

1. **DAG 校验**（`core/dag/validate.py`）：节点 ID 唯一性、边引用存在性、无自环、无环（DFS 三色标记）
2. **拓扑排序**（`core/scheduler/topo_sort.py`）：Kahn 算法返回分层执行列表，同层节点可并行（当前串行执行）
3. **条件求值**（`core/scheduler/condition.py`）：AST 白名单安全解析，支持 `success/failed/has_key` 内置函数
4. **数据流传递**（`core/scheduler/data_flow.py`）：语义传递（上游 status/summary/result → 下游 previous_*）+ 精确映射（`$prev/$node/{id}/$workflow` 变量）
5. **执行引擎**（`core/executor/engine.py`）：逐层串行执行节点，Mock 模式用 sleep 模拟，Adapter 模式通过 Registry 路由到真实 Agent
6. **审批机制**：引擎检测 QuestionDetectedEvent/ApprovalNeededEvent → LLM 分类提问类型 → 创建 Approval → 轮询 DB 等待用户决策 → resume Adapter 会话

### Adapter 适配器模式

- `AgentHarnessAdapter` 抽象基类定义 5 个核心方法：`start_session`、`send_input`、`on_event`、`respond`、`terminate`
- `AdapterRegistry` 全局注册表，按 `adapter_type` 路由到对应实现
- 当前仅 `codebuddy` adapter（CLI 无头模式 + stream-json 解析 + 多轮对话），通过 `init_adapters()` 在应用启动时注册
- 新增 Adapter：实现基类 → 调用 `register_adapter("type", instance)`

### 事件总线

`EventBus` 基于 `asyncio.Queue` 的发布/订阅，三种订阅方式（按 event_type / 按 task_id / 全局），内置 `_TrackedQueue` 防泄漏机制（5 分钟闲置自动清理）。全局单例通过 `get_event_bus()` 获取。SSE 端点 `GET /api/events/{task_id}` 消费此总线。

### 前端架构

- **App Router** 页面：首页（匹配/描述/Team 选择器）、teams（Team 管理）、workflows（DAG 可视化）、tasks（执行列表+详情）、approvals（审批队列）、nodes（节点管理）
- **API 客户端**（`src/lib/api.ts`）：封装 fetch + AbortController 超时，通过 `NEXT_PUBLIC_API_BASE` 或 Next.js rewrites 代理到后端
- **SSE Hook**（`src/hooks/useSSE.ts`）：监听后端事件流，驱动实时状态更新
- **TypeScript 类型**（`src/lib/types.ts`）：由 `openapi-typescript` 从后端 OpenAPI 自动生成
- **UI 组件**：shadcn/ui 基础 + 按功能域拆目录（chat/approval/task/workflow/layout/debug/shared）
- **拖拽排序**：@dnd-kit/core + @dnd-kit/sortable，用于审批排序等交互
- **Markdown 渲染**：react-markdown + remark-gfm，用于成果物预览
- **结构化数据渲染**：StepOutputRenderer / StructuredDataRenderer / ContextDataRenderer 分别用于步骤输出、输入数据、审批上下文的结构化展示，而非 JSON dump
- **Next.js rewrites**：开发环境将 `/api/*` 代理到 `http://localhost:8000/api/*`

### Team 系统

Team 是 AI 能力团队的抽象——将工作流和节点按领域分组，用户选 Team 下发任务时，匹配仅在 Team 范围内进行；未选时 LLM 自动匹配最合适的 Team。

**数据模型**：
- `Team`（`teams` 表）：name, display_name, description, icon, team_prompt, workflow_ids (JSONB), node_definition_ids (JSONB)
- 工作流和节点通过 JSONB 数组与 Team 做 M2M 关联（不修改 Workflow/NodeDefinition 模型）
- Task 有 `team_id` FK → Team，记录任务归属

**匹配流程（四档降级）**：
```
用户输入 + 可选 team_id
  ├─ 选了 Team → Team 范围内 Workflow 匹配 → 动态组装 → bare-agent（注入 team_prompt）
  └─ 未选 Team → LLM 匹配 Team → 命中则进入 Team scope → 未命中则全局匹配
```

**Team Prompt 注入**：执行引擎在 Adapter 配置中传递 `team_prompt`，CodeBuddy Adapter 将其注入到 Agent prompt 前方，使同一节点在不同 Team 下表现不同。

**种子数据**：应用启动时自动创建 4 个默认 Team：文档工程、研发效能、设计产出、数据分析。

### 数据库

- PostgreSQL 16 + Alembic 迁移，12 张表（user/team/workflow/node/task/approval/execution_path/snapshot 等）
- SQLAlchemy 2.0 `mapped_column` 声明式映射，所有模型继承 `Base`
- 测试使用 SQLite 内存数据库（需 aiosqlite），核心引擎测试不需要 DB
- 当前无认证，使用固定 `TEMP_USER_ID`（`00000000-0000-0000-0000-000000000001`）

### API 路由

所有路由挂载在 `/api` 前缀下，共 10 组：`/match`、`/describe`、`/teams`、`/workflows`、`/nodes`、`/tasks`、`/approvals`、`/snapshots`、`/execution-paths`、`/events`

### 文件成果物 API

- `GET /api/tasks/{task_id}/files` — 获取 workspace 产物文件列表（元数据）
- `GET /api/tasks/{task_id}/files/{file_path:path}` — 获取文件内容（预览/下载）
  - 默认 inline 预览（根据 MIME 类型自动判断）
  - `?download=true` 参数触发浏览器附件下载
  - 路径安全校验：防止路径逃逸出 workspace 目录

### 关键约定

- Python 3.11+，全异步（async/await），`asyncio_mode = "auto"`（pytest-asyncio）
- ORM model 与 Pydantic schema 严格分离
- 单文件不超过 800 行（引擎 `engine.py` 是当前最大的文件）
- 前端修改 API 类型后需重新 `pnpm generate-api`
- 扩展节点定义在 `extensions/nodes/`，应用启动时 `sync_extensions()` 同步到 DB
- **⚠️ 不要在路由装饰器中使用 `response_model=APIResponse[...]`**：Pydantic v2 的泛型 BaseModel 作为 FastAPI response_model 会导致所有接口返回 500。直接返回 `APIResponse(data=...)` 即可（FastAPI jsonable_encoder 自动序列化）
