"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useMatch } from "@/hooks/useMatch";
import { useTaskCreate } from "@/hooks/useTask";
import { useDescribe } from "@/hooks/useDescribe";
import { useSSE } from "@/hooks/useSSE";
import MatchResultCard from "@/components/chat/MatchResult";
import ApprovalCard from "@/components/approval/ApprovalCard";
import { DescribeNodeResult, DescribeWorkflowResult } from "@/components/chat/DescribeResult";
import {
  Bug, Sparkles, BookOpen, RefreshCw, ArrowRight, Zap, Slash,
  ExternalLink, CheckCircle2, XCircle, Loader2, Brain, AlertCircle, Clock,
} from "lucide-react";
import type {
  MatchResult, TaskCreate, DescribeNodeResponse, DescribeWorkflowResponse,
  SSEEvent, Approval, APIResponse, ApprovalResolve,
} from "@/lib/types";

const QUICK_EXAMPLES = [
  { icon: Bug, text: "修复登录页白屏问题", hint: "Bug修复流程", color: "text-red-400" },
  { icon: Sparkles, text: "新增用户注册功能", hint: "需求开发流程", color: "text-brand" },
  { icon: BookOpen, text: "生成接口文档", hint: "文档生成流程", color: "text-emerald-400" },
  { icon: RefreshCw, text: "重构数据库连接层", hint: "裸Agent执行", color: "text-amber" },
];

const SLASH_COMMANDS = [
  { cmd: "/node", desc: "用自然语言创建节点" },
  { cmd: "/workflow", desc: "用自然语言创建工作流" },
  { cmd: "/rollback", desc: "回滚到指定步骤" },
  { cmd: "/debug", desc: "给下个节点设断点" },
  { cmd: "/cancel", desc: "取消当前任务" },
];

type ChatStep = "input" | "matching" | "result" | "creating" | "executing" | "describing_node" | "describing_workflow";

interface ExecutionLog {
  id: number;
  event: string;
  node_id?: string;
  content: string;
  timestamp: number;
}

function renderExecutionGroups(logs: ExecutionLog[]) {
  const groups: { nodeId?: string; logs: typeof logs }[] = [];
  let currentGroup: { nodeId?: string; logs: typeof logs } | null = null;

  for (const log of logs) {
    const isNodeEvent = ["dag:node_started", "dag:node_completed", "dag:node_failed", "thinking", "progress", "question"].includes(log.event);
    const isGlobalEvent = ["dag:validation_passed", "dag:topo_sorted", "dag:level_started", "dag:level_completed", "dag:execution_completed"].includes(log.event);

    if (log.event === "dag:node_started") {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { nodeId: log.node_id, logs: [log] };
    } else if (isNodeEvent && currentGroup && (log.node_id === currentGroup.nodeId || !log.node_id)) {
      currentGroup.logs.push(log);
    } else if (isNodeEvent) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { nodeId: log.node_id, logs: [log] };
    } else if (isGlobalEvent) {
      if (currentGroup) { groups.push(currentGroup); currentGroup = null; }
      groups.push({ logs: [log] });
    } else {
      if (currentGroup) currentGroup.logs.push(log);
      else groups.push({ logs: [log] });
    }
  }
  if (currentGroup) groups.push(currentGroup);

  return (
    <div className="space-y-1.5">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.nodeId && (
            <div className="flex items-center gap-1.5 mt-2 mb-1 first:mt-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              节点: {group.nodeId}
            </div>
          )}
          {group.logs.map((log) => (
            <div key={log.id} className={cn(
              "flex items-start gap-2 text-[12px] leading-relaxed py-0.5",
              log.event === "thinking" && "text-violet-400",
              log.event === "progress" && "text-muted-foreground",
              log.event === "question" && "text-amber",
              log.event === "approval" && "text-amber",
              log.event === "dag:node_completed" && "text-emerald-500",
              log.event === "dag:node_failed" && "text-red-400",
            )}>
              <span className="shrink-0 mt-0.5">
                {log.event === "thinking" ? <Brain className="h-3.5 w-3.5" /> :
                 log.event === "dag:node_completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                 log.event === "dag:node_failed" ? <XCircle className="h-3.5 w-3.5" /> :
                 log.event === "question" || log.event === "approval" ? <AlertCircle className="h-3.5 w-3.5" /> :
                 log.event === "dag:execution_completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> :
                 log.event === "dag:level_started" || log.event === "dag:level_completed" ?
                   <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-brand/40" /> :
                   <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" />
                }
              </span>
              <div className="min-w-0">
                {log.node_id && group.nodeId === undefined && (
                  <span className="text-[10px] text-muted-foreground mr-2">{log.node_id}</span>
                )}
                <span className="break-all">{log.content}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [focused, setFocused] = useState(false);
  const [step, setStep] = useState<ChatStep>("input");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [describeNodeResult, setDescribeNodeResult] = useState<DescribeNodeResponse | null>(null);
  const [describeWorkflowResult, setDescribeWorkflowResult] = useState<DescribeWorkflowResponse | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const logIdRef = useRef(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { match: doMatch, loading: matchLoading } = useMatch();
  const { createAndStart, loading: taskLoading } = useTaskCreate();
  const { describeNode, confirmNode, describeWorkflow, confirmWorkflow, loading: describeLoading } = useDescribe();

  const { events: sseEvents } = useSSE(
    taskId ? "/api/events/stream" : null,
    { taskId: taskId ?? undefined }
  );

  // 审批轮询：executing 状态下每 3s 拉取一次 pending approvals
  useEffect(() => {
    if (!taskId || step !== "executing") return;
    let active = true;
    const fetchApprovals = async () => {
      try {
        const res = await api.get<APIResponse<Approval[]>>(`/approvals?task_id=${taskId}`);
        if (active && res.data) {
          setPendingApprovals(res.data.filter(a => a.status === "pending"));
        }
      } catch {}
    };
    fetchApprovals();
    const timer = setInterval(fetchApprovals, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [taskId, step]);

  // SSE 事件处理
  useEffect(() => {
    if (!taskId || step !== "executing") return;
    for (const evt of sseEvents) {
      const logId = ++logIdRef.current;
      const data = evt.data || {};
      let content = "";
      let eventLabel = evt.event;

      switch (evt.event) {
        case "dag:validation_passed": content = `DAG 校验通过，共 ${data.node_count} 个节点`; break;
        case "dag:topo_sorted": content = "拓扑排序完成，准备执行"; break;
        case "dag:level_started": content = `开始执行第 ${data.level} 层`; break;
        case "dag:node_started": content = `节点 ${data.node_id} 开始执行`; break;
        case "node:thinking": content = `${data.node_id}: ${(data.content as string)?.slice(0, 200)}`; eventLabel = "thinking"; break;
        case "node:progress": content = `${data.node_id}: ${(data.content as string)?.slice(0, 200)}`; eventLabel = "progress"; break;
        case "node:question": content = `Agent 提问: ${(data.question as string)?.slice(0, 120)}`; eventLabel = "question"; break;
        case "dag:node_completed": {
          const output = data.output as Record<string, unknown> | undefined;
          const summary = output?.summary as string | undefined;
          content = `节点 ${data.node_id} 完成${summary ? ` — ${summary}` : ""}`; break;
        }
        case "dag:node_failed": content = `节点 ${data.node_id} 失败: ${data.error}`; break;
        case "dag:node_skipped": content = `节点 ${data.node_id} 跳过: ${data.reason}`; break;
        case "dag:level_completed": content = `第 ${data.level} 层执行完成`; break;
        case "dag:execution_completed": content = "工作流执行完成"; setTaskCompleted(true); break;
        case "approval:created": content = `需要审批: ${data.title}`; eventLabel = "approval"; break;
        case "approval:resolved": content = `审批已处理: ${data.status}`; break;
        default: content = JSON.stringify(data).slice(0, 100);
      }

      setExecutionLogs((prev) => [
        ...prev.slice(-49),
        { id: logId, event: eventLabel, node_id: data.node_id as string | undefined, content, timestamp: Date.now() },
      ]);
    }
  }, [sseEvents, taskId, step]);

  // 自动滚动
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [executionLogs]);

  // 审批解决
  const handleResolveApproval = useCallback(async (approvalId: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
    setApprovalLoading(true);
    try {
      const body: ApprovalResolve = { status, result: result ?? null };
      await api.post<APIResponse<Approval>>(`/approvals/${approvalId}/resolve`, body);
      // 从本地列表移除
      setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
    } catch {} finally {
      setApprovalLoading(false);
    }
  }, []);

  const handleInput = useCallback((value: string) => {
    setInput(value);
    setShowSlash(value.startsWith("/") && value.length < 20);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && step === "input") handleSubmit(input.trim());
    }
    if (e.key === "Escape") {
      if (step === "result") handleCancelMatch();
      setShowSlash(false);
    }
  }, [input, step]);

  const handleSubmit = useCallback(async (text: string) => {
    setShowSlash(false);
    if (text.startsWith("/node ")) {
      const desc = text.slice(6).trim();
      if (!desc) return;
      setInput(text);
      setStep("describing_node");
      const result = await describeNode(desc);
      if (result) setDescribeNodeResult(result);
      else setStep("input");
      return;
    }
    if (text.startsWith("/workflow ")) {
      const desc = text.slice(10).trim();
      if (!desc) return;
      setInput(text);
      setStep("describing_workflow");
      const result = await describeWorkflow(desc);
      if (result) setDescribeWorkflowResult(result);
      else setStep("input");
      return;
    }
    setStep("matching");
    setInput(text);
    const result = await doMatch(text);
    if (result) setMatchResult(result);
    else setMatchResult({ mode: "bare_agent", reasoning: "匹配服务暂不可用，将使用裸 Agent 模式" });
    setStep("result");
  }, [doMatch, describeNode, describeWorkflow]);

  const handleConfirm = useCallback(async () => {
    if (!matchResult) return;
    setStep("creating");
    const taskData: TaskCreate = { title: input.trim(), input_data: { user_input: input.trim() } };
    if (matchResult.mode === "matched") taskData.workflow_id = matchResult.workflow_id ?? null;
    else if (matchResult.mode === "dynamic_assembly") { taskData.execution_mode = "dynamic_assembly"; taskData.dag = matchResult.dag ?? null; }
    const task = await createAndStart(taskData);
    if (task) {
      setTaskId(task.id);
      setTaskCompleted(false);
      setExecutionLogs([]);
      setPendingApprovals([]);
      logIdRef.current = 0;
      setStep("executing");
    } else setStep("result");
  }, [matchResult, input, createAndStart]);

  const handleCancelMatch = useCallback(() => {
    setStep("input"); setMatchResult(null);
    setDescribeNodeResult(null); setDescribeWorkflowResult(null);
    setTaskId(null); setExecutionLogs([]); setTaskCompleted(false);
    setPendingApprovals([]);
  }, []);

  const handleExampleClick = useCallback((text: string) => {
    setStep("input"); setMatchResult(null); setDescribeNodeResult(null);
    setDescribeWorkflowResult(null); setTaskId(null); setExecutionLogs([]);
    setTaskCompleted(false); setPendingApprovals([]);
    setInput(text);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
      }
    });
  }, []);

  const isLoading = step === "matching" || step === "creating" || step === "executing" || describeLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        {/* Title */}
        <div className={cn("mb-2 text-center transition-all", step !== "input" && "opacity-60 scale-95")}>
          <h1 className="text-2xl font-semibold text-foreground">What do you want to do?</h1>
          <p className="mt-2 text-sm text-muted-foreground">描述你的任务，我会匹配最佳工作流并执行</p>
        </div>

        {/* Input */}
        <div className="mt-8 w-full max-w-[640px]">
          <div className="relative">
            {showSlash && step === "input" && (
              <div className="animate-scale-in absolute bottom-full left-0 z-10 mb-2 w-72 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                <div className="mb-1 flex items-center gap-1.5 px-2.5 py-1.5">
                  <Slash className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground">命令</span>
                </div>
                {SLASH_COMMANDS.map((cmd) => (
                  <button key={cmd.cmd} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover transition-colors"
                    onClick={() => { setInput(cmd.cmd + " "); setShowSlash(false); textareaRef.current?.focus(); }}>
                    <span className="font-mono text-[13px] font-semibold text-brand">{cmd.cmd}</span>
                    <span className="text-[12px] text-muted-foreground">{cmd.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <div className={cn(
              "chat-input-box flex items-end gap-2 rounded-2xl border bg-card p-3 transition-shadow transition-colors",
              focused && step === "input" ? "border-brand shadow-md shadow-brand/20" : "border-border shadow-sm",
              step !== "input" && "opacity-60"
            )}>
              <textarea ref={textareaRef} value={input} onChange={(e) => handleInput(e.target.value)}
                onKeyDown={handleKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                placeholder="描述你的任务...  输入 / 查看命令" rows={1} disabled={isLoading}
                className="max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 disabled:opacity-70"
                style={{ height: "auto" }}
                onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }}
              />
              <button className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all",
                input.trim() && step === "input" ? "bg-brand text-brand-foreground shadow-md hover:opacity-90 active:scale-95" : "bg-muted text-muted-foreground cursor-not-allowed"
              )} disabled={!input.trim() || step !== "input"}
                onClick={() => { if (input.trim() && step === "input") handleSubmit(input.trim()); }}>
                {isLoading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2.5 flex items-center justify-center gap-3 text-[11px] text-muted-foreground/60">
              {step === "matching" && <span>正在匹配工作流...</span>}
              {step === "creating" && <span>正在创建任务...</span>}
              {step === "input" && <><span>输入 <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">/</kbd> 查看命令</span>
                <span>按 <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd> 发送</span></>}
              {step === "result" && <span>按 <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd> 取消</span>}
            </div>
          </div>
        </div>

        {/* Match result */}
        {step === "result" && matchResult && (
          <div className="animate-slide-up mt-6 flex justify-center w-full">
            <MatchResultCard result={matchResult} onConfirm={handleConfirm} onCancel={handleCancelMatch} loading={taskLoading} />
          </div>
        )}

        {/* Execution panel */}
        {step === "executing" && taskId && (
          <div className="animate-slide-up mt-6 w-full max-w-[640px]">
            <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3 border-b border-border bg-surface-hover/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {taskCompleted ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Loader2 className="h-4 w-4 text-brand animate-spin" />}
                    <span className="text-sm font-medium text-foreground">{taskCompleted ? "执行完成" : "正在执行..."}</span>
                  </div>
                  <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
                    onClick={() => router.push(`/tasks/${taskId}`)}>
                    <ExternalLink className="h-3.5 w-3.5" />查看详情
                  </button>
                </div>
                {matchResult && (
                  <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
                    matchResult.mode === "matched" ? "bg-brand/5 border border-brand/15" :
                    matchResult.mode === "dynamic_assembly" ? "bg-violet/5 border border-violet/15" : "bg-amber/5 border border-amber/15")}>
                    <span className={cn("font-medium", matchResult.mode === "matched" ? "text-brand" : matchResult.mode === "dynamic_assembly" ? "text-violet" : "text-amber")}>
                      {matchResult.mode === "matched" ? `工作流: ${matchResult.workflow_name || "-"}` : matchResult.mode === "dynamic_assembly" ? "动态组装" : "裸 Agent"}
                    </span>
                  </div>
                )}
              </div>

              {/* Pending approvals — 可直接回复 */}
              {pendingApprovals.length > 0 && (
                <div className="px-4 py-3 border-b border-amber/20 bg-amber-muted/30 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber">
                    <AlertCircle className="h-3.5 w-3.5" /> 需要你的回复（{pendingApprovals.length}）
                  </div>
                  {pendingApprovals.map(a => (
                    <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />
                  ))}
                </div>
              )}

              {/* Log entries */}
              <div className="max-h-[280px] overflow-y-auto px-5 py-3">
                {executionLogs.length === 0 && (
                  <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />等待执行事件...
                  </div>
                )}
                {renderExecutionGroups(executionLogs)}
                <div ref={logsEndRef} />
              </div>

              {/* Footer */}
              {taskCompleted && (
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-hover/30">
                  <button className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                    onClick={handleCancelMatch}>新建任务</button>
                  <button className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
                    onClick={() => router.push(`/tasks/${taskId}`)}><ExternalLink className="h-3.5 w-3.5" />查看详情</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Describe results */}
        {step === "describing_node" && describeNodeResult && (
          <div className="animate-slide-up mt-6 flex justify-center w-full max-w-[640px]">
            <DescribeNodeResult result={describeNodeResult}
              onConfirm={async (skillMd, overrides) => { const node = await confirmNode(skillMd, overrides); if (node) { setStep("input"); setDescribeNodeResult(null); setInput(""); } }}
              onCancel={handleCancelMatch} loading={describeLoading} />
          </div>
        )}
        {step === "describing_workflow" && describeWorkflowResult && (
          <div className="animate-slide-up mt-6 flex justify-center w-full max-w-[640px]">
            <DescribeWorkflowResult result={describeWorkflowResult}
              onConfirm={async (name, dag) => { const wf = await confirmWorkflow(name, { description: describeWorkflowResult.description ?? undefined, category: describeWorkflowResult.category ?? undefined, dag: dag as unknown as Record<string, unknown> }); if (wf) router.push(`/workflows/${wf.id}`); }}
              onCancel={handleCancelMatch} loading={describeLoading} />
          </div>
        )}

        {/* Quick examples */}
        <div className={cn("mt-8 grid w-full max-w-[640px] grid-cols-2 gap-3 sm:grid-cols-4 transition-all",
          step !== "input" ? "opacity-40 scale-95 pointer-events-none" : "animate-slide-up")}
          style={step === "input" ? { animationDelay: "0.1s" } : undefined}>
          {QUICK_EXAMPLES.map((ex) => {
            const Icon = ex.icon;
            return (
              <button key={ex.text}
                className="group flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:border-brand/40 hover:bg-surface-hover hover:shadow-sm active:scale-[0.98]"
                onClick={() => handleExampleClick(ex.text)}>
                <Icon className={cn("h-4 w-4", ex.color)} />
                <span className="text-[13px] leading-snug text-foreground group-hover:text-brand transition-colors">{ex.text}</span>
                <span className="text-[11px] text-muted-foreground">{ex.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5 pb-4 text-[11px] text-muted-foreground/40">
        <Zap className="h-3 w-3" /><span>Powered by AgentFlow</span>
      </div>
    </div>
  );
}
