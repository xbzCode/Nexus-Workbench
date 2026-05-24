# 核心链路验证文档

> 版本：v1.1  
> 创建时间：2026-05-24  
> 更新时间：2026-05-24 18:40  
> 状态：✅ 全部通过

## 一、前置检查

### 1.1 环境准备

| 检查项 | 操作 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|
| 服务启动 | `curl http://localhost:8000/api/health` | `{"status":"ok"}` | `{"status":"ok","codebuddy_available":true}` | ✅ |
| CodeBuddy 可用 | health 返回中 `codebuddy_available` | `true` | `true` | ✅ |
| 节点已加载 | `curl http://localhost:8000/api/nodes` | 返回节点列表 | 5个节点已加载 | ✅ |
| 工作流已加载 | `curl http://localhost:8000/api/workflows` | 返回工作流列表 | 4个工作流 | ✅ |

---

## 二、验证 1：单节点执行（基础链路）

### 目的
确认 Agent 能被正常调起、执行、返回结果。

### 测试记录

- 任务ID: `e13ac541` (前次测试)
- 节点: refine-requirements
- Agent 提问后被回答，节点成功完成

### 观察要点

| 观察项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| 任务最终状态 | `completed` | `completed` | ✅ |
| 节点1状态 | `completed` | `completed` | ✅ |
| workspace 中有日志记录 | 是 | `.agentflow/node-execution.log` 存在 | ✅ |

### 结论

- [x] 通过

---

## 三、验证 2：多节点数据传递（🔴 最关键）

### 目的
确认上游节点的输出能被下游节点正确接收和使用。

### 测试记录

- 任务ID: `68cdce0a` (前次测试)
- 工作流: refine-requirements → architecture-diagram
- `previous_output` 成功传递并被 n2 理解

### 观察要点

| 观察项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| n1 节点执行完成 | status=completed | `completed` | ✅ |
| n2 的 input_data 包含 previous_output | 包含上游 text/summary | `{'previous_output': '...', 'previous_status': 'completed'}` | ✅ |
| n2 能理解 previous_output 格式 | 执行未报错 | Agent 理解并正常执行 | ✅ |
| n2 产出了架构图 HTML | workspace 中有 .html 文件 | 是 | ✅ |
| 任务最终状态 | completed | `completed` | ✅ |

### 关键判断

**`_compute_input` 的"智能提取"把上游输出变为 `{'previous_output': '...'}` dict 字符串化后喂给下游 Agent，Agent 是否能理解这种格式？**

- [x] 能理解 — 数据传递设计可用

### 结论

- [x] 通过

---

## 四、验证 3：条件边分支

### 目的
确认 `EdgeDef.condition` 的 eval 求值能正确控制分支走向。

### 测试记录

- 任务ID: `f263656e-55b5-434e-b163-f093e83e8e47`
- 工作流: conditional-branch-v3 (`06ad33fe`)
- DAG: n1(refine-requirements) → n_success(architecture-diagram, condition=`output.status == 'completed'`), n_fail(hello-world, condition=`output.status == 'failed'`)

### 发现的 Bug

**初始测试失败**：`evaluate_condition` 中 `output` 是普通 `dict`，不支持 `output.status` 属性访问语法，导致两个条件分支都被错误地 SKIPPED。

**修复方案**：在 `server/core/scheduler.py` 中添加 `DotDict` 类，包装 `output_data` 以支持 `.key` 语法。

```python
class DotDict(dict):
    """支持属性访问的 dict，用于 eval 条件表达式中 output.key 语法"""
    def __getattr__(self, key):
        try:
            return self[key]
        except KeyError:
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{key}'")
```

修改 `evaluate_condition`:
```python
result = eval(condition, {"__builtins__": {}}, {"output": DotDict(output_data)})
```

### 观察要点

| 观察项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| n1 执行完成后 | status=completed | `completed` | ✅ |
| n_success 被执行 | status=completed | `completed` (生成 conditional-branch-test-architecture.html) | ✅ |
| n_fail 被跳过 | status=skipped | `skipped` | ✅ |
| 条件求值无报错 | 日志无 eval 错误 | DotDict 正常工作，无错误 | ✅ |

### 结论

- [x] 通过（修复 DotDict 后）

---

## 五、验证 4：断点调试

### 目的
确认断点命中→继续→完成的流程。

### 测试记录

- 任务ID: `6b6abbe0-c3df-48b3-aede-1d53ac0f11c6`
- 工作流: refine-test (`682038a6`)
- 断点设在 n2_mpjg6o6e（architecture-diagram）
- 诊断端点误将 Agent 提问当作断点命中，手动回答3轮提问后 n1 完成
- 断点在 n2 处命中，选择 continue 后任务完成

### 观察要点

| 观察项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| 断点命中 | 是 | n2 `waiting_approval` + `debug_info.breakpoint=true` | ✅ |
| 断点 approval 类型 | source=workflow, type=choice | `source=workflow, type=choice, title="断点命中: n2_mpjg6o6e"` | ✅ |
| 选择 continue 后任务正常完成 | 最终 status=completed | `completed` | ✅ |
| 所有节点均 completed | 是 | n1=completed, n2=completed | ✅ |

### 已知问题

- `diag/test-breakpoint` 诊断端点将 Agent 提问（source=agent）误识别为断点命中（source=workflow），导致自动流程失败。需手动处理。

### 结论

- [x] 通过

---

## 六、验证 5：Git 快照 + 回滚

### 目的
确认 pre/post 快照被创建，且回滚能恢复文件。

### 测试记录

- 使用验证3的任务 `f263656e-55b5-434e-b163-f093e83e8e47`
- 快照API: `GET /api/tasks/{task_id}/snapshots`
- 回滚API: `POST /api/tasks/{task_id}/snapshots/{snapshot_id}/rollback`

### 快照列表

| 快照ID | 类型 | 步骤 | Git Hash |
|---|---|---|---|
| ae354af4 | pre_step | n1 | 897dd71 |
| 2e2bbd86 | post_step | n1 | ad718bf |
| 17f20b1e | pre_step | n_success | 52f1954 |
| (post_step) | post_step | n_success | ... |

### 回滚测试

回滚到 n1 pre_step (ae354af4):
- 回滚前: `.agentflow`, `.codebuddy`, `conditional-branch-test-architecture.html`
- 回滚后: `.agentflow`（`.codebuddy` 和 `.html` 文件被成功删除）
- 回滚API返回: `{"rolled_back": true}`

### 观察要点

| 观察项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| pre_step 快照存在 | 是 | 2个 pre_step 快照 | ✅ |
| post_step 快照存在 | 是 | 2个 post_step 快照 | ✅ |
| 回滚后文件被恢复 | 新增文件被删除 | `.codebuddy` 和 `.html` 被删除 | ✅ |
| 回滚API正常 | 返回 rolled_back=true | `{"rolled_back":true}` | ✅ |

### 结论

- [x] 通过

---

## 七、验证 6：Agent 提问 + Resume 完整链路

### 目的
确认 Agent 提问→用户回答→resume→继续执行的完整闭环，以及多次 resume 后无内存泄漏/卡死。

### 测试记录

- 任务ID: `39c84478-73ce-4230-ba04-7522c9f50b47`
- 工作流: refine-test (单节点 refine-requirements)
- 输入: "帮我细化一个电商系统的需求"
- 共经历3轮提问/回答/Resume

### 交互记录

| 轮次 | Agent 提问摘要 | 用户回答 | Resume 结果 |
|---|---|---|---|
| 1 | 电商系统类型？核心场景？技术约束？ | B2C多商户、商品/订单/支付、1万DAU、Java+Spring Boot | ✅ 继续执行 |
| 2 | 需求细化方案确认（角色/模块拆解） | 方案很好，请确认并完成 | ✅ 继续执行 |
| 3 | 5个待确认问题（结算/库存/营销/部署/前端） | 逐项回答 | ✅ 继续执行 |

### 最终输出

Agent 生成 `B2C电商平台需求文档.md`，包含9个章节：
1. 项目概述
2. 系统角色与权限
3. 核心模块详细需求
4. 数据库设计概要
5. 接口设计概要
6. 非功能性需求
7. 部署架构
8. 一期迭代计划
9. 风险与应对

### 观察要点

| 观察项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| Agent 提问被检测 | SSE 出现 node:question | 3次提问成功检测 | ✅ |
| 回答后 resume 成功 | 新进程启动 | 3次 resume 均成功 | ✅ |
| resume 后事件流继续 | SSE 持续输出 | 每次均正常继续 | ✅ |
| 多次 resume 无卡死 | 最终 completed | `completed`，无卡死 | ✅ |
| workspace 日志完整记录 | `.agentflow/node-execution.log` 有记录 | 8条日志记录 | ✅ |

### 结论

- [x] 通过

---

## 八、验证总结

| # | 验证内容 | 优先级 | 状态 | 备注 |
|---|---|---|---|---|
| 1 | 单节点执行 | P0 | ✅ 通过 | |
| 2 | 多节点数据传递 | 🔴 P0 | ✅ 通过 | Agent 能理解 previous_output 格式 |
| 3 | 条件边分支 | P0 | ✅ 通过 | 修复 DotDict 后通过 |
| 4 | 断点调试 | P1 | ✅ 通过 | diag 端点有误识别问题，核心功能正常 |
| 5 | Git 快照+回滚 | P1 | ✅ 通过 | |
| 6 | Agent 提问+Resume | P1 | ✅ 通过 | 3轮 Resume 无卡死 |

### 最终结论

- [x] **全部通过** → 可以进入正式开发
- [ ] **核心链路未通过** → 需要先修后端引擎，再进入正式开发
- [ ] **部分通过** → 需要针对性修复后重新验证

### 已修复问题清单

| # | 问题描述 | 影响范围 | 修复方案 | 状态 |
|---|---|---|---|---|
| 1 | `evaluate_condition` 不支持 `output.key` 属性访问语法 | 条件边功能完全失效 | 添加 `DotDict` 类包装 output_data | ✅ 已修复 |
| 2 | PowerShell `curl` 是 `Invoke-WebRequest` 别名 | 命令行测试卡死 | 使用 `curl.exe` 代替 `curl` | ✅ 已规避 |
| 3 | PowerShell JSON 转义问题 | curl POST 请求失败 | 使用文件方式 `-d @file` | ✅ 已规避 |

### 待优化项

| # | 描述 | 优先级 |
|---|---|---|
| 1 | `diag/test-breakpoint` 端点需区分 Agent 提问和断点命中 | P2 |
| 2 | 同层节点顺序执行而非并行执行 | P2 |
| 3 | Agent 执行耗时较长时缺乏进度反馈 | P3 |
