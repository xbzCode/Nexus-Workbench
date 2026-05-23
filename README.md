# AgentFlow

AI Agent 工作台 — 可视化编排、执行与调试 Agent 工作流

## 快速启动

```bash
# 1. 克隆项目
git clone <repo-url> && cd agentflow

# 2. 创建并激活虚拟环境
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY、LLM_API_BASE、LLM_MODEL 等

# 5. 启动服务
cd server
python -m uvicorn main:app --reload --reload-dir . --port 8000
```

启动后访问：
- 前端页面：http://localhost:8000/
- 健康检查：http://localhost:8000/api/health
- API 文档：http://localhost:8000/docs

## 环境配置

所有敏感/环境相关配置通过 `.env` 文件管理，项目根目录下的 `.env.example` 是配置模板：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM API 密钥 | （必填） |
| `LLM_API_BASE` | LLM API 地址 | （必填） |
| `LLM_MODEL` | 模型名称 | `default` |
| `CODEBUDDY_PATH` | CodeBuddy CLI 路径 | `cbc` |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `8000` |

> `.env` 文件已在 `.gitignore` 中，不会被提交到版本库。

## API 接口

```
# 健康检查
GET  /api/health

# 工作流 CRUD
GET    /api/workflows
POST   /api/workflows          {"name":"...", "description":"..."}
GET    /api/workflows/{id}
PUT    /api/workflows/{id}     {"name":"...", "dag":{...}}
DELETE /api/workflows/{id}

# 节点列表（只读）
GET  /api/nodes
GET  /api/nodes/{id}
```

## 测试命令

```bash
# 健康检查
curl http://localhost:8000/api/health

# 查看节点
curl http://localhost:8000/api/nodes

# 创建工作流
curl -X POST http://localhost:8000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"name":"测试流程","description":"测试用"}'

# 查看工作流列表
curl http://localhost:8000/api/workflows

# 更新工作流 DAG
curl -X PUT http://localhost:8000/api/workflows/{id} \
  -H "Content-Type: application/json" \
  -d '{"dag":{"nodes":[{"id":"n1","definition_id":"code-generation"}],"edges":[]}}'
```

## 项目结构

```
agentflow/
├── server/                     ← Python 后端 (FastAPI)
│   ├── main.py                ← 应用入口 + 静态文件服务
│   ├── config.py              ← 配置加载（.env → 环境变量）
│   ├── core/                  ← DAG 引擎
│   │   ├── dag.py             ← DAG 模型 + 校验 + 环检测
│   │   └── scheduler.py       ← 拓扑排序 + 并行调度
│   ├── adapters/              ← Agent 适配器
│   │   └── codebuddy.py       ← CodeBuddy CLI 适配
│   ├── services/              ← 业务服务
│   │   ├── store.py           ← JSON 文件存储
│   │   ├── task_runner.py     ← 任务执行引擎
│   │   ├── matcher_service.py ← LLM 工作流匹配
│   │   ├── snapshot_service.py← Git 快照
│   │   └── registry.py        ← 节点注册中心
│   ├── models/
│   │   └── schemas.py         ← Pydantic 数据模型
│   └── api/                   ← REST API 端点
├── web/                        ← 前端
│   ├── index.html             ← 主页面（DAG 编辑器 + 任务监控）
│   └── vendor/                ← 第三方依赖（本地缓存）
├── lookWeb/                    ← 前端原型/参考页面
├── doc/                        ← 设计文档
│   ├── mvp.md                 ← MVP 验证方案
│   └── iteration-plan.md      ← 迭代开发计划
├── data/                        ← 运行时数据（.gitignore）
│   ├── store.json             ← 业务数据
│   └── workspaces/            ← 任务工作目录
├── .env                        ← 环境变量（不提交）
├── .env.example                ← 环境变量模板
└── requirements.txt            ← Python 依赖
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + Pydantic + GitPython |
| 前端 | 原生 HTML + React (CDN) + React Flow (CDN) |
| Agent 执行 | CodeBuddy CLI (`cbc`) |
| LLM 调用 | OpenAI 兼容接口（通过 `.env` 配置） |
| 数据存储 | JSON 文件 |
| 实时推送 | SSE |
