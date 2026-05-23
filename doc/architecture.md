# AgentFlow — AI Agent 工作台架构设计

## 一、产品叙事（三阶段演进）

```
Stage 1: 提效     直接用 Agent Harness（如 Claude Code）执行任务，人全程参与
Stage 2: 沉淀     将最佳实践固化为 Agent/Skill → 组装为工作流 → 可复用执行
Stage 3: 自进化   多次执行积累日志 → 大模型优化流程 → 越用越好用
```

**AgentFlow 工作台的价值 = Stage 2 + Stage 3 的工程化落地**

当用户已有 Stage 1 的能力后，AgentFlow 帮用户：
1. 把经验变成可复用的工作流
2. 把多工作流编排成统一入口
3. 自动匹配任务到工作流
4. 监控、调试、回滚执行过程
5. 从执行数据中学习优化

---

## 二、系统架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            客户端层                                      │
│                                                                         │
│   ┌──────────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│   │  Electron (本地开发)   │  │  Web (云端开发)     │  │  H5 (移动轻量)  │  │
│   │                      │  │                    │  │                │  │
│   │  · 工作流可视化编辑器   │  │  · 工作流可视化编辑器│  │  · 任务下发     │  │
│   │  · 节点配置与创建      │  │  · 节点配置与创建    │  │  · 待办确认     │  │
│   │  · 断点调试控制台      │  │  · 断点调试控制台    │  │  · 执行进度查看  │  │
│   │  · 快照回滚管理       │  │  · 快照回滚管理      │  │                │  │
│   │  · 本地文件系统操作     │  │  · 工作流市场       │  │                │  │
│   │  · 进程级资源监控      │  │                    │  │                │  │
│   └──────────────────────┘  └────────────────────┘  └────────────────┘  │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                     共享前端组件层                                │  │
│   │   React Flow (DAG编辑器) · shadcn/ui · Tailwind · tRPC Client    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP / WebSocket / SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        API 网关层 (FastAPI)                              │
│                                                                         │
│   ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌───────────────┐  │
│   │ REST API   │  │ WebSocket  │  │ SSE 推送    │  │ 认证鉴权       │  │
│   │ (CRUD+控制)│  │ (双向实时)  │  │ (单向流式)  │  │ (JWT + RBAC)  │  │
│   └────────────┘  └────────────┘  └─────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Python 核心引擎层                                   │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                      工作流引擎                                │    │
│   │  ┌────────────┐ ┌──────────────┐ ┌───────────────────────┐   │    │
│   │  │ DAG 模型    │ │ 调度器        │ │ 执行器                 │   │    │
│   │  │ · 图结构定义 │ │ · 拓扑排序    │ │ · 节点生命周期管理      │   │    │
│   │  │ · 依赖校验   │ │ · 并行调度    │ │ · 输入输出数据传递      │   │    │
│   │  │ · 条件边     │ │ · 条件求值    │ │ · 错误恢复与重试       │   │    │
│   │  │ · 环检测     │ │ · 事件驱动    │ │ · 超时控制             │   │    │
│   │  └────────────┘ └──────────────┘ └───────────────────────┘   │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                      核心服务                                   │    │
│   │  ┌────────────┐ ┌──────────────┐ ┌──────────────┐             │    │
│   │  │ 任务服务    │ │ 节点注册中心  │ │ 工作流模板服务 │             │    │
│   │  └────────────┘ └──────────────┘ └──────────────┘             │    │
│   │  ┌────────────┐ ┌──────────────┐ ┌──────────────┐             │    │
│   │  │ 快照服务    │ │ 调试服务     │ │ 通知服务      │             │    │
│   │  └────────────┘ └──────────────┘ └──────────────┘             │    │
│   │  ┌────────────┐ ┌──────────────┐                               │    │
│   │  │ Hook 引擎   │ │ 市场服务     │                               │    │
│   │  └────────────┘ └──────────────┘                               │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                    智能匹配服务                                │    │
│   │  ┌────────────────────────┐  ┌──────────────────────────┐  │    │
│   │  │ LLM 驱动匹配            │  │ 降级策略                  │  │    │
│   │  │ · 意图解析 (LiteLLM)    │  │ · 无匹配→裸Agent执行     │  │    │
│   │  │ · 工作流描述拼装         │  │ · 建议用户沉淀为新工作流  │  │    │
│   │  │ · Agent判断最匹配项      │  │ · 记录执行路径供后续学习  │  │    │
│   │  └────────────────────────┘  └──────────────────────────┘  │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                  自进化引擎（扩展模块，非主干）                   │    │
│   │  · 执行日志分析 → 流程拓扑优化建议                              │    │
│   │  · 参数调优 → 超时/重试/阈值自动调整                            │    │
│   │  · 提示词优化 → Agent产出质量分析 + 建议改写                    │    │
│   │  · 新模板发现 → 相似执行路径聚类 → 归纳生成新工作流               │    │
│   │  · 节点推荐 → 协同过滤 "相似场景用户还加了X节点"                  │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Agent Harness 适配层                                   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  Adapter 抽象基类（事件驱动双向交互模型）                         │  │
│   │  start_session / send_input / on_event / respond / terminate    │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   ┌──────────────┐ ┌───────────────┐ ┌───────────────┐ ┌────────────┐ │
│   │ CodeBuddy    │ │ Claude Code   │ │ OpenAI Agent  │ │ HTTP API   │ │
│   │ Adapter      │ │ Adapter       │ │ Adapter       │ │ Adapter    │ │
│   │              │ │               │ │               │ │            │ │
│   │ · 进程管理    │ │ · 进程管理     │ │ · API调用     │ │ · REST/gRPC│ │
│   │ · Hook注入   │ │ · 会话管理     │ │ · 流式响应     │ │ · Webhook  │ │
│   │ · Agent/Skill│ │ · 指令注入     │ │ · Function    │ │ · 回调     │ │
│   │   加载       │ │               │ │   Calling     │ │            │ │
│   │ · 事件流解析  │ │ · 事件流解析   │ │ · 事件流解析   │ │ · 事件转换  │ │
│   └──────────────┘ └───────────────┘ └───────────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          存储层                                          │
│                                                                         │
│   ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────────┐│
│   │ PostgreSQL   │  │ Git 仓库      │  │ 对象存储 (MinIO/S3)           ││
│   │              │  │              │  │                               ││
│   │ · 用户/权限   │  │ · 代码快照    │  │ · Agent执行产物               ││
│   │ · 工作流定义   │  │ · 回滚点      │  │ · 日志归档                    ││
│   │ · 任务状态     │  │ · Diff记录   │  │ · 上传文件                    ││
│   │ · 节点注册    │  │              │  │                               ││
│   │ · 执行日志    │  │              │  │                               ││
│   │ · 市场数据     │  │              │  │                               ││
│   └──────────────┘  └──────────────┘  └───────────────────────────────┘│
│                                                                         │
│   ┌──────────────┐                                                      │
│   │ Redis        │                                                      │
│   │              │                                                      │
│   │ · 会话缓存   │                                                      │
│   │ · 实时状态   │                                                      │
│   │ · 消息队列   │                                                      │
│   └──────────────┘                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心数据模型

### 3.1 实体关系

```
User ──1:N──→ Workflow (我的工作流)
     ──1:N──→ Task (我的任务)
     ──1:N──→ Approval (我的待办)

Workflow ──1:N──→ WorkflowVersion (版本历史)
         ──M:N──→ Node (DAG中的节点实例 + 边)
         ──1:1──→ WorkflowPublish (发布到市场)

Node ──M:1──→ NodeDefinition (注册中心中的节点定义)
     ──1:N──→ NodeConfig (节点配置实例)
     ──1:N──→ Hook (节点级Hook)

Task ──M:1──→ Workflow (基于哪个工作流)
     ──1:N──→ TaskStep (执行步骤记录)
     ──1:N──→ Snapshot (Git快照)
     ──1:N──→ Approval (需要确认的步骤)
     ──1:1──→ ExecutionContext (运行时上下文)

NodeDefinition ──1:N──→ NodeFile (agent/skill/plugin/配置文件)
                 ──1:N──→ ConfigSchema (配置项定义)

TaskStep ──M:1──→ Node (对应哪个节点)
         ──1:1──→ StepInput  (输入数据)
         ──1:1──→ StepOutput (输出数据)
         ──1:N──→ StepLog   (执行日志)
```

### 3.2 关键模型定义

#### Workflow（工作流）

```
Workflow
├── id: UUID
├── user_id: UUID                    ← 所属用户
├── name: str                        ← 工作流名称
├── description: str                  ← 语义描述（用于LLM匹配时拼入Prompt）
├── category: str                    ← 分类：需求开发/Bug修复/重构/测试/自定义
├── dag: DAGDefinition               ← DAG定义（节点 + 边）
│   ├── nodes: list[NodeInstance]    ← 节点实例列表
│   │   ├── id: str
│   │   ├── definition_id: str       ← 引用的节点定义
│   │   ├── position: {x, y}        ← 可视化位置
│   │   ├── config: dict             ← 节点配置（覆盖默认值）
│   │   └── hooks: list[Hook]       ← 节点级Hook
│   │       ├── type: pre | post | on_error
│   │       ├── script: str          ← Hook脚本路径或内联代码
│   │       └── config: dict
│   └── edges: list[Edge]            ← 边列表
│       ├── source_id: str
│       ├── target_id: str
│       ├── condition: str | null     ← 条件表达式（null=无条件）
│       └── data_mapping: dict | null← 输出→输入映射
├── input_schema: JSONSchema         ← 工作流输入定义
├── output_schema: JSONSchema        ← 工作流输出定义
├── version: int                     ← 版本号
├── status: draft | published | archived
├── created_at / updated_at
```

#### Task（任务）

```
Task
├── id: UUID
├── user_id: UUID
├── title: str                       ← 用户输入的原始任务描述
├── intent: str                      ← LLM解析后的结构化意图
├── matched_workflow_id: UUID | null ← 匹配到的工作流（null=裸Agent模式）
├── status: pending | running | paused | completed | failed | cancelled
├── execution_mode: workflow | bare_agent  ← 执行模式
├── context: ExecutionContext        ← 运行上下文
│   ├── current_step_id: str | null
│   ├── step_states: dict[str, StepState]  ← 每个节点的状态
│   ├── variables: dict              ← 工作流级变量
│   ├── breakpoints: set[str]       ← 断点集合（节点ID）
│   └── adapter_session_id: str     ← 当前Adapter会话ID
├── input_data: dict                 ← 用户提供的输入
├── output_data: dict | null         ← 最终产出
├── created_at / started_at / completed_at
```

#### TaskStep（步骤执行记录）

```
TaskStep
├── id: UUID
├── task_id: UUID
├── node_id: str                     ← 对应的节点实例ID
├── status: pending | running | waiting_approval | completed | failed | skipped | rolled_back
├── snapshot_id: UUID | null         ← 执行前的Git快照ID
├── input_data: dict                 ← 该步骤的输入
├── output_data: dict | null         ← 该步骤的输出（多轮对话最终结果）
├── error: dict | null               ← 错误信息
├── retry_count: int
├── round_count: int                 ← 经历的Agent对话轮次
├── approval_count: int              ← 经历的确认次数
├── debug_info: dict | null          ← 调试信息（断点暂停时填充）
│   ├── agent_thinking: str          ← Agent的思考过程
│   ├── intermediate_state: dict     ← 中间状态
│   └── prompt_snapshot: str         ← 实际使用的提示词快照
├── started_at / completed_at
```

#### Snapshot（快照）

```
Snapshot
├── id: UUID
├── task_id: UUID
├── step_id: UUID                    ← 关联的步骤
├── type: pre_step | post_step | manual
├── git_commit_hash: str             ← Git commit hash
├── git_diff: str | null             ← 相对上一个快照的diff
├── untracked_files: list[str]       ← 未跟踪文件列表
├── environment: dict                ← 环境变量/配置快照
├── created_at
```

#### NodeDefinition（节点定义 — 注册中心）

```
NodeDefinition
├── id: UUID
├── author_id: UUID                  ← 创建者
├── name: str                        ← 唯一标识名（如 code-generation）
├── display_name: str                 ← 显示名
├── description: str                 ← 功能描述
├── category: str                    ← 分类
├── adapter_type: str                ← 需要的Adapter类型（codebuddy/claude/openai/http）
├── files: list[NodeFile]            ← 节点文件包
│   ├── path: str                    ← 相对路径
│   ├── type: agent | skill | plugin | config | prompt | script
│   └── content: bytes               ← 文件内容
├── config_schema: JSONSchema        ← 节点配置的JSON Schema
├── input_schema: JSONSchema         ← 输入定义
├── output_schema: JSONSchema        ← 输出定义
├── default_config: dict             ← 默认配置
├── version: str                     ← 语义版本
├── status: draft | published | deprecated
├── created_at / updated_at
```

#### Approval（确认/待办 — 双来源统一）

```
Approval
├── id: UUID
├── task_id: UUID
├── step_id: UUID
├── user_id: UUID                    ← 待确认的用户
├── source: agent | workflow          ← 确认来源
│   ├── agent: Agent执行中主动发起的确认（如"是否执行此命令"）
│   └── workflow: 工作流定义中配置的节点级确认（如"代码生成后需人工Review"）
├── type: confirm | choice | input   ← 确认类型
├── title: str                       ← 待办标题
├── description: str                  ← 详细说明
├── options: list[dict] | null       ← 选项列表（choice类型）
├── input_schema: JSONSchema | null  ← 输入Schema（input类型）
├── context_data: dict               ← 上下文数据
│   ├── agent来源时: {command: "rm -rf ...", risk_level: "high"}
│   └── workflow来源时: {node_name: "代码生成", output_summary: "..."}
├── status: pending | approved | rejected | expired
├── result: dict | null              ← 用户的选择/输入
├── expires_at: datetime | null
├── created_at / resolved_at
```

---

## 四、Adapter 事件驱动交互模型

### 4.1 Adapter 抽象接口

```
AgentHarnessAdapter (ABC)

  ┌─────────────────────────────────────────────────────────────────┐
  │  start_session(config: NodeConfig) → str                        │
  │    启动Agent会话，返回session_id                                  │
  │                                                                   │
  │  send_input(session_id: str, input: dict) → None                │
  │    向Agent发送输入，非阻塞                                        │
  │                                                                   │
  │  on_event(session_id: str) → AsyncIterator[AdapterEvent]        │
  │    监听Agent事件流，持续迭代直到会话结束                            │
  │                                                                   │
  │  respond(session_id: str, approval_id: str, response: dict)     │
  │    回复Agent的确认请求                                            │
  │                                                                   │
  │  terminate(session_id: str) → None                              │
  │    终止Agent会话                                                  │
  └─────────────────────────────────────────────────────────────────┘

  AdapterEvent 类型:
  ├── AgentThinkingEvent(content: str)        ← Agent思考过程（流式推送前端）
  ├── ApprovalNeededEvent(approval: dict)      ← Agent需要确认（创建Approval→通知前端）
  ├── ProgressUpdateEvent(progress: float)     ← 进度更新
  ├── OutputProducedEvent(path: str, type: str)← 产出文件
  └── ExecutionCompletedEvent(output: dict)    ← 执行完成
```

### 4.2 执行时序

```
Engine                           Adapter                         Agent进程
  │                                │                               │
  ├── start_session(config) ──────→│── 启动Agent进程 ─────────────→│
  │                                │                               │
  │                                │←── stdout/stderr解析 ────────│
  │←─ AgentThinkingEvent ─────────│                               │
  │   (转发前端 via WS)             │                               │
  │                                │                               │
  │                                │←── Agent暂停等确认 ──────────│
  │←─ ApprovalNeededEvent ────────│                               │
  │   (source=agent)               │                               │
  │                                │                               │
  ├── 创建 Approval(source=agent)  │                               │
  ├── 通知前端(弹框/待办)          │                               │
  │                                │                               │
  │   ... 用户处理待办 ...          │                               │
  │                                │                               │
  ├── respond(session, approval, response) ─→│── 写入Agent stdin ──→│
  │                                │                               │
  │                                │←── Agent继续执行 ────────────│
  │←─ AgentThinkingEvent ─────────│                               │
  │                                │                               │
  │                                │←── Agent执行完成退出 ─────────│
  │←─ ExecutionCompletedEvent ────│                               │
  │                                │                               │
  ├── 记录 Step 结果               │                               │
  │                                │                               │
  │   ... 检查节点配置 need_approval ...                            │
  │                                │                               │
  ├── 创建 Approval(source=workflow)                               │
  ├── 通知前端                      │                               │
  │   ... 用户确认 ...              │                               │
  │                                │                               │
  ├── 继续下一个节点                │                               │
```

### 4.3 多轮对话模型

一个节点的执行可能包含多轮Agent对话，Adapter内部处理多轮细节，对Engine透明：

```
节点执行（Engine视角）:
  start_session → send_input → [等待事件流] → ExecutionCompletedEvent → 完成

节点执行（Adapter内部，多轮对话）:
  Round 1: send_input → AgentThinking → ApprovalNeeded → (Engine转发确认) → respond
  Round 2: Agent继续 → AgentThinking → ApprovalNeeded → (Engine转发确认) → respond
  Round 3: Agent继续 → AgentThinking → ExecutionCompleted
  
  Engine 只关心最终结果，round_count 和 approval_count 在 Step 上统计
```

---

## 五、核心流程设计

### 5.1 任务下发与匹配流程

```
用户输入任务描述
       │
       ▼
┌──────────────────┐
│  LLM 意图解析     │ ← LiteLLM，结构化提取意图、关键信息
└──────────────────┘
       │
       ▼
┌──────────────────┐
│  LLM 工作流匹配   │ ← 拼装Prompt: 用户意图 + 所有问题流名称/描述
│  Agent判断选择     │    LiteLLM选择最匹配的工作流
└──────────────────┘
       │
       ├── 匹配到工作流 ──────────────────────────┐
       │                                         ▼
       │                               ┌──────────────────┐
       │                               │ 展示匹配结果       │
       │                               │ · 工作流名称       │
       │                               │ · 工作流简介       │
       │                               │ · DAG预览图        │
       │                               └──────────────────┘
       │                                         │
       │                                         ├── 用户确认 ───→ 创建Task, 开始执行
       │                                         └── 用户拒绝 ───→ 进入裸Agent模式
       │
       └── 未匹配到工作流
                │
                ▼
       ┌──────────────────┐
       │  裸Agent模式      │ ← 直接用默认Adapter执行任务
       │  兜底执行         │
       └──────────────────┘
                │
                ▼
       ┌──────────────────┐
       │  执行完成提示      │ ← "本次执行无工作流，是否将此次路径沉淀为新工作流？"
       │  沉淀建议         │
       └──────────────────┘
                │
                ├── 用户确认沉淀 → 进入工作流创建向导（预填本次执行路径）
                └── 用户跳过
```

### 5.2 DAG 执行流程

```
                    ┌─────────────┐
                    │  创建 Task    │
                    └──────┬──────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ DAG 拓扑排序     │ ← Kahn算法，得到执行层级
                  │ 确定执行顺序     │    层级0: 无依赖节点
                  └────────┬────────┘    层级1: 依赖层级0的节点
                           │             ...
                           ▼
              ┌──────────────────────────┐
              │  取当前层级所有就绪节点     │
              │  (所有上游节点已完成)       │
              └────────────┬─────────────┘
                           │
                    ┌──────┴──────┐
                    │ 有就绪节点？ │
                    └──────┬──────┘
                     No    │    Yes
                     │     │
                     │     ▼
              ┌──────┴──────────────────────────────┐
              │                                      │
              │    ┌───────────────────────────┐     │
              │    │  并行执行就绪节点            │     │
              │    │  asyncio.gather(*tasks)     │     │
              │    └────────────┬──────────────┘     │
              │                 │                     │
              │    ┌────────────┴──────────────┐     │
              │    │  对每个节点执行:             │     │
              │    │                           │     │
              │    │  1. 创建 pre-step 快照     │     │
              │    │  2. 执行 pre-hooks         │     │
              │    │  3. 检查断点               │     │
              │    │     ├── 有断点 → 暂停, 等   │     │
              │    │     └── 无断点 → 继续      │     │
              │    │  4. Adapter.start_session  │     │
              │    │     → Adapter.send_input   │     │
              │    │     → 监听事件流:           │     │
              │    │       ├── AgentThinking → 推送前端           │
              │    │       ├── ApprovalNeeded → 创建Approval(source=agent) │
              │    │       │                    → 暂停等待用户     │
              │    │       │                    → Adapter.respond()│
              │    │       └── ExecutionCompleted → 记录结果     │
              │    │  5. 检查节点配置 need_approval              │
              │    │     ├── 需要 → 创建Approval(source=workflow) │
              │    │     │         → 暂停等待用户                 │
              │    │     └── 不需要 → 继续                       │
              │    │  6. 执行 post-hooks                       │
              │    │  7. 创建 post-step 快照                   │
              │    │  8. 评估条件边                            │
              │    │     → 确定下游哪些节点就绪                   │
              │    └───────────────────────────┘     │
              │                                      │
              └──────────────────────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  标记 Task 完成   │
                  │  记录执行日志     │
                  └─────────────────┘
```

### 5.3 断点调试流程

```
工作流执行中 → 节点命中断点
       │
       ▼
┌──────────────────────────────┐
│  暂停执行                     │
│  · 保存当前节点完整状态        │
│  · 通过 WebSocket 通知前端     │
│  · Task状态 → paused          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  调试面板展示                  │
│  · 节点输入数据 (可编辑)       │
│  · Agent思考过程 (只读)        │
│  · 实际使用的提示词 (可编辑)    │
│  · 节点配置 (可编辑)           │
│  · 已有输出 (如有, 只读)       │
│  · 上一步快照Diff (可查看)     │
└──────────────┬───────────────┘
               │
     ┌─────────┼──────────┬──────────────┐
     ▼         ▼          ▼              ▼
  继续执行   修改后继续   单步执行       回滚到此步骤前
  (原参数)   (新参数)    (下一步再暂停)   (恢复快照)
     │         │          │              │
     ▼         ▼          ▼              ▼
  恢复执行   用新参数     执行当前节点   git reset --hard
  释放断点   重新执行     下一节点      重置步骤状态
                        设为断点       重新执行
```

### 5.4 回滚流程

```
用户选择某步骤 → 点击"回滚"
       │
       ▼
┌──────────────────────────────┐
│  1. 查找 pre-step 快照        │
│     获取 git_commit_hash      │
│                               │
│  2. 查找未跟踪文件列表         │
│     (快照时记录的)             │
│                               │
│  3. 执行回滚                   │
│     · git reset --hard {hash} │
│     · 删除快照后出现的         │
│       未跟踪文件               │
│     · 恢复环境变量             │
│                               │
│  4. 重置工作流状态             │
│     · 当前步骤及之后步骤       │
│       状态 → rolled_back      │
│     · 工作流执行位置           │
│       回退到该步骤之前         │
│                               │
│  5. 用户决定后续操作           │
│     · 从回滚点重新执行         │
│     · 修改后重新执行           │
│     · 取消整个任务             │
└──────────────────────────────┘
```

### 5.5 待办确认流程（双来源统一）

```
确认有两个来源:

来源1: Agent执行中主动发起（source=agent）
  节点执行中 → Adapter事件流 → ApprovalNeededEvent
    │
    ├── Engine创建Approval(source=agent)
    ├── 通知前端(弹框/待办)
    ├── 用户处理
    └── Engine → Adapter.respond() → Agent继续

来源2: 工作流定义触发（source=workflow）
  节点执行完成 → 检查节点配置need_approval
    │
    ├── Engine创建Approval(source=workflow)
    ├── 通知前端(弹框/待办)
    ├── 用户处理
    └── 继续/中止下一个节点

统一处理流程:
  创建 Approval
       │
       ┌───────┴────────┐
       ▼                ▼
  WebSocket推送      写入待办列表
  (在线用户实时弹框)  (H5/Web通知)
       │                │
       └───────┬────────┘
               │
               ▼
  用户处理
  · approve → 继续执行
  · reject  → 中止或走备选路径
  · choice  → 根据选择走分支
  · input   → 用户提供数据继续
  · expire  → 超时自动处理(可配置策略)
```

### 5.6 沉淀新工作流流程

```
裸Agent模式执行完成 / 用户手动触发
       │
       ▼
┌──────────────────────────────┐
│  工作流创建向导                │
│                               │
│  Step 1: 确认工作流名称和描述   │
│          (LLM根据执行日志建议)  │
│                               │
│  Step 2: 划分节点              │
│          · 从执行路径中提取     │
│          · LLM建议节点切分点    │
│          · 用户调整节点边界     │
│                               │
│  Step 3: 配置节点              │
│          · 每个节点的Agent/     │
│            Skill/Plugin选择    │
│          · 输入输出映射        │
│          · 配置参数            │
│                               │
│  Step 4: 连接DAG               │
│          · 自动生成边          │
│          · 用户调整条件        │
│          · 可视化确认           │
│                               │
│  Step 5: 测试执行             │
│          · 干跑验证            │
│          · 单节点调试          │
│                               │
│  Step 6: 保存为工作流模板      │
└──────────────────────────────┘
```

---

## 六、DAG 引擎设计

### 6.1 核心算法

```
┌─────────────────────────────────────────────────────────────┐
│                      DAG 执行引擎                             │
│                                                              │
│   输入: DAGDefinition + InputData                            │
│   输出: OutputData + ExecutionLog                            │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  1. 校验阶段                                         │   │
│   │     · 检测环路 (DFS三色标记法)                        │   │
│   │     · 校验所有节点定义存在                             │   │
│   │     · 校验输入数据符合 input_schema                   │   │
│   │     · 校验边的 data_mapping 类型兼容                   │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  2. 拓扑排序 (Kahn算法)                              │   │
│   │     · 计算每个节点的入度                              │   │
│   │     · 入度为0的节点入队                              │   │
│   │     · 逐层出队, 降低后继入度                          │   │
│   │     · 产出执行层级列表 [[node_a, node_b], [node_c]]  │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  3. 逐层执行                                         │   │
│   │     for level in topological_levels:                  │   │
│   │       ready_nodes = filter(所有上游已完成)            │   │
│   │       parallel_execute(ready_nodes)  ← asyncio       │   │
│   │       wait_all_complete()                             │   │
│   │       evaluate_condition_edges() → 更新就绪状态       │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  4. 单节点执行（事件驱动）                             │   │
│   │     pre_snapshot → pre_hooks → check_breakpoint       │   │
│   │     → adapter.start_session → send_input              │   │
│   │     → 监听事件流:                                      │   │
│   │       ├── AgentThinking → 推送前端                     │   │
│   │       ├── ApprovalNeeded → 创建Approval(source=agent) │   │
│   │       │                 → 等待用户 → adapter.respond    │   │
│   │       └── ExecutionCompleted → 记录结果               │   │
│   │     → check_workflow_approval                          │   │
│   │     → post_hooks → post_snapshot                       │   │
│   │     → evaluate_output_edges                            │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  5. 异常处理                                         │   │
│   │     · 节点失败 → 执行 on_error hooks                  │   │
│   │     · 可重试 → 指数退避重试                           │   │
│   │     · 不可重试 → 标记失败, 终止下游                    │   │
│   │     · 部分失败 → 其他并行分支继续                      │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 条件边求值

```
边定义:
  source: node_a
  target: node_b
  condition: "output.status == 'success'"   ← Python表达式
  data_mapping: {"node_b.input.code": "node_a.output.source_code"}

求值逻辑:
  1. 获取 source 节点的 output_data
  2. 在沙箱中 eval(condition, {"output": output_data})
  3. 为 True → target 节点就绪
  4. 为 False → target 节点不执行（所有入边都为False时标记skipped）

应用场景:
  · 编译成功 → 走测试节点
  · 编译失败 → 走修复节点
  · 代码变更 → 走全量测试
  · 仅文档变更 → 跳过编译
```

### 6.3 数据流传递

```
节点间数据传递:

  Node A (output) ──── Edge ────→ Node B (input)
                                    │
                                    ▼
  data_mapping 定义映射关系:
  {
    "B.input.source_code": "A.output.code",     ← 直接映射
    "B.input.test_config": "A.output.config",   ← 跨节点映射
    "B.input.env":         "$workflow.env"       ← 工作流级变量
  }

  特殊变量:
  · $workflow.input   ← 工作流初始输入
  · $workflow.env     ← 工作流环境变量
  · $prev.output      ← 上一个完成的节点输出
  · $node.{id}.output ← 任意指定节点输出
```

---

## 七、API 设计

### 7.1 REST API

```
认证
  POST   /api/auth/register
  POST   /api/auth/login
  POST   /api/auth/refresh

节点注册中心
  GET    /api/nodes                     ← 列表（支持分类筛选）
  GET    /api/nodes/{id}                ← 详情
  POST   /api/nodes                     ← 创建自定义节点
  PUT    /api/nodes/{id}                ← 更新
  DELETE /api/nodes/{id}                ← 删除

工作流模板
  GET    /api/workflows                  ← 我的工作流列表
  GET    /api/workflows/{id}             ← 详情（含DAG定义）
  POST   /api/workflows                  ← 创建
  PUT    /api/workflows/{id}             ← 更新
  DELETE /api/workflows/{id}             ← 删除
  POST   /api/workflows/{id}/duplicate   ← 复制
  GET    /api/workflows/{id}/versions    ← 版本历史

任务
  POST   /api/tasks                      ← 创建任务（触发匹配+执行）
  GET    /api/tasks                      ← 我的任务列表
  GET    /api/tasks/{id}                 ← 任务详情
  POST   /api/tasks/{id}/start           ← 启动
  POST   /api/tasks/{id}/pause           ← 暂停
  POST   /api/tasks/{id}/resume          ← 恢复
  POST   /api/tasks/{id}/cancel          ← 取消
  GET    /api/tasks/{id}/steps           ← 步骤列表
  GET    /api/tasks/{id}/steps/{stepId}  ← 步骤详情

调试
  POST   /api/tasks/{id}/breakpoints     ← 设置断点
  DELETE /api/tasks/{id}/breakpoints/{nodeId}  ← 移除断点
  POST   /api/tasks/{id}/steps/{stepId}/debug/continue    ← 继续执行
  POST   /api/tasks/{id}/steps/{stepId}/debug/step-over   ← 单步执行
  POST   /api/tasks/{id}/steps/{stepId}/debug/modify     ← 修改参数后继续

快照与回滚
  GET    /api/tasks/{id}/snapshots       ← 快照列表
  GET    /api/tasks/{id}/snapshots/{sid} ← 快照详情（含diff）
  POST   /api/tasks/{id}/snapshots/{sid}/rollback  ← 回滚到快照

待办确认
  GET    /api/approvals                  ← 我的待办列表
  POST   /api/approvals/{id}/resolve     ← 处理待办

市场
  GET    /api/market/workflows           ← 市场工作流列表
  GET    /api/market/workflows/{id}      ← 市场工作流详情
  POST   /api/market/workflows/{id}/install  ← 安装到我的工作流
  POST   /api/workflows/{id}/publish     ← 发布到市场

工作流匹配
  POST   /api/match                      ← 匹配工作流（传任务描述）
```

### 7.2 WebSocket 事件

```
客户端 → 服务端
  subscribe:task:{id}        ← 订阅任务事件
  subscribe:approval          ← 订阅待办通知

服务端 → 客户端
  task:created                ← 任务创建
  task:status_changed         ← 任务状态变更
  task:step_started           ← 步骤开始
  task:step_completed         ← 步骤完成
  task:step_failed            ← 步骤失败
  task:breakpoint_hit         ← 命中断点
  task:approval_required      ← 需要人工确认（含source: agent/workflow）
  task:approval_resolved      ← 确认已处理
  task:log                    ← 实时日志流
  task:agent_thinking         ← Agent思考过程（流式）
```

---

## 八、项目目录结构

```
AgentFlow/
├── packages/
│   ├── engine/                          ← Python 核心引擎
│   │   ├── agentflow/
│   │   │   ├── __init__.py
│   │   │   ├── main.py                  ← FastAPI 入口
│   │   │   ├── config.py                ← 配置管理
│   │   │   │
│   │   │   ├── core/                    ← 核心引擎
│   │   │   │   ├── dag.py               ← DAG图模型（节点/边/校验/环检测）
│   │   │   │   ├── scheduler.py         ← 调度器（拓扑排序+并行调度+条件求值）
│   │   │   │   ├── executor.py          ← 节点执行器（生命周期+数据流+重试+事件监听）
│   │   │   │   └── events.py            ← 事件总线（内部事件分发）
│   │   │   │
│   │   │   ├── adapters/               ← Agent Harness 适配层
│   │   │   │   ├── base.py              ← Adapter抽象基类（事件驱动双向交互）
│   │   │   │   ├── events.py            ← Adapter事件定义
│   │   │   │   ├── codebuddy.py         ← CodeBuddy适配
│   │   │   │   ├── claude.py            ← Claude Code适配
│   │   │   │   ├── openai.py            ← OpenAI Agent适配
│   │   │   │   └── http.py              ← 通用HTTP API适配
│   │   │   │
│   │   │   ├── services/               ← 业务服务
│   │   │   │   ├── task_service.py      ← 任务管理
│   │   │   │   ├── workflow_service.py  ← 工作流模板管理
│   │   │   │   ├── node_service.py      ← 节点注册中心
│   │   │   │   ├── snapshot_service.py  ← Git快照服务
│   │   │   │   ├── debug_service.py     ← 断点调试服务
│   │   │   │   ├── approval_service.py  ← 确认/待办服务（双来源统一）
│   │   │   │   ├── hook_service.py      ← Hook引擎
│   │   │   │   ├── matcher_service.py   ← LLM工作流匹配服务
│   │   │   │   ├── market_service.py    ← 市场服务
│   │   │   │   └── evolution_service.py ← 自进化引擎（扩展）
│   │   │   │
│   │   │   ├── models/                  ← 数据模型
│   │   │   │   ├── user.py
│   │   │   │   ├── workflow.py
│   │   │   │   ├── node.py
│   │   │   │   ├── task.py
│   │   │   │   ├── snapshot.py
│   │   │   │   └── approval.py
│   │   │   │
│   │   │   ├── api/                     ← API路由
│   │   │   │   ├── deps.py              ← 依赖注入
│   │   │   │   ├── auth.py
│   │   │   │   ├── workflows.py
│   │   │   │   ├── nodes.py
│   │   │   │   ├── tasks.py
│   │   │   │   ├── debug.py
│   │   │   │   ├── snapshots.py
│   │   │   │   ├── approvals.py
│   │   │   │   ├── market.py
│   │   │   │   └── match.py
│   │   │   │
│   │   │   └── ws/                      ← WebSocket
│   │   │       ├── manager.py           ← 连接管理
│   │   │       └── handlers.py          ← 事件处理
│   │   │
│   │   ├── migrations/                  ← Alembic 数据库迁移
│   │   ├── tests/
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   │
│   ├── web/                             ← Next.js Web前端
│   │   ├── src/
│   │   │   ├── app/                     ← App Router页面
│   │   │   │   ├── (auth)/              ← 认证相关
│   │   │   │   ├── dashboard/           ← 仪表盘
│   │   │   │   ├── workflows/           ← 工作流管理
│   │   │   │   │   ├── [id]/edit/       ← 工作流编辑器
│   │   │   │   │   └── new/
│   │   │   │   ├── tasks/              ← 任务管理
│   │   │   │   │   ├── [id]/           ← 任务详情+调试
│   │   │   │   │   └── new/            ← 创建任务
│   │   │   │   ├── nodes/              ← 节点注册中心
│   │   │   │   ├── approvals/           ← 待办列表
│   │   │   │   └── market/             ← 工作流市场
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── workflow/            ← 工作流编辑器组件
│   │   │   │   │   ├── DAGEditor.tsx    ← React Flow DAG画布
│   │   │   │   │   ├── NodePanel.tsx   ← 节点配置面板
│   │   │   │   │   ├── EdgePanel.tsx   ← 边配置面板（条件+映射）
│   │   │   │   │   ├── HookEditor.tsx  ← Hook编辑器
│   │   │   │   │   └── Toolbar.tsx     ← 工具栏（保存/发布/测试）
│   │   │   │   │
│   │   │   │   ├── task/               ← 任务相关组件
│   │   │   │   │   ├── TaskCard.tsx
│   │   │   │   │   ├── StepTimeline.tsx ← 步骤时间线
│   │   │   │   │   ├── LiveLog.tsx     ← 实时日志
│   │   │   │   │   └── StatusBadge.tsx
│   │   │   │   │
│   │   │   │   ├── debug/              ← 调试面板组件
│   │   │   │   │   ├── DebugConsole.tsx
│   │   │   │   │   ├── DataInspector.tsx  ← 输入输出检查器
│   │   │   │   │   ├── PromptViewer.tsx   ← 提示词查看/编辑
│   │   │   │   │   └── SnapshotDiff.tsx   ← 快照Diff查看
│   │   │   │   │
│   │   │   │   ├── approval/           ← 待办确认组件
│   │   │   │   │   ├── ApprovalCard.tsx    ← 统一渲染(agent/workflow来源)
│   │   │   │   │   └── ApprovalDialog.tsx
│   │   │   │   │
│   │   │   │   └── market/            ← 市场组件
│   │   │   │       ├── WorkflowCard.tsx
│   │   │   │       └── InstallDialog.tsx
│   │   │   │
│   │   │   └── lib/                    ← 前端工具库
│   │   │       ├── trpc.ts            ← tRPC客户端
│   │   │       ├── ws.ts              ← WebSocket客户端
│   │   │       └── types.ts           ← 共享类型
│   │   │
│   │   ├── package.json
│   │   ├── next.config.js
│   │   └── tailwind.config.js
│   │
│   ├── h5/                              ← H5移动端
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── tasks/new/          ← 任务下发
│   │   │   │   ├── tasks/[id]/         ← 任务执行进度
│   │   │   │   └── approvals/          ← 待办确认
│   │   │   └── components/             ← 移动端组件（复用web逻辑）
│   │   └── package.json
│   │
│   └── electron/                         ← Electron桌面端
│       ├── src/
│       │   ├── main/                    ← Electron主进程
│       │   │   ├── index.ts
│       │   │   ├── ipc/                ← IPC Handler
│       │   │   └── local/             ← 本地资源管理
│       │   ├── preload/
│       │   └── renderer/               ← 复用 web 包
│       ├── electron-builder.yml
│       └── package.json
│
├── extensions/                           ← 扩展：节点定义 + 工作流模板
│   ├── nodes/                           ← 预置节点
│   │   ├── code-generation/
│   │   │   ├── node.yaml               ← 节点定义
│   │   │   ├── config-schema.json      ← 配置Schema
│   │   │   ├── agents/                 ← Agent文件
│   │   │   ├── skills/                 ← Skill文件
│   │   │   └── prompts/               ← 提示词模板
│   │   ├── frontend-compile/
│   │   ├── backend-start/
│   │   ├── auto-test/
│   │   ├── bug-analyze/
│   │   └── code-review/
│   │
│   └── templates/                       ← 预置工作流模板
│       ├── feature-dev.yaml             ← 需求开发工作流
│       ├── bug-fix.yaml                 ← Bug修复工作流
│       ├── refactor.yaml                ← 重构工作流
│       └── code-review.yaml             ← 代码审查工作流
│
├── docker-compose.yml                   ← PostgreSQL + Redis + MinIO + Engine
├── pnpm-workspace.yaml
└── README.md
```

---

## 九、技术栈汇总

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| **Python引擎** | FastAPI | 0.115+ | 异步高性能API框架 |
| | Pydantic V2 | 2.x | 数据校验与序列化 |
| | SQLAlchemy 2.0 | 2.x | 异步ORM |
| | Alembic | 1.x | 数据库迁移 |
| | asyncio | 内置 | 并行调度核心 |
| | GitPython | 3.x | Git操作 |
| | LiteLLM | 1.x | 引擎内部LLM调用（意图解析/工作流匹配/自进化分析） |
| **数据存储** | PostgreSQL | 16+ | 主数据库 |
| | Redis | 7+ | 缓存+会话+消息队列 |
| | MinIO | 最新 | 对象存储 |
| **前端** | Next.js | 15 | App Router |
| | React | 19 | UI框架 |
| | React Flow | 12 | DAG可视化编辑器 |
| | shadcn/ui | 最新 | 组件库 |
| | Tailwind CSS | 4 | 样式 |
| | tRPC | 11 | 端到端类型安全 |
| **Electron** | Electron | 33+ | 桌面端 |
| | Vite | 6 | 构建工具 |
| **实时通信** | WebSocket | FastAPI原生 | 双向实时 |
| | SSE | FastAPI原生 | 单向流式 |

---

## 十、技术难点与面试价值

| 难点 | 深度 | 面试怎么讲 |
|------|------|-----------|
| **DAG拓扑排序+并行调度** | ⭐⭐⭐⭐ | Kahn算法分层 + asyncio.gather并行执行，条件边的动态求值，这是真正的编排引擎不是for循环 |
| **事件驱动的Agent交互模型** | ⭐⭐⭐⭐⭐ | Adapter不再是同步调用而是事件流，Agent执行中的确认请求通过事件向上传递→Approval→用户→回传，实现了Agent进程与引擎的解耦 |
| **双来源确认统一** | ⭐⭐⭐⭐ | Agent内部确认和节点级确认统一为Approval模型，source字段区分来源，前端同一套UI处理，后端同一套通知流程 |
| **断点调试** | ⭐⭐⭐⭐⭐ | 市面几乎没有。Agent执行中暂停→序列化完整状态→用户检查修改→恢复执行，进程级控制+状态重建 |
| **Git-native精确回滚** | ⭐⭐⭐⭐ | 每步自动commit快照，回滚时精确恢复（含未跟踪文件清理），比rm -rf高几个量级 |
| **LLM驱动工作流匹配** | ⭐⭐⭐⭐ | 用户意图+工作流描述拼Prompt→LLM判断最匹配项，比关键词匹配更智能，比向量检索更可控 |
| **Adapter抽象层** | ⭐⭐⭐ | 统一Agent Harness接口，CodeBuddy/Claude/OpenAI/HTTP四种实现，证明抽象设计能力 |
| **条件边求值** | ⭐⭐⭐⭐ | 沙箱执行表达式，支持并行分支后条件汇聚，不是简单的if-else |
| **多端实时状态同步** | ⭐⭐⭐ | H5确认→WebSocket→Engine继续，分布式状态一致性 |
| **自进化引擎** | ⭐⭐⭐⭐⭐ | 执行日志→LLM分析→优化建议，从数据中学习改进流程，AI闭环 |
