"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
  ExternalLink, CheckCircle2, XCircle, Loader2, Brain, AlertCircle,
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

// ── Animation variants ──
const customEase: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const fadeSlideUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: customEase } },
};

const cardSpring = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: "spring" as const, stiffness: 400, damping: 30 },
  },
  exit: { opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.2 } },
};

const titleFade = {
  initial: { opacity: 1, y: 0 },
  dim: { opacity: 0.3, y: -6, scale: 0.97, transition: { duration: 0.3 } },
};

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
    <div className="space-y-1">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.nodeId && (
            <div className="flex items-center gap-1.5 mt-2 mb-1 first:mt-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Node: {group.nodeId}
            </div>
          )}
          {group.logs.map((log) => (
            <div key={log.id} className={cn(
              "flex items-start gap-2 text-[12px] leading-relaxed py-0.5",
              log.event === "thinking" && "text-violet-400",
              log.event === "progress" && "text-muted-foreground",
              log.event === "question" && "text-amber",
              log.event === "approval" && "text-amber",
              log.event === "dag:node_completed" && "text-emerald-400",
              log.event === "dag:node_failed" && "text-red-400",
            )}>
              <span className="shrink-0 mt-0.5">
                {log.event === "thinking" ? <Brain className="h-3.5 w-3.5" /> :
                 log.event === "dag:node_completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                 log.event === "dag:node_failed" ? <XCircle className="h-3.5 w-3.5" /> :
                 log.event === "question" || log.event === "approval" ? <AlertCircle className="h-3.5 w-3.5" /> :
                 log.event === "dag:execution_completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> :
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

  // 审批轮询
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
        case "dag:validation_passed": content = `DAG validated, ${data.node_count} nodes`; break;
        case "dag:topo_sorted": content = "Topo sort complete, ready to execute"; break;
        case "dag:level_started": content = `Starting level ${data.level}`; break;
        case "dag:node_started": content = `Node ${data.node_id} started`; break;
        case "node:thinking": content = `${data.node_id}: ${(data.content as string)?.slice(0, 200)}`; eventLabel = "thinking"; break;
        case "node:progress": content = `${data.node_id}: ${(data.content as string)?.slice(0, 200)}`; eventLabel = "progress"; break;
        case "node:question": content = `Agent asks: ${(data.question as string)?.slice(0, 120)}`; eventLabel = "question"; break;
        case "dag:node_completed": {
          const output = data.output as Record<string, unknown> | undefined;
          const summary = output?.summary as string | undefined;
          content = `Node ${data.node_id} completed${summary ? ` \u2014 ${summary}` : ""}`; break;
        }
        case "dag:node_failed": content = `Node ${data.node_id} failed: ${data.error}`; break;
        case "dag:node_skipped": content = `Node ${data.node_id} skipped: ${data.reason}`; break;
        case "dag:level_completed": content = `Level ${data.level} completed`; break;
        case "dag:execution_completed": content = "Workflow execution complete"; setTaskCompleted(true); break;
        case "approval:created": content = `Approval required: ${data.title}`; eventLabel = "approval"; break;
        case "approval:resolved": content = `Approval resolved: ${data.status}`; break;
        default: content = JSON.stringify(data).slice(0, 100);
      }

      setExecutionLogs((prev) => [
        ...prev.slice(-49),
        { id: logId, event: eventLabel, node_id: data.node_id as string | undefined, content, timestamp: Date.now() },
      ]);
    }
  }, [sseEvents, taskId, step]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [executionLogs]);

  const handleResolveApproval = useCallback(async (approvalId: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
    setApprovalLoading(true);
    try {
      const body: ApprovalResolve = { status, result: result ?? null };
      await api.post<APIResponse<Approval>>(`/approvals/${approvalId}/resolve`, body);
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
    else setMatchResult({ mode: "bare_agent", reasoning: "Match service unavailable, will use bare Agent mode" });
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

  const showExamples = step === "input" || step === "matching";
  const showTitle = step === "input" || step === "matching";

  return (
    <div className="flex h-full flex-col">
      {/* Main area: asymmetric layout — input left, results offset */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column — input zone */}
        <div className="flex-1 flex flex-col items-start justify-center px-8 lg:px-16 xl:px-24 py-12">
          {/* Title */}
          <motion.div
            className="mb-3"
            animate={showTitle ? "initial" : "dim"}
            variants={titleFade}
          >
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">
              What do you want<br />to build today?
            </h1>
            <p className="mt-2.5 text-sm text-muted-foreground max-w-sm">
              Describe your task in natural language. I&apos;ll match the best workflow and execute it.
            </p>
          </motion.div>

          {/* Input area */}
          <div className="w-full max-w-[560px] mt-6">
            <div className="relative">
              {/* Slash command menu */}
              <AnimatePresence>
                {showSlash && step === "input" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.18 }}
                    className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-xl border border-border bg-popover p-1.5 shadow-xl shadow-black/20"
                  >
                    <div className="mb-1 flex items-center gap-1.5 px-2.5 py-1.5">
                      <Slash className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[11px] font-medium text-muted-foreground">Commands</span>
                    </div>
                    {SLASH_COMMANDS.map((cmd) => (
                      <button key={cmd.cmd}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover transition-colors"
                        onClick={() => { setInput(cmd.cmd + " "); setShowSlash(false); textareaRef.current?.focus(); }}>
                        <span className="font-mono text-[13px] font-semibold text-brand">{cmd.cmd}</span>
                        <span className="text-[12px] text-muted-foreground">{cmd.desc}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input box */}
              <div className={cn(
                "chat-input-box flex items-end gap-2 rounded-2xl border bg-card/80 backdrop-blur-sm p-3 transition-all duration-300",
                focused && step === "input" ? "border-brand/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-brand)_30%,transparent)]" : "border-border/60",
                !showExamples && "opacity-60"
              )}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => handleInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="Describe your task... type / for commands"
                  rows={1}
                  disabled={isLoading}
                  className="max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 disabled:opacity-70"
                  style={{ height: "auto" }}
                  onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }}
                />
                {/* Send button */}
                <motion.button
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                    input.trim() && step === "input"
                      ? "bg-brand text-brand-foreground hover:bg-brand/90"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                  disabled={!input.trim() || step !== "input"}
                  onClick={() => { if (input.trim() && step === "input") handleSubmit(input.trim()); }}
                  whileTap={{ scale: 0.93 }}
                  transition={{ type: "spring", stiffness: 600, damping: 25 }}
                >
                  {isLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </motion.button>
              </div>

              {/* Status hint */}
              <motion.div
                className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                {step === "matching" && <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Matching workflows...</span>}
                {step === "creating" && <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Creating task...</span>}
                {step === "input" && (
                  <>
                    <span>Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">/</kbd> for commands</span>
                    <span>Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send</span>
                  </>
                )}
                {step === "result" && <span>Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd> to cancel</span>}
              </motion.div>
            </div>
          </div>

          {/* Quick examples */}
          <AnimatePresence>
            {showExamples && (
              <motion.div
                className="mt-8 grid w-full max-w-[560px] grid-cols-2 gap-2.5 sm:grid-cols-4"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
              >
                {QUICK_EXAMPLES.map((ex) => {
                  const Icon = ex.icon;
                  return (
                    <motion.button
                      key={ex.text}
                      variants={fadeSlideUp}
                      className="group flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card/50 px-3.5 py-3 text-left transition-colors hover:border-brand/30 hover:bg-surface-hover"
                      onClick={() => handleExampleClick(ex.text)}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      <Icon className={cn("h-4 w-4", ex.color)} />
                      <span className="text-[13px] leading-snug text-foreground font-medium">{ex.text}</span>
                      <span className="text-[11px] text-muted-foreground">{ex.hint}</span>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right column — results panel */}
        <div className="w-[460px] xl:w-[520px] shrink-0 flex flex-col justify-center px-4 py-12 overflow-y-auto border-l border-border/40 bg-surface/30">
          <AnimatePresence mode="wait">
            {/* Match result */}
            {step === "result" && matchResult && (
              <motion.div key="match-result" variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                <MatchResultCard result={matchResult} onConfirm={handleConfirm} onCancel={handleCancelMatch} loading={taskLoading} />
              </motion.div>
            )}

            {/* Execution panel */}
            {step === "executing" && taskId && (
              <motion.div key="exec-panel" variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-lg">
                  {/* Header */}
                  <div className="px-5 py-3.5 border-b border-border bg-surface-hover/30 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {taskCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Loader2 className="h-4 w-4 text-brand animate-spin" />
                        )}
                        <span className="text-sm font-medium text-foreground">
                          {taskCompleted ? "Execution complete" : "Executing..."}
                        </span>
                      </div>
                      <button
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
                        onClick={() => router.push(`/tasks/${taskId}`)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />Details
                      </button>
                    </div>
                    {matchResult && (
                      <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
                        matchResult.mode === "matched" ? "bg-brand/5 border border-brand/15" :
                        matchResult.mode === "dynamic_assembly" ? "bg-violet/5 border border-violet/15" : "bg-amber/5 border border-amber/15")}>
                        <span className={cn("font-medium", matchResult.mode === "matched" ? "text-brand" : matchResult.mode === "dynamic_assembly" ? "text-violet" : "text-amber")}>
                          {matchResult.mode === "matched" ? `Workflow: ${matchResult.workflow_name || "-"}` : matchResult.mode === "dynamic_assembly" ? "Dynamic Assembly" : "Bare Agent"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Pending approvals */}
                  {pendingApprovals.length > 0 && (
                    <div className="px-4 py-3 border-b border-amber/20 bg-amber-muted/20 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-amber">
                        <AlertCircle className="h-3.5 w-3.5" />Response needed ({pendingApprovals.length})
                      </div>
                      {pendingApprovals.map(a => (
                        <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />
                      ))}
                    </div>
                  )}

                  {/* Log entries */}
                  <div className="max-h-[260px] overflow-y-auto px-5 py-3">
                    {executionLogs.length === 0 && (
                      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />Waiting for events...
                      </div>
                    )}
                    {renderExecutionGroups(executionLogs)}
                    <div ref={logsEndRef} />
                  </div>

                  {/* Footer */}
                  {taskCompleted && (
                    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-hover/20">
                      <button className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                        onClick={handleCancelMatch}>New Task</button>
                      <button className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 transition-colors"
                        onClick={() => router.push(`/tasks/${taskId}`)}>
                        <ExternalLink className="h-3.5 w-3.5" />View Details
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Describe results */}
            {step === "describing_node" && describeNodeResult && (
              <motion.div key="desc-node" variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                <DescribeNodeResult result={describeNodeResult}
                  onConfirm={async (skillMd, overrides) => { const node = await confirmNode(skillMd, overrides); if (node) { setStep("input"); setDescribeNodeResult(null); setInput(""); } }}
                  onCancel={handleCancelMatch} loading={describeLoading} />
              </motion.div>
            )}
            {step === "describing_workflow" && describeWorkflowResult && (
              <motion.div key="desc-wf" variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                <DescribeWorkflowResult result={describeWorkflowResult}
                  onConfirm={async (name, dag) => { const wf = await confirmWorkflow(name, { description: describeWorkflowResult.description ?? undefined, category: describeWorkflowResult.category ?? undefined, dag: dag as unknown as Record<string, unknown> }); if (wf) router.push(`/workflows/${wf.id}`); }}
                  onCancel={handleCancelMatch} loading={describeLoading} />
              </motion.div>
            )}

            {/* Empty state */}
            {step === "input" && (
              <motion.div
                key="empty-hint"
                className="flex flex-col items-center justify-center py-16 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-border/60 mb-4">
                  <Zap className="h-6 w-6 text-brand/60" />
                </div>
                <p className="text-sm text-muted-foreground">Results will appear here</p>
                <p className="text-[12px] text-muted-foreground/60 mt-1">Describe your task on the left</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-1.5 pb-3 text-[11px] text-muted-foreground/30 border-t border-border/30 pt-2.5">
        <Zap className="h-3 w-3" /><span>Nexus Workbench</span>
      </div>
    </div>
  );
}
