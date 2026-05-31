# AgentFlow Server

Python 后端 — FastAPI + SQLAlchemy 2.0 + PostgreSQL

## 前置条件

- Python 3.11+
- PostgreSQL 16+（需提前创建用户和数据库）
- Redis 7+（后续迭代使用）

## 快速开始

```bash
# 1. 创建虚拟环境
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际配置

# 4. 初始化数据库（首次）
# 确保 PostgreSQL 中已创建用户和数据库：
#   CREATE USER agentflow WITH PASSWORD 'agentflow123';
#   CREATE DATABASE agentflow OWNER agentflow;
#   GRANT ALL ON SCHEMA public TO agentflow;
alembic upgrade head

# 5. 启动服务
uvicorn app.main:app --reload --reload-dir app --port 8000
```

启动后：
- API 文档：http://localhost:8000/api/docs
- 健康检查：http://localhost:8000/api/health

## 测试

### 单元测试（无需启动服务）

```bash
pytest tests/core/ -v
```

### 集成测试（需先启动服务）

```bash
# 终端1：启动服务
uvicorn app.main:app --reload --reload-dir app --port 8000

# 终端2：运行集成测试
pytest tests/e2e/ -v
```

### 全量测试

```bash
pytest -v
```

## 数据库迁移

```bash
# 应用所有迁移
alembic upgrade head

# 创建新迁移（修改 model 后）
alembic revision --autogenerate -m "描述"

# 回退一个版本
alembic downgrade -1

# 查看当前版本
alembic current
```

## Adapter 层

事件驱动双向交互模型，通过 `adapter_type` 路由到具体实现：

| Adapter | 说明 |
|---------|------|
| `codebuddy` | CodeBuddy CLI 无头模式（`cbc -p "prompt" --output-format stream-json -y`） |

### 执行模式

- **Mock 模式**（默认）：`asyncio.sleep` 模拟执行，用于无 CodeBuddy 环境的测试
- **Adapter 模式**：真实调用 CodeBuddy CLI，支持多轮对话、审批、断点续执行

### 关键机制

- **多轮对话**：通过 `--resume {session_id}` 实现，旧进程终止→新进程启动→event_queue 自动切换
- **审批**：`ApprovalNeededEvent`（高风险操作）/ `QuestionDetectedEvent`（Agent 提问）→ 创建 DB 审批记录 → 轮询等待 → resume
- **Windows 兼容**：使用 `subprocess.Popen` + 线程读取 + `asyncio.Queue`，避免 `asyncio.create_subprocess_exec` 在 uvicorn SelectorEventLoop 下的 NotImplementedError

## API 概览

| 路径前缀 | 功能 | 说明 |
|----------|------|------|
| `/api/workflows` | 工作流 CRUD | DAG 校验（环检测/节点引用校验） |
| `/api/tasks` | 任务管理 | 创建/启动/取消，DAG 拓扑执行 |
| `/api/nodes` | 节点定义 | 注册 Agent/ Skill 节点类型 |
| `/api/approvals` | 审批 | 创建/解析审批请求 |
| `/api/snapshots` | 快照 | Git commit 级快照 |
| `/api/health` | 健康检查 | DB 连接状态 |

## 目录结构

```
app/
  main.py              # FastAPI 入口 + 生命周期
  config/              # Settings + DB engine
  models/              # SQLAlchemy ORM
  schemas/             # Pydantic V2 请求/响应
  core/                # 引擎核心
    dag/               # DAG 模型 + 校验 + 序列化
    scheduler/         # 拓扑排序 + 条件求值 + 数据流
    executor/          # 执行引擎（Mock + Adapter 双模式）
    events/            # 事件总线
  adapters/            # Agent 适配层
    base.py            # AgentHarnessAdapter ABC
    events.py          # 事件类型定义
    codebuddy.py       # CodeBuddy 实现
    registry.py        # Adapter 注册表
  services/            # 业务逻辑
  api/                 # REST 路由
migrations/            # Alembic 迁移
tests/
  core/                # 单元测试（DAG引擎 + Adapter）
  e2e/                 # 集成测试（需启动服务）
```
