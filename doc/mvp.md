# AgentFlow MVP — 可行性验证版

## 一、MVP 目标

**一句话：验证架构设计的核心机制是否可行。**

不是做产品，是做技术验证。每个模块只验证"能不能跑通"，不验证"做得好不好"。

### 必须验证的 5 个核心假设

| # | 假设 | 验证方式 |
|---|------|---------|
| 1 | DAG引擎能正确执行拓扑排序+并行+条件分支 | 构造一个含并行+条件边的DAG，跑通 |
| 2 | Agent Adapter的事件驱动双向交互能跑通 | 用CodeBuddy Adapter执行一个节点，中间触发确认，用户回复后继续 |
| 3 | 断点调试能暂停/检查/恢复 | 在节点上设断点，执行到该节点暂停，查看数据，继续执行 |
| 4 | Git快照回滚能精确恢复 | 执行两步后回滚到第一步，验证文件恢复 |
| 5 | LLM工作流匹配能正确选择 | 输入一个任务描述，匹配到正确的工作流 |

---

## 二、MVP 范围裁剪

### 保留（核心验证项）

- DAG引擎（拓扑排序、并行调度、条件边求值）
- 一个Adapter（CodeBuddy）
- 工作流匹配（LLM驱动）
- 断点调试（暂停/继续/查看数据）
- Git快照与回滚
- 双来源Approval（Agent确认 + 节点确认）
- 工作流DAG可视化编辑（React Flow）
- 任务执行实时监控（步骤状态 + 日志）
- 节点注册中心（CRUD）

### 砍掉

| 砍掉项 | 理由 | MVP替代方案 |
|--------|------|------------|
| Electron | 非核心，验证不依赖客户端形态 | 纯HTML页面 |
| H5 | 非核心 | 无 |
| PostgreSQL | 验证不依赖数据库选型 | JSON文件存储 |
| Redis | 验证不需要缓存 | 内存字典 |
| MinIO | 验证不需要对象存储 | 本地文件系统 |
| 用户认证 | 多用户不是核心假设 | 单用户硬编码 |
| 工作流市场 | 不是核心假设 | 无 |
| 自进化引擎 | 扩展模块 | 无 |
| Hook引擎 | 不是核心假设 | 预留接口不实现 |
| 工作流版本历史 | 不是核心假设 | 无 |
| 节点自定义创建 | 不是核心假设 | 预置3个节点 |

---

## 三、MVP 技术方案

```
┌──────────────────────────────────────────────┐
│              纯HTML前端 (单页面)                │
│  React Flow (CDN) · fetch API · EventSource   │
└──────────────────┬───────────────────────────┘
                   │ HTTP + SSE
                   ▼
┌──────────────────────────────────────────────┐
│           FastAPI 后端 (单进程)                 │
│  DAG引擎 · CodeBuddyAdapter · 匹配 · 快照 · 调试│
└──────────────────┬───────────────────────────┘
                   │
         ┌─────────┼─────────┐
         ▼         ▼         ▼
    JSON文件    Git仓库    CodeBuddy进程
    (数据存储)  (快照)     (Agent执行)
```

### 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 后端 | FastAPI | 同架构设计 |
| 前端 | 单HTML文件 | 内联JS，React Flow用CDN |
| 数据存储 | JSON文件 | 一个文件存所有数据 |
| Agent执行 | CodeBuddy (cbc) | `codebuddy -p --output-format stream-json` 无头模式 |
| Git快照 | GitPython | 同架构设计 |
| LLM调用 | OpenAI兼容接口 | 通过 `.env` 配置，支持任意 OpenAI 兼容 API |
| 实时推送 | SSE | 比WebSocket更简单，单页面够用 |

### LLM配置

```python
# config.py — 通过 .env 加载配置
# .env 文件内容示例:
LLM_API_KEY=your-api-key
LLM_API_BASE=https://api.example.com/v1/
LLM_MODEL=gpt-4
```

所有引擎内部LLM调用（意图解析、工作流匹配、自进化分析）均通过此配置。

### 目录结构

```
agentflow-mvp/
├── server/                     ← Python后端
│   ├── main.py                ← FastAPI入口 + 静态文件服务
│   ├── config.py              ← 配置（LLM、CodeBuddy路径、工作目录等）
│   ├── core/
│   │   ├── dag.py             ← DAG图模型 + 校验 + 环检测
│   │   ├── scheduler.py       ← 拓扑排序 + 并行调度 + 条件求值
│   │   ├── executor.py        ← 节点执行器（事件驱动）
│   │   └── events.py          ← 事件总线
│   ├── adapters/
│   │   ├── base.py            ← Adapter抽象基类
│   │   ├── events.py          ← Adapter事件定义
│   │   └── codebuddy.py       ← CodeBuddy Adapter
│   ├── services/
│   │   ├── store.py           ← JSON文件存储
│   │   ├── task_service.py    ← 任务管理
│   │   ├── workflow_service.py← 工作流管理
│   │   ├── node_service.py    ← 节点管理
│   │   ├── snapshot_service.py← Git快照
│   │   ├── debug_service.py   ← 断点调试
│   │   ├── approval_service.py← 确认/待办
│   │   └── matcher_service.py ← LLM工作流匹配
│   ├── models/
│   │   └── schemas.py         ← Pydantic模型（全在一个文件）
│   └── api/
│       ├── workflows.py       ← 工作流CRUD
│       ├── nodes.py           ← 节点CRUD
│       ├── tasks.py           ← 任务控制
│       ├── debug.py           ← 调试API
│       ├── snapshots.py       ← 快照API
│       ├── approvals.py       ← 确认API
│       └── match.py           ← 匹配API
│
├── web/
│   └── index.html             ← 单页面（内联CSS/JS）
│
├── data/                       ← 运行时数据（gitignore）
│   ├── store.json             ← 所有业务数据
│   └── workspaces/            ← 任务工作目录（含git仓库 + .codebuddy配置）
│
├── extensions/
│   ├── nodes/                 ← 预置节点定义
│   │   ├── code-generation/
│   │   │   └── node.yaml
│   │   ├── code-review/
│   │   │   └── node.yaml
│   │   └── bug-fix/
│   │       └── node.yaml
│   └── templates/             ← 预置工作流模板
│       ├── feature-dev.yaml
│       └── bug-fix.yaml
│
├── pyproject.toml
└── requirements.txt
```

---

## 四、MVP 数据存储方案

不用数据库，用一个JSON文件存所有数据，启动时加载到内存，修改时写回文件。

### store.json 结构

```json
{
  "workflows": {
    "{workflow_id}": {
      "id": "uuid",
      "name": "需求开发流程",
      "description": "适用于新功能开发场景，包含代码生成、代码审查两个步骤",
      "category": "feature-dev",
      "dag": {
        "nodes": [
          {
            "id": "node_1",
            "definition_id": "code-generation",
            "position": { "x": 100, "y": 200 },
            "config": {},
            "hooks": []
          },
          {
            "id": "node_2",
            "definition_id": "code-review",
            "position": { "x": 400, "y": 200 },
            "config": { "need_approval": true },
            "hooks": []
          }
        ],
        "edges": [
          {
            "source_id": "node_1",
            "target_id": "node_2",
            "condition": null,
            "data_mapping": {
              "node_2.input.code": "node_1.output.code"
            }
          }
        ]
      },
      "input_schema": {},
      "output_schema": {},
      "version": 1,
      "status": "draft",
      "created_at": "2026-01-01T00:00:00Z",
      "updated_at": "2026-01-01T00:00:00Z"
    }
  },
  "nodes": {
    "{node_def_id}": {
      "id": "uuid",
      "name": "code-generation",
      "display_name": "代码生成",
      "description": "根据需求描述生成代码",
      "category": "development",
      "adapter_type": "codebuddy",
      "config_schema": {},
      "input_schema": {},
      "output_schema": {},
      "default_config": {
        "prompt_template": "请根据以下需求生成代码：{input.requirement}"
      }
    }
  },
  "tasks": {
    "{task_id}": {
      "id": "uuid",
      "title": "帮我写一个用户登录页面",
      "intent": "前端页面开发，用户认证相关",
      "matched_workflow_id": "uuid",
      "status": "running",
      "execution_mode": "workflow",
      "context": {
        "current_step_id": "node_1",
        "step_states": {
          "node_1": "running",
          "node_2": "pending"
        },
        "variables": {},
        "breakpoints": [],
        "adapter_session_id": "session_xxx"
      },
      "input_data": { "requirement": "用户登录页面" },
      "output_data": null,
      "created_at": "2026-01-01T00:00:00Z",
      "started_at": "2026-01-01T00:00:01Z",
      "completed_at": null
    }
  },
  "steps": {
    "{step_id}": {
      "id": "uuid",
      "task_id": "uuid",
      "node_id": "node_1",
      "status": "running",
      "snapshot_id": null,
      "input_data": { "requirement": "用户登录页面" },
      "output_data": null,
      "error": null,
      "retry_count": 0,
      "round_count": 1,
      "approval_count": 0,
      "debug_info": null,
      "started_at": "2026-01-01T00:00:02Z",
      "completed_at": null
    }
  },
  "snapshots": {
    "{snapshot_id}": {
      "id": "uuid",
      "task_id": "uuid",
      "step_id": "uuid",
      "type": "pre_step",
      "git_commit_hash": "abc123",
      "git_diff": null,
      "untracked_files": [],
      "environment": {},
      "created_at": "2026-01-01T00:00:02Z"
    }
  },
  "approvals": {
    "{approval_id}": {
      "id": "uuid",
      "task_id": "uuid",
      "step_id": "uuid",
      "source": "agent",
      "type": "confirm",
      "title": "确认执行命令",
      "description": "是否执行: npm install express?",
      "options": null,
      "input_schema": null,
      "context_data": { "command": "npm install express", "risk_level": "low" },
      "status": "pending",
      "result": null,
      "expires_at": null,
      "created_at": "2026-01-01T00:00:10Z",
      "resolved_at": null
    }
  }
}
```

---

## 五、MVP 核心模块设计

### 5.1 DAG 引擎（验证假设1）

**验证目标**：拓扑排序正确、并行执行有效、条件边能动态求值

**测试用DAG**：

```
                    ┌──────────────┐
                    │ 代码生成(A)   │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    ▼              ▼
            ┌──────────┐   ┌──────────┐
            │ 前端编译(B)│   │ 后端检查(C)│   ← 并行节点
            └─────┬────┘   └─────┬────┘
                  │              │
                  │   condition   │
                  │ "status=ok"  │
                  ▼              ▼
            ┌──────────────────────┐
            │   代码审查(D)         │   ← 条件汇聚：B和C都成功才执行
            └──────────────────────┘
```

**关键实现**：

```python
# dag.py — 核心校验
class DAGModel:
    def validate(self, dag: DAGDefinition) -> list[str]:
        """校验DAG，返回错误列表"""
        errors = []
        # 1. 环检测 (DFS三色标记)
        # 2. 节点定义存在性
        # 3. 边的类型兼容
        return errors

# scheduler.py — 调度核心
class DAGScheduler:
    def topological_sort(self, dag: DAGDefinition) -> list[list[str]]:
        """Kahn算法，返回执行层级"""
        # 计算入度
        # BFS分层
        # 返回 [[node_a, node_b], [node_c], [node_d]]
    
    async def execute_level(self, level_nodes, executor):
        """并行执行一层节点"""
        tasks = [executor.execute(node_id) for node_id in level_nodes]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return results
    
    def evaluate_condition(self, condition: str, output_data: dict) -> bool:
        """条件边求值"""
        # 沙箱eval
```

### 5.2 CodeBuddy Adapter（验证假设2）

**验证目标**：能启动CodeBuddy进程、能接收流式事件、能通过`--resume`实现多轮、能检测确认请求

**CodeBuddy 无头模式核心能力**（来自官方文档）：

```bash
# 单轮执行（非交互，打印结果）
codebuddy -p "请生成一个登录页面" --output-format stream-json -y

# 多轮：先获取session_id，再resume
codebuddy -p "请生成代码" --output-format json -y
# 返回 {"session_id": "xxx", "result": "...", ...}

codebuddy --resume xxx "请修改登录按钮颜色" -p --output-format stream-json -y

# 流式JSON输入（多轮对话在同一进程内）
echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"第一问"}]}}' \
  | codebuddy -p --input-format stream-json --output-format stream-json -y

# 追加系统提示词
codebuddy -p "生成代码" --append-system-prompt "你是Vue2专家" -y

# 限制工具
codebuddy -p "生成代码" --allowedTools "Bash,Read,Write" -y
```

**实现策略**：

```python
# codebuddy.py
class CodeBuddyAdapter(AgentHarnessAdapter):
    """
    CodeBuddy Adapter — 基于 codebuddy CLI 无头模式
    
    执行模式:
      - 单轮: codebuddy -p "prompt" --output-format stream-json -y
      - 多轮: codebuddy --resume {session_id} -p "next prompt" --output-format stream-json -y
    
    输出格式 (stream-json):
      每行一个JSON对象，包含:
      - init 系统消息 (含session_id)
      - assistant 消息 (含thinking/text/tool_use)
      - result 系统消息 (含统计信息)
    """
    
    async def start_session(self, config: NodeConfig) -> str:
        """启动CodeBuddy会话"""
        session_id = str(uuid4())
        workspace = config.workspace  # 任务工作目录
        
        # 1. 如果节点有agent/skill/plugin文件，复制到 workspace/.codebuddy/ 目录
        if config.node_files:
            codebuddy_dir = os.path.join(workspace, ".codebuddy")
            os.makedirs(os.path.join(codebuddy_dir, "agents"), exist_ok=True)
            os.makedirs(os.path.join(codebuddy_dir, "skills"), exist_ok=True)
            for f in config.node_files:
                dest = os.path.join(codebuddy_dir, f.path)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as fh:
                    fh.write(f.content)
        
        # 2. 构建提示词（从节点配置的prompt_template渲染）
        prompt = config.prompt_template.format(
            input=config.input_data,
            workspace=workspace,
        )
        
        # 3. 构建命令
        cmd = [
            "codebuddy", "-p", prompt,
            "--output-format", "stream-json",
            "-y",  # 非交互模式跳过权限确认
        ]
        
        # 4. 如果有系统提示词追加
        if config.system_prompt_append:
            cmd.extend(["--append-system-prompt", config.system_prompt_append])
        
        # 5. 如果有限制工具
        if config.allowed_tools:
            cmd.extend(["--allowedTools", config.allowed_tools])
        
        # 6. 启动进程
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workspace,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        self.sessions[session_id] = {
            "process": process,
            "workspace": workspace,
            "codebuddy_session_id": None,  # 从stream-json输出中解析
        }
        return session_id
    
    async def send_input(self, session_id: str, input_data: dict) -> None:
        """发送输入（仅在stream-json输入模式下使用）"""
        session = self.sessions[session_id]
        process = session["process"]
        msg = json.dumps({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": input_data.get("message", "")}]
            }
        }) + "\n"
        process.stdin.write(msg.encode())
        await process.stdin.drain()
    
    async def on_event(self, session_id: str) -> AsyncIterator[AdapterEvent]:
        """监听stdout，解析stream-json事件流"""
        session = self.sessions[session_id]
        process = session["process"]
        
        async for line in process.stdout:
            line = line.decode().strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                # 非JSON行，当作日志
                yield AgentThinkingEvent(content=line)
                continue
            
            # 解析stream-json格式
            msg_type = data.get("type")
            
            if msg_type == "system":
                # init消息 — 提取session_id
                if data.get("subtype") == "init":
                    cb_session = data.get("session_id")
                    if cb_session:
                        session["codebuddy_session_id"] = cb_session
                # result消息 — 执行完成
                elif data.get("subtype") == "result":
                    yield ExecutionCompletedEvent(output={
                        "result": data.get("result", ""),
                        "session_id": data.get("session_id"),
                        "total_cost": data.get("total_cost_usd"),
                    })
            
            elif msg_type == "assistant":
                # Agent输出
                message = data.get("message", {})
                content_blocks = message.get("content", [])
                for block in content_blocks:
                    if block.get("type") == "thinking":
                        yield AgentThinkingEvent(content=block.get("thinking", ""))
                    elif block.get("type") == "text":
                        yield ProgressUpdateEvent(content=block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        # 工具调用 — 检测是否需要确认
                        tool_name = block.get("name", "")
                        tool_input = block.get("input", {})
                        # 高风险工具检测
                        if self._is_risky_tool(tool_name, tool_input):
                            yield ApprovalNeededEvent(approval={
                                "source": "agent",
                                "type": "confirm",
                                "title": f"Agent请求执行: {tool_name}",
                                "description": json.dumps(tool_input, ensure_ascii=False)[:500],
                                "context_data": {
                                    "tool_name": tool_name,
                                    "tool_input": tool_input,
                                    "risk_level": "high" if self._is_risky_tool(tool_name, tool_input) else "low",
                                }
                            })
            
            elif msg_type == "user":
                # 工具调用结果回传（CodeBuddy自动处理）
                pass
        
        # 进程结束
        await process.wait()
        if session["codebuddy_session_id"] is None:
            # 如果还没收到完成事件，用exit code判断
            yield ExecutionCompletedEvent(output={
                "exit_code": process.returncode,
                "error": "进程异常退出" if process.returncode != 0 else None,
            })
    
    async def respond(self, session_id: str, approval_id: str, response: dict) -> None:
        """回复确认
        
        CodeBuddy在 -y 模式下自动确认权限，所以正常不会走到这里。
        但如果不用 -y 模式，或者我们想对高风险操作做二次确认，
        可以通过 --resume 重新启动进程来传递确认。
        
        MVP策略: 使用 -y 模式自动确认，高风险工具在Adapter层拦截后
        通过Approval机制让用户确认，确认后通过 --resume 重新执行。
        """
        if response.get("approved"):
            # 用户批准 — 通过resume继续
            session = self.sessions[session_id]
            cb_session_id = session["codebuddy_session_id"]
            if cb_session_id:
                # 终止当前进程
                session["process"].terminate()
                # 用 --resume 重启，追加确认指令
                prompt = f"用户已确认，请继续执行"
                process = await asyncio.create_subprocess_exec(
                    "codebuddy", "--resume", cb_session_id,
                    "-p", prompt,
                    "--output-format", "stream-json",
                    "-y",
                    cwd=session["workspace"],
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                session["process"] = process
        else:
            # 用户拒绝 — 终止进程
            session = self.sessions[session_id]
            session["process"].terminate()
    
    async def resume_session(self, session_id: str, prompt: str) -> None:
        """恢复会话（多轮对话）— 节点内部多轮时使用"""
        session = self.sessions[session_id]
        cb_session_id = session["codebuddy_session_id"]
        if not cb_session_id:
            return
        
        # 终止当前进程
        session["process"].terminate()
        
        # 用 --resume 重启
        process = await asyncio.create_subprocess_exec(
            "codebuddy", "--resume", cb_session_id,
            "-p", prompt,
            "--output-format", "stream-json",
            "-y",
            cwd=session["workspace"],
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        session["process"] = process
    
    def _is_risky_tool(self, tool_name: str, tool_input: dict) -> bool:
        """判断是否为高风险工具调用"""
        risky_commands = ["rm ", "rmdir", "del ", "format", "mkfs", "dd ", "> /dev/"]
        if tool_name == "Bash":
            cmd = str(tool_input.get("command", ""))
            return any(r in cmd for r in risky_commands)
        return False
    
    async def terminate(self, session_id: str) -> None:
        """终止会话"""
        session = self.sessions.get(session_id)
        if session and session["process"].returncode is None:
            session["process"].terminate()
```

**关键设计决策**：

1. **使用 `-y` 模式**：CodeBuddy 的 `--dangerously-skip-permissions` 让Agent自动执行，不阻塞等待确认。这样我们的事件流不会因为权限弹框中断。

2. **高风险操作拦截**：在Adapter层检测 `tool_use` 事件，如果发现高风险命令（rm、format等），主动发起Approval让用户确认，而不是依赖CodeBuddy自身的权限系统。

3. **多轮通过 `--resume`**：每轮是一个独立的 `codebuddy` 进程，通过 `--resume {session_id}` 延续上下文。session_id从stream-json输出的init消息中获取。

4. **Agent/Skill注入**：节点定义的文件（agent/skill/plugin）复制到工作目录的 `.codebuddy/` 下，CodeBuddy启动时自动加载。

### 5.3 断点调试（验证假设3）

**验证目标**：能暂停、能查看数据、能继续

**实现策略**：

```python
# debug_service.py
class DebugService:
    async def set_breakpoint(self, task_id: str, node_id: str):
        """设置断点"""
        task = store.tasks[task_id]
        task.context.breakpoints.add(node_id)
        store.save()
    
    async def hit_breakpoint(self, task_id: str, node_id: str):
        """命中断点 — 由executor调用"""
        task = store.tasks[task_id]
        step = self._find_step(task_id, node_id)
        
        # 1. 暂停Adapter事件流（不读stdout，但进程继续运行）
        #    MVP简化：直接暂停整个executor协程
        task.status = "paused"
        step.status = "running"  # 仍标记为running，因为还没完成
        step.debug_info = {
            "agent_thinking": "断点命中，等待用户操作",
            "breakpoint_node": node_id,
            "input_data": step.input_data,
            "output_data_so_far": None,
        }
        store.save()
        
        # 2. 发送SSE事件
        await event_bus.emit(task_id, "breakpoint_hit", {
            "node_id": node_id,
            "debug_info": step.debug_info,
        })
        
        # 3. 等待用户操作（通过approval机制）
        approval_id = str(uuid4())
        store.approvals[approval_id] = Approval(
            id=approval_id,
            task_id=task_id,
            step_id=step.id,
            source="workflow",
            type="choice",
            title=f"断点命中: {node_id}",
            description="选择操作",
            options=[
                {"label": "继续执行", "value": "continue"},
                {"label": "单步执行", "value": "step_over"},
                {"label": "回滚到此步骤前", "value": "rollback"},
            ],
            status="pending",
        )
        store.save()
        
        # 4. 阻塞等待用户响应
        result = await self._wait_for_approval(approval_id)
        return result
```

### 5.4 Git快照回滚（验证假设4）

**验证目标**：快照能创建、回滚能精确恢复

**实现策略**：

```python
# snapshot_service.py
class SnapshotService:
    def __init__(self, workspace_root: str):
        self.workspace_root = workspace_root
    
    async def create_snapshot(self, task_id: str, step_id: str, 
                               snapshot_type: str) -> str:
        """创建快照"""
        workspace = os.path.join(self.workspace_root, task_id)
        repo = git.Repo(workspace)
        
        # 1. git add -A
        repo.git.add("-A")
        
        # 2. 获取未跟踪文件列表
        untracked = repo.untracked_files
        
        # 3. git commit
        commit = repo.index.commit(f"snapshot: {snapshot_type} step={step_id}")
        
        # 4. 记录快照
        snapshot_id = str(uuid4())
        store.snapshots[snapshot_id] = Snapshot(
            id=snapshot_id,
            task_id=task_id,
            step_id=step_id,
            type=snapshot_type,
            git_commit_hash=commit.hexsha,
            git_diff=None,
            untracked_files=untracked,
            environment={},
        )
        store.save()
        return snapshot_id
    
    async def rollback(self, task_id: str, snapshot_id: str):
        """回滚到快照"""
        snapshot = store.snapshots[snapshot_id]
        workspace = os.path.join(self.workspace_root, task_id)
        repo = git.Repo(workspace)
        
        # 1. git reset --hard
        repo.git.reset("--hard", snapshot.git_commit_hash)
        
        # 2. 清理快照后出现的未跟踪文件
        current_untracked = set(repo.untracked_files)
        snapshot_untracked = set(snapshot.untracked_files)
        new_untracked = current_untracked - snapshot_untracked
        for f in new_untracked:
            filepath = os.path.join(workspace, f)
            if os.path.isfile(filepath):
                os.remove(filepath)
        
        # 3. 重置步骤状态
        task = store.tasks[task_id]
        for step_id, step in store.steps.items():
            if step.task_id == task_id and step.started_at:
                step_created = store.snapshots[step.snapshot_id].created_at if step.snapshot_id else None
                if step_created and step_created > snapshot.created_at:
                    step.status = "rolled_back"
        store.save()
```

### 5.5 LLM工作流匹配（验证假设5）

**验证目标**：给一个任务描述，能匹配到正确的工作流

**实现策略**：

```python
# matcher_service.py
from openai import OpenAI

class MatcherService:
    def __init__(self):
        self.client = OpenAI(
            api_key=LLM_API_KEY,
            base_url=LLM_API_BASE,
        )
    
    async def match(self, user_input: str) -> dict | None:
        """匹配工作流"""
        # 1. 意图解析
        intent_prompt = f"""分析以下用户任务描述，提取结构化意图：
用户任务: {user_input}

请输出JSON:
{{"category": "feature-dev/bug-fix/refactor/test/other", "keywords": ["..."], "summary": "一句话总结"}}"""

        intent_response = self.client.chat.completions.create(
            model="default",
            messages=[{"role": "user", "content": intent_prompt}],
            response_format={"type": "json_object"}
        )
        intent = json.loads(intent_response.choices[0].message.content)
        
        # 2. 工作流匹配
        workflow_descriptions = []
        for wf_id, wf in store.workflows.items():
            workflow_descriptions.append(f"- ID: {wf_id}\n  名称: {wf.name}\n  描述: {wf.description}")
        
        workflow_text = "\n".join(workflow_descriptions) if workflow_descriptions else "暂无工作流"
        
        match_prompt = f"""用户任务: {user_input}
意图分析: {json.dumps(intent, ensure_ascii=False)}

可用工作流:
{workflow_text}

请选择最适合用户任务的工作流ID。如果没有合适的，返回null。
输出JSON: {{"workflow_id": "uuid或null", "confidence": 0.0-1.0, "reason": "选择理由"}}"""

        match_response = self.client.chat.completions.create(
            model="default",
            messages=[{"role": "user", "content": match_prompt}],
            response_format={"type": "json_object"}
        )
        result = json.loads(match_response.choices[0].message.content)
        
        if result["workflow_id"] and result["confidence"] >= 0.5:
            return {
                "workflow_id": result["workflow_id"],
                "confidence": result["confidence"],
                "reason": result["reason"],
                "workflow": store.workflows.get(result["workflow_id"]),
            }
        return None
```

---

## 六、MVP 前端页面设计

### 单页面布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  AgentFlow MVP                                            [匹配测试] │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                       │
│   左侧面板    │                    主区域                              │
│              │                                                       │
│  ┌────────┐ │  ┌─────────────────────────────────────────────────┐  │
│  │工作流列表│ │  │                                                   │  │
│  │         │ │  │              DAG 可视化编辑器                      │  │
│  │· 流程1  │ │  │              (React Flow)                        │  │
│  │· 流程2  │ │  │                                                   │  │
│  │         │ │  │   [代码生成] ──→ [前端编译] ──→ [代码审查]          │  │
│  ├────────┤ │  │                └──→ [后端检查] ──↗                 │  │
│  │节点列表  │ │  │                                                   │  │
│  │         │ │  └─────────────────────────────────────────────────┘  │
│  │· 节点1  │ │                                                       │
│  │· 节点2  │ │  ┌─────────────────────────────────────────────────┐  │
│  ├────────┤ │  │              执行监控 / 调试面板                     │  │
│  │任务列表  │ │  │                                                   │  │
│  │         │ │  │  Step 1: 代码生成     ✅ completed                │  │
│  │· 任务1  │ │  │  Step 2: 前端编译     🔄 running                  │  │
│  │· 任务2  │ │  │  Step 3: 代码审查     ⏳ pending                  │  │
│  └────────┘ │  │                                                   │  │
│              │  │  [实时日志...]                                     │  │
│              │  │  > Agent思考: 我需要先查看项目结构...                │  │
│              │  │  > 正在执行: npm install                           │  │
│              │  │                                                   │  │
│              │  │  ⚠️ 确认请求: 是否执行 rm -rf node_modules?       │  │
│              │  │     [批准] [拒绝]                                  │  │
│              │  └─────────────────────────────────────────────────┘  │
└──────────────┴───────────────────────────────────────────────────────┘
```

### 页面功能分区

| 区域 | 功能 | MVP实现 |
|------|------|---------|
| 左侧-工作流 | 工作流列表+新建 | 点击切换，新建弹框填写name/description |
| 左侧-节点 | 节点列表（只读） | 展示预置节点，拖入DAG画布 |
| 左侧-任务 | 任务列表+状态 | 展示所有任务，点击切换到执行视图 |
| 主区域-上 | DAG编辑器 | React Flow，拖拽建节点+连线 |
| 主区域-下 | 执行监控+调试 | 步骤状态+实时日志+确认请求 |

### 核心交互流程

```
1. 创建工作流:
   点击"新建工作流" → 弹框输入名称/描述 → 空DAG画布
   → 从左侧拖入节点 → 连线 → 配置条件/映射 → 保存

2. 创建任务:
   点击"新建任务" → 输入任务描述
   → 后端匹配工作流 → 展示匹配结果 → 确认 → 开始执行

3. 监控执行:
   任务开始 → SSE推送步骤状态更新
   → 步骤时间线实时变化 → 日志流式展示
   → 遇到确认请求 → 弹框让用户操作

4. 断点调试:
   右键节点 → "设为断点" → 节点标红
   → 执行到该节点 → 暂停 → 显示调试面板
   → 查看/修改数据 → 继续执行

5. 回滚:
   点击步骤 → "回滚到此步" → 确认
   → git reset → 重新执行
```

---

## 七、MVP API 设计

### 工作流

```
GET    /api/workflows              ← 列表
POST   /api/workflows              ← 创建
GET    /api/workflows/{id}         ← 详情（含DAG）
PUT    /api/workflows/{id}         ← 更新（含DAG变更）
DELETE /api/workflows/{id}         ← 删除
```

### 节点

```
GET    /api/nodes                  ← 列表（预置节点）
GET    /api/nodes/{name}           ← 详情
```

### 任务

```
POST   /api/tasks                  ← 创建（触发匹配+执行）
GET    /api/tasks                  ← 列表
GET    /api/tasks/{id}             ← 详情
POST   /api/tasks/{id}/pause       ← 暂停
POST   /api/tasks/{id}/resume      ← 恢复
POST   /api/tasks/{id}/cancel      ← 取消
```

### 调试

```
POST   /api/tasks/{id}/breakpoints          ← 设置断点 {node_id}
DELETE /api/tasks/{id}/breakpoints/{node_id} ← 移除断点
POST   /api/tasks/{id}/debug/continue       ← 继续执行
POST   /api/tasks/{id}/debug/step-over      ← 单步执行
```

### 快照与回滚

```
GET    /api/tasks/{id}/snapshots             ← 快照列表
POST   /api/tasks/{id}/snapshots/{sid}/rollback ← 回滚
```

### 确认

```
GET    /api/approvals                        ← 待办列表
POST   /api/approvals/{id}/resolve           ← 处理 {approved: bool, result: ...}
```

### 匹配

```
POST   /api/match                            ← 匹配 {user_input: "..."}
```

### SSE 实时推送

```
GET    /api/events?task_id={id}              ← SSE事件流

事件类型:
  task:status_changed    {task_id, status}
  task:step_started     {task_id, step_id, node_id}
  task:step_completed   {task_id, step_id, output}
  task:step_failed      {task_id, step_id, error}
  task:breakpoint_hit   {task_id, step_id, node_id, debug_info}
  task:approval_needed  {task_id, approval_id, source, title, ...}
  task:log              {task_id, step_id, content}
  task:agent_thinking   {task_id, step_id, content}
```

---

## 八、预置数据

### 预置节点定义（3个）

**1. code-generation（代码生成）**

```yaml
# extensions/nodes/code-generation/node.yaml
name: code-generation
display_name: 代码生成
description: 根据需求描述生成代码
category: development
adapter_type: codebuddy
default_config:
  prompt_template: |
    你是一个代码生成专家。
    请根据以下需求生成代码：
    {input.requirement}
    
    项目信息:
    - 工作目录: {workspace}
    - 技术栈: {input.tech_stack}
  allowed_tools: "Bash,Read,Write,Glob,Grep"
input_schema:
  type: object
  properties:
    requirement:
      type: string
      description: 需求描述
    tech_stack:
      type: string
      description: 技术栈
  required: [requirement]
output_schema:
  type: object
  properties:
    files_created:
      type: array
      items:
        type: string
    summary:
      type: string
```

**2. code-review（代码审查）**

```yaml
# extensions/nodes/code-review/node.yaml
name: code-review
display_name: 代码审查
description: 审查生成的代码质量
category: review
adapter_type: codebuddy
default_config:
  prompt_template: |
    你是一个代码审查专家。
    请审查以下目录中新生成的代码: {workspace}
    
    审查要点:
    1. 代码规范
    2. 安全问题
    3. 性能问题
    4. 最佳实践
    
    请输出审查结果和修改建议。
  need_approval: true
  allowed_tools: "Read,Glob,Grep"
input_schema:
  type: object
  properties:
    workspace:
      type: string
      description: 代码目录
output_schema:
  type: object
  properties:
    issues:
      type: array
    suggestions:
      type: string
    approved:
      type: boolean
```

**3. bug-fix（Bug修复）**

```yaml
# extensions/nodes/bug-fix/node.yaml
name: bug-fix
display_name: Bug修复
description: 根据Bug描述分析和修复代码
category: fix
adapter_type: codebuddy
default_config:
  prompt_template: |
    你是一个Bug修复专家。
    请根据以下Bug描述，找到并修复问题：
    
    Bug描述: {input.bug_description}
    复现步骤: {input.reproduce_steps}
    
    项目信息:
    - 工作目录: {workspace}
    - 相关文件: {input.related_files}
  allowed_tools: "Bash,Read,Write,Glob,Grep"
input_schema:
  type: object
  properties:
    bug_description:
      type: string
      description: Bug描述
    reproduce_steps:
      type: string
      description: 复现步骤
    related_files:
      type: array
      items:
        type: string
  required: [bug_description]
output_schema:
  type: object
  properties:
    root_cause:
      type: string
    fix_summary:
      type: string
    files_modified:
      type: array
      items:
        type: string
```

### 预置工作流模板（2个）

**1. 需求开发流程**

```yaml
# extensions/templates/feature-dev.yaml
name: 需求开发流程
description: 适用于新功能开发场景，先生成代码再审查质量
category: feature-dev
dag:
  nodes:
    - id: code_gen
      definition_id: code-generation
      position: {x: 100, y: 200}
      config: {}
    - id: code_review
      definition_id: code-review
      position: {x: 400, y: 200}
      config: {need_approval: true}
  edges:
    - source_id: code_gen
      target_id: code_review
      condition: null
      data_mapping:
        code_review.input.workspace: "$workflow.workspace"
```

**2. Bug修复流程**

```yaml
# extensions/templates/bug-fix.yaml
name: Bug修复流程
description: 适用于Bug修复场景，先修复再审查
category: bug-fix
dag:
  nodes:
    - id: bug_fix
      definition_id: bug-fix
      position: {x: 100, y: 200}
      config: {}
    - id: review
      definition_id: code-review
      position: {x: 400, y: 200}
      config: {need_approval: true}
  edges:
    - source_id: bug_fix
      target_id: review
      condition: null
      data_mapping:
        review.input.workspace: "$workflow.workspace"
```

---

## 九、MVP 验证测试计划

### 测试1: DAG引擎

```
前置: 创建一个含并行+条件分支的DAG
步骤:
  1. POST /api/workflows 创建工作流，DAG含4个节点(A→B,C→D)
  2. POST /api/tasks 创建任务，关联该工作流
  3. 观察执行顺序：A先执行 → B和C并行 → D条件汇聚
预期: 执行顺序正确，并行节点同时开始，条件不满足时跳过
```

### 测试2: Agent交互

```
前置: 启动一个任务，节点使用CodeBuddy
步骤:
  1. POST /api/tasks 创建并启动任务
  2. SSE监听事件流
  3. 等待AgentThinking事件（证明stream-json解析成功）
  4. 等待ApprovalNeeded事件（证明高风险工具检测成功）
  5. POST /api/approvals/{id}/resolve 批准
  6. 继续监听，等待ExecutionCompleted事件
预期: 事件流正确，确认请求能转发，回复后Agent继续
```

### 测试3: 断点调试

```
前置: 创建工作流，给第二个节点设断点
步骤:
  1. POST /api/tasks/{id}/breakpoints 设置断点
  2. 启动任务
  3. 第一个节点完成后，第二个节点应暂停
  4. 收到breakpoint_hit事件
  5. GET /api/tasks/{id} 查看debug_info
  6. POST /api/tasks/{id}/debug/continue 继续执行
预期: 断点命中，数据可查看，继续后执行完成
```

### 测试4: Git快照回滚

```
前置: 启动任务，执行两个步骤
步骤:
  1. 任务执行完成2个步骤
  2. GET /api/tasks/{id}/snapshots 查看快照列表
  3. POST /api/tasks/{id}/snapshots/{sid}/rollback 回滚到步骤1
  4. 检查工作目录文件是否恢复
  5. 重新执行步骤2
预期: 文件精确恢复，步骤状态正确回退，可重新执行
```

### 测试5: 工作流匹配

```
前置: 预置2个工作流（需求开发、Bug修复）
步骤:
  1. POST /api/match {user_input: "帮我修复登录页面的崩溃问题"}
  2. 检查返回的workflow_id是否为bug-fix工作流
  3. POST /api/match {user_input: "新增一个用户注册页面"}
  4. 检查返回的workflow_id是否为feature-dev工作流
  5. POST /api/match {user_input: "帮我写一份周报"}
  6. 检查返回null（无匹配）
预期: 正确匹配，无匹配时返回null
```

---

## 十、MVP 开发计划

### 阶段1: 骨架（1天）

- FastAPI项目搭建 + store.json读写
- Pydantic模型定义
- config.py（LLM配置 + CodeBuddy路径检测）
- 静态HTML页面 + React Flow CDN引入
- 工作流CRUD API + 前端基础布局

### 阶段2: DAG引擎（1天）

- dag.py 校验+环检测
- scheduler.py 拓扑排序+并行执行
- 条件边求值
- 前端DAG编辑器（拖拽+连线+保存）

### 阶段3: CodeBuddy Adapter（1-2天）

- Adapter抽象基类 + 事件定义
- CodeBuddy Adapter（`codebuddy -p --output-format stream-json -y`）
- stream-json输出解析（这是耗时点，格式需要实际调试）
- 高风险工具检测 + Approval拦截
- 多轮对话（`--resume`）支持

### 阶段4: 任务执行 + 确认（1天）

- 任务创建+匹配+启动
- SSE事件推送
- 节点执行流程（快照→执行→确认→下一步）
- 前端执行监控面板

### 阶段5: 调试+回滚（1天）

- 断点设置/命中/继续
- Git快照创建
- Git回滚
- 前端调试面板+回滚操作

### 阶段6: 端到端验证（0.5天）

- 跑通测试1-5
- 修复bug
- 整理验证结论

**总计：5-6天**

---

## 十一、风险与降级方案

| 风险 | 概率 | 影响 | 降级方案 |
|------|------|------|---------|
| CodeBuddy stream-json输出格式与文档不一致 | 中 | 事件解析失败 | 先用 `--output-format json`（非流式）只拿最终结果，不推送中间过程 |
| CodeBuddy `-y` 模式下无法拦截高风险操作 | 中 | 高风险操作自动执行 | 放弃Adapter层拦截，改用 `--allowedTools` 白名单限制可用工具 |
| CodeBuddy `--resume` 多轮对话丢失上下文 | 低 | 多轮不可用 | 改用 `--input-format stream-json` 在同一进程内多轮 |
| LLM API 不支持 `response_format` | 中 | 匹配结果解析失败 | 改用正则从LLM文本输出中提取JSON |
| Git快照在工作目录非Git仓库时失败 | 低 | 回滚不可用 | 初始化任务时自动 `git init` |
| React Flow CDN加载慢 | 低 | 编辑器不可用 | 本地安装npm包 |
