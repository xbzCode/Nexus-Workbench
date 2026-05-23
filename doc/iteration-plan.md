# AgentFlow MVP 迭代开发计划

## 核心原则

1. **每个迭代独立可验证**：完不成不进下一个，避免偏差累积
2. **小步快跑**：每次只做1-2个核心文件，不超过300行代码
3. **先跑通再优化**：MVP阶段只验证可行性，不做工程化优化
4. **每次迭代结束必须手动测试**：测试通过才进下一步

---

## 迭代 0：项目骨架

**目标**：FastAPI 能启动，能返回 "hello"，前端 HTML 能打开

### 产出文件

```
agentflow-mvp/
├── server/
│   ├── main.py              ← FastAPI入口 + 静态文件服务 + 健康检查
│   ├── config.py            ← 配置常量（LLM、CodeBuddy路径、工作目录）
│   └── requirements.txt     ← 依赖清单
├── web/
│   └── index.html           ← 空白页面，验证静态文件服务
└── data/                    ← 运行时数据目录（gitignore）
```

### 代码量估算

- `main.py`：~40行
- `config.py`：~20行
- `requirements.txt`：~10行
- `index.html`：~10行

### 测试点

- [ ] `pip install -r requirements.txt` 成功
- [ ] `uvicorn server.main:app --reload` 启动无报错
- [ ] `GET http://localhost:8000/api/health` 返回 `{"status": "ok"}`
- [ ] `GET http://localhost:8000/` 能打开 index.html
- [ ] `config.py` 中 `codebuddy` 路径能被检测到（或给出提示）

---

## 迭代 1：JSON 存储 + 数据模型

**目标**：store.json 能读写，Pydantic 模型定义完整，工作流/节点/任务的 CRUD API 可用

### 产出文件

```
server/
├── models/
│   └── schemas.py           ← 全部Pydantic模型
├── services/
│   └── store.py             ← JSON文件存储（load/save/crud）
├── api/
│   ├── workflows.py         ← 工作流 CRUD
│   └── nodes.py             ← 节点列表（只读）
```

### 关键设计

- `store.py`：启动时读 `data/store.json`，所有修改写回，内存中用 dict 缓存
- `schemas.py`：Workflow / NodeDefinition / Task / TaskStep / Snapshot / Approval 全部定义
- 工作流 CRUD 包含 DAG 定义（nodes + edges）
- 节点列表返回预置的 3 个节点定义（硬编码在代码中，不从文件读）

### 代码量估算

- `schemas.py`：~120行
- `store.py`：~80行
- `workflows.py`：~80行
- `nodes.py`：~30行

### 测试点

- [ ] 启动后 `data/store.json` 自动创建，含空的 `workflows/nodes/tasks/steps/snapshots/approvals`
- [ ] `POST /api/workflows` 创建工作流，返回完整对象
- [ ] `GET /api/workflows` 返回列表
- [ ] `GET /api/workflows/{id}` 返回详情（含 DAG）
- [ ] `PUT /api/workflows/{id}` 更新 DAG（增加节点、边）
- [ ] `DELETE /api/workflows/{id}` 删除
- [ ] `GET /api/nodes` 返回 3 个预置节点
- [ ] 重启后数据不丢失（store.json 持久化）

---

## 迭代 2：前端骨架 + 工作流列表 + 节点列表

**目标**：前端能展示工作流列表、节点列表，能创建工作流

### 产出/修改文件

```
web/
└── index.html               ← 完整前端（单文件，内联JS/CSS）
```

### 前端布局

```
┌──────────────┬─────────────────────────────────────────┐
│   左侧面板    │              主区域                       │
│              │                                         │
│  工作流列表    │          工作流详情/编辑区域               │
│  [+新建]     │          （此迭代只显示JSON文本）          │
│              │                                         │
│  ──────────  │                                         │
│  节点列表     │                                         │
│  · 代码生成   │                                         │
│  · 代码审查   │                                         │
│  · Bug修复   │                                         │
└──────────────┴─────────────────────────────────────────┘
```

### 功能

- 左侧工作流列表：从 API 加载，点击选中
- 新建工作流：弹框输入名称+描述
- 节点列表：只读展示
- 右侧：选中工作流后展示 JSON（此迭代不画 DAG 图）

### 代码量估算

- `index.html`：~300行（含内联CSS+JS）

### 测试点

- [ ] 打开页面，左侧显示空工作流列表
- [ ] 点击"新建"，弹框输入名称描述，创建后列表刷新
- [ ] 点击工作流，右侧显示 JSON
- [ ] 节点列表显示 3 个预置节点
- [ ] 用 API 创建含 DAG 的工作流，点击后 JSON 中能看到 nodes/edges

---

## 迭代 3：DAG 引擎核心

**目标**：DAG 校验、拓扑排序、并行执行能跑通（不含真实 Adapter，用 Mock）

### 产出文件

```
server/
├── core/
│   ├── dag.py               ← DAG模型 + 校验 + 环检测
│   ├── scheduler.py         ← 拓扑排序 + 并行调度 + 条件求值
│   ├── executor.py          ← 节点执行器（此迭代用Mock执行）
│   └── events.py            ← 事件总线（简单的asyncio.Queue）
```

### 关键设计

- `dag.py`：
  - `validate(dag) -> list[str]`：校验节点定义存在、边合法、无环（DFS三色标记）
  - `has_cycle(dag) -> bool`
- `scheduler.py`：
  - `topological_sort(dag) -> list[list[str]]`：Kahn算法，返回执行层级
  - `evaluate_condition(condition, output_data) -> bool`：简单eval
- `executor.py`：
  - `execute_node(node_config) -> dict`：此迭代用 `asyncio.sleep(1)` + 返回 mock 数据
  - `execute_dag(dag, input_data) -> dict`：逐层执行，并行用 `asyncio.gather`
- `events.py`：
  - `EventBus`：`emit(event_type, data)` / `subscribe(callback)` 简单实现

### 代码量估算

- `dag.py`：~80行
- `scheduler.py`：~100行
- `executor.py`：~80行
- `events.py`：~40行

### 测试点

- [ ] 创建含环的 DAG，`validate` 返回错误
- [ ] 创建合法 DAG（A→B,C→D），`topological_sort` 返回 `[[A], [B,C], [D]]`
- [ ] `execute_dag` 按层级顺序执行，并行节点同时开始
- [ ] 条件边 `output.status == 'success'` 为 True 时目标节点执行，为 False 时跳过
- [ ] 所有节点的 output 正确传递到下游节点的 input（通过 data_mapping）

---

## 迭代 4：CodeBuddy Adapter 基础

**目标**：能启动 CodeBuddy 进程，能接收 stream-json 输出，能解析事件

### 产出文件

```
server/
├── adapters/
│   ├── base.py              ← Adapter抽象基类
│   ├── events.py             ← Adapter事件定义
│   └── codebuddy.py         ← CodeBuddy Adapter
```

### 关键设计

- `base.py`：`AgentHarnessAdapter` ABC，定义 `start_session / send_input / on_event / respond / terminate`
- `events.py`：`AdapterEvent` 基类 + `AgentThinkingEvent / ApprovalNeededEvent / ProgressUpdateEvent / ExecutionCompletedEvent`
- `codebuddy.py`：
  - `start_session`：构建 `codebuddy -p "prompt" --output-format stream-json -y` 命令并启动
  - `on_event`：逐行读 stdout，解析 stream-json，转换为 AdapterEvent
  - `_parse_stream_json_line`：解析 init/assistant/result 消息类型
  - 此迭代**不做**高风险拦截和 Approval，只做基础解析

### 代码量估算

- `base.py`：~30行
- `events.py`：~30行
- `codebuddy.py`：~120行

### 测试点

- [ ] `start_session` 能启动 codebuddy 进程（用简单 prompt 如 "请输出hello"）
- [ ] `on_event` 能收到 `AgentThinkingEvent`（Agent开始思考时）
- [ ] `on_event` 能收到 `ExecutionCompletedEvent`（进程退出时）
- [ ] 进程退出码为 0，session_id 正确解析
- [ ] 用复杂 prompt（如 "请创建一个 hello.py 文件"），能收到多条事件
- [ ] 进程运行期间，codebuddy 进程可在任务管理器中看到
- [ ] `terminate` 能正确杀掉进程

**⚠️ 这是最关键的验证点！如果 stream-json 格式解析不了，需要立即调整策略（降级为 --output-format json 只拿最终结果）**

---

## 迭代 5：任务执行 + SSE 推送

**目标**：创建任务 → 匹配工作流 → 启动执行 → SSE 实时推送步骤状态

### 产出/修改文件

```
server/
├── services/
│   ├── task_service.py      ← 任务管理 + 启动执行
│   ├── workflow_service.py  ← 补充：匹配逻辑
│   └── matcher_service.py   ← LLM工作流匹配
├── api/
│   ├── tasks.py             ← 任务API
│   └── match.py             ← 匹配API
├── core/
│   └── executor.py          ← 修改：接入真实Adapter替代Mock
```

### 关键设计

- `task_service.py`：
  - `create_task(user_input)`：调用匹配 → 创建Task + TaskSteps → 启动异步执行
  - `_execute_task(task_id)`：调用 executor.execute_dag，在整个过程中通过 EventBus 发事件
- `matcher_service.py`：
  - `match(user_input)`：LLM意图解析 + 工作流描述拼装 → LLM选最匹配
  - 使用 LLM API（通过 .env 配置）
- SSE 端点：`GET /api/events?task_id={id}`，监听 EventBus 事件推送给前端
- 任务状态流转：`pending → running → completed/failed`

### 代码量估算

- `task_service.py`：~100行
- `matcher_service.py`：~60行
- `tasks.py`：~60行
- `match.py`：~20行
- executor.py 修改：~30行

### 测试点

- [ ] `POST /api/match {"user_input": "帮我写一个登录页面"}` 返回匹配的工作流
- [ ] `POST /api/tasks {"user_input": "...", "workflow_id": "xxx"}` 创建任务
- [ ] 任务自动开始执行，TaskSteps 按 DAG 顺序创建
- [ ] SSE 端点收到 `task:step_started` / `task:step_completed` 事件
- [ ] 单节点工作流能执行完成（CodeBuddy 跑通一个简单任务）
- [ ] 两节点工作流能顺序执行（节点1完成 → 节点2开始）

---

## 迭代 6：前端执行监控 + 工作流匹配

**目标**：前端能创建任务、看实时执行状态、处理匹配结果

### 产出/修改文件

```
web/
└── index.html               ← 大幅更新
```

### 新增前端功能

```
┌──────────────┬─────────────────────────────────────────┐
│   左侧面板    │              主区域                       │
│              │                                         │
│  工作流列表    │   [匹配模式]                             │
│  [+新建]     │   输入: [________________]               │
│              │   [匹配工作流]                             │
│  ──────────  │   → 匹配结果: "需求开发流程" [确认] [取消] │
│  节点列表     │                                         │
│              │   [执行监控]                              │
│  ──────────  │   Step 1: 代码生成  ✅ completed           │
│  任务列表     │   Step 2: 代码审查  🔄 running            │
│  · 任务1 ✅  │                                         │
│  · 任务2 🔄  │   [实时日志]                              │
│  [+新建任务] │   > Agent思考: 我需要先查看...             │
│              │   > 正在执行: npm install                  │
└──────────────┴─────────────────────────────────────────┘
```

- 任务创建：输入描述 → 匹配 → 确认 → 开始执行
- 执行监控：步骤状态 + 实时日志（SSE）
- 任务列表：状态标记

### 代码量估算

- index.html 更新：+200行

### 测试点

- [ ] 输入任务描述，点击匹配，返回正确的工作流
- [ ] 确认匹配后，任务开始执行，步骤状态实时更新
- [ ] SSE 日志能实时显示在页面上
- [ ] 任务完成后状态标记为 ✅
- [ ] 多个任务能同时存在

---

## 迭代 7：Approval 双来源机制

**目标**：Agent 执行中的确认请求能拦截，节点级确认能触发，前端能处理

### 产出/修改文件

```
server/
├── services/
│   └── approval_service.py  ← Approval管理
├── api/
│   └── approvals.py         ← Approval API
├── adapters/
│   └── codebuddy.py         ← 修改：增加高风险工具检测
```

### 关键设计

- `codebuddy.py` 增加：
  - `_is_risky_tool(tool_name, tool_input)`：检测 Bash 中的 rm/del/format 等
  - `on_event` 中 `tool_use` 事件触发时，检测高风险 → emit `ApprovalNeededEvent(source=agent)`
- `executor.py` 修改：
  - 监听 `ApprovalNeededEvent` → 创建 `Approval(source=agent)` → 暂停执行等待
  - 节点完成后检查 `need_approval` → 创建 `Approval(source=workflow)` → 暂停等待
  - 用户处理 Approval 后 → `Adapter.respond()` → 继续执行
- `approval_service.py`：`create / resolve / list`

### 代码量估算

- `approval_service.py`：~60行
- `approvals.py`：~40行
- codebuddy.py 修改：+40行
- executor.py 修改：+50行

### 测试点

- [ ] Agent 执行中触发高风险命令（如 `rm`），前端弹出确认请求
- [ ] 点击"批准"，Agent 继续执行
- [ ] 点击"拒绝"，Agent 终止，步骤标记失败
- [ ] 节点配置 `need_approval: true`，执行完成后暂停等确认
- [ ] Approval 列表展示所有待办，source 字段区分来源
- [ ] `GET /api/approvals` 返回所有 pending 状态的待办

---

## 迭代 8：Git 快照 + 回滚

**目标**：每个步骤执行前后自动创建 Git 快照，能回滚到指定快照

### 产出/修改文件

```
server/
├── services/
│   └── snapshot_service.py  ← Git快照服务
├── api/
│   └── snapshots.py         ← 快照API
```

### 关键设计

- `snapshot_service.py`：
  - `create_snapshot(task_id, step_id, type)`：`git add -A && git commit -m "snapshot"`
  - `rollback(task_id, snapshot_id)`：`git reset --hard {hash}` + 清理新未跟踪文件
  - 任务工作目录初始化时 `git init`
- `executor.py` 修改：节点执行前调 `create_snapshot(type=pre_step)`，完成后调 `create_snapshot(type=post_step)`

### 代码量估算

- `snapshot_service.py`：~80行
- `snapshots.py`：~30行
- executor.py 修改：+10行

### 测试点

- [ ] 创建任务后，工作目录自动 `git init`
- [ ] 步骤1执行前，自动创建 pre_step 快照
- [ ] 步骤1执行后，自动创建 post_step 快照
- [ ] Agent 修改了文件（如创建 hello.py），post_step 快照能看到变更
- [ ] `GET /api/tasks/{id}/snapshots` 返回快照列表
- [ ] `POST /api/tasks/{id}/snapshots/{sid}/rollback` 回滚，文件恢复
- [ ] 回滚后重新执行步骤2，能正常完成

---

## 迭代 9：断点调试

**目标**：能设断点、命中断点、查看数据、继续执行

### 产出/修改文件

```
server/
├── services/
│   └── debug_service.py     ← 断点调试服务
├── api/
│   └── debug.py             ← 调试API
├── core/
│   └── executor.py          ← 修改：断点检测逻辑
```

### 关键设计

- `debug_service.py`：
  - `set_breakpoint(task_id, node_id)`：在 Task.context.breakpoints 中添加
  - `remove_breakpoint(task_id, node_id)`
- `executor.py` 修改：
  - 节点执行前检查是否在断点中 → 是则暂停，emit `breakpoint_hit`
  - 暂停方式：创建 Approval(source=workflow, type=choice)，选项为继续/单步/回滚
  - 用户选择"继续" → 继续执行
  - 用户选择"单步" → 当前节点执行，下一个节点设断点
- 调试信息填充到 TaskStep.debug_info

### 代码量估算

- `debug_service.py`：~60行
- `debug.py`：~30行
- executor.py 修改：+40行

### 测试点

- [ ] `POST /api/tasks/{id}/breakpoints {"node_id": "node_2"}` 设置断点
- [ ] 启动任务，节点1正常执行，节点2命中断点暂停
- [ ] SSE 收到 `task:breakpoint_hit` 事件
- [ ] `GET /api/tasks/{id}` 看到 debug_info
- [ ] `POST /api/tasks/{id}/debug/continue` 继续，任务执行完成
- [ ] 单步执行：当前节点完成，下一节点暂停

---

## 迭代 10：DAG 可视化编辑器

**目标**：前端用 React Flow 画 DAG，能拖拽建节点、连线、保存

### 产出/修改文件

```
web/
└── index.html               ← 大幅更新，引入 React Flow CDN
```

### 关键设计

- React Flow CDN 引入：`https://cdn.jsdelivr.net/npm/reactflow@11/dist/umd/index.js`
- 自定义节点组件：显示节点名称、状态颜色
- 自定义边组件：显示条件表达式
- 拖拽建节点：从左侧节点列表拖入画布
- 连线：从节点输出端口拖到另一个节点输入端口
- 保存：点击保存按钮，调用 `PUT /api/workflows/{id}` 提交 DAG
- 加载：选中工作流时，调用 API 获取 DAG 并渲染

### 代码量估算

- index.html 更新：+300行（React Flow 配置 + 自定义节点 + 交互逻辑）

### 测试点

- [ ] React Flow CDN 正常加载
- [ ] 选中已有 DAG 的工作流，画布正确渲染节点和边
- [ ] 从左侧拖入节点到画布，节点出现
- [ ] 从节点端口拖线到另一个节点，边创建
- [ ] 点击边，能编辑条件表达式
- [ ] 点击保存，DAG 存储到后端，刷新后不丢失
- [ ] 执行任务时，画布上节点颜色随状态变化（pending灰、running蓝、completed绿、failed红）

---

## 迭代 11：端到端验证 + 修复

**目标**：跑通完整流程，修复所有 bug

### 测试场景

1. **完整需求开发流程**：
   - 输入"帮我创建一个用户登录页面"
   - 匹配到"需求开发流程"
   - 确认 → 执行代码生成 → 执行代码审查 → 完成

2. **Bug修复流程**：
   - 输入"登录页面有个白屏bug"
   - 匹配到"Bug修复流程"
   - 确认 → 执行Bug修复 → 执行代码审查 → 完成

3. **断点调试**：
   - 给第二个节点设断点
   - 执行到该节点暂停
   - 查看数据 → 继续执行

4. **回滚**：
   - 执行两步后
   - 回滚到第一步
   - 验证文件恢复
   - 重新执行

5. **Agent确认**：
   - 执行一个会触发高风险命令的节点
   - Agent 请求确认
   - 批准/拒绝

### 测试点

- [ ] 5个核心假设全部验证通过
- [ ] 无 JS 控制台错误
- [ ] 无 Python 异常日志
- [ ] SSE 事件流无断连
- [ ] CodeBuddy 进程无泄漏

---

## 迭代依赖关系

```
迭代0: 项目骨架
  │
  ▼
迭代1: JSON存储 + 数据模型
  │
  ├──────────────────┐
  ▼                  ▼
迭代2: 前端骨架    迭代3: DAG引擎核心
  │                  │
  ▼                  ▼
迭代4: CodeBuddy Adapter基础
  │
  ├──────────────────┐
  ▼                  ▼
迭代5: 任务执行+SSE  迭代6: 前端执行监控
  │                  │
  ▼                  ▼
迭代7: Approval双来源
  │
  ├──────────────────┐
  ▼                  ▼
迭代8: Git快照+回滚  迭代9: 断点调试
  │                  │
  └──────┬───────────┘
         ▼
    迭代10: DAG可视化编辑器
         │
         ▼
    迭代11: 端到端验证
```

**可以并行的迭代**：
- 迭代2 和 迭代3（前后端分离，无依赖）
- 迭代8 和 迭代9（快照和调试互相独立）

---

## 风险关卡

| 迭代 | 风险 | 如果失败 |
|------|------|---------|
| 迭代4 | stream-json 格式与预期不一致 | 降级为 `--output-format json`，只拿最终结果，不做实时推送 |
| 迭代4 | `-y` 模式下无法拦截高风险操作 | 改用 `--allowedTools` 白名单限制，不做 Agent 级 Approval |
| 迭代5 | LLM API 不支持 `response_format` | 正则解析 LLM 文本输出中的 JSON |
| 迭代10 | React Flow CDN 加载失败 | 本地安装 npm 包，或改用简化版 SVG 画布 |

**每个迭代的测试点通过后才进下一个迭代，失败则立即调整方案。**
