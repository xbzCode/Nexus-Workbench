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
import SceneCategories from "@/components/chat/SceneCategories";
import TaskQueue from "@/components/chat/TaskQueue";
import { TeamSelector } from "@/components/team/TeamSelector";
import { DescribeNodeResult, DescribeWorkflowResult } from "@/components/chat/DescribeResult";
import {
  ArrowRight, Zap, Slash, ExternalLink, CheckCircle2, XCircle,
  Loader2, Brain, AlertCircle, PauseCircle,
} from "lucide-react";
import type {
  MatchResult, TaskCreate, DescribeNodeResponse, DescribeWorkflowResponse,
  Approval, APIResponse, ApprovalResolve,
} from "@/lib/types";
import type { TaskQueueItem, ExecutionLog } from "@/types/task-queue";

// ── Slash commands ──
const SLASH_COMMANDS = [
  { cmd: "/node", desc: "用自然语言创建节点" },
  { cmd: "/workflow", desc: "用自然语言创建工作流" },
  { cmd: "/rollback", desc: "回滚到指定步骤" },
  { cmd: "/debug", desc: "给下个节点设断点" },
  { cmd: "/cancel", desc: "取消当前任务" },
];

// ── Animation variants ──
const customEase: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

const cardSpring = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: "spring" as const, stiffness: 400, damping: 30 },
  },
  exit: { opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.2 } },
};

const titleFade = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] as const } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.2 } },
};

const panelSlideIn = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.22, 0.61, 0.36, 1] } },
  exit: { opacity: 0, x: 10, transition: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] } },
};

// ── Execution log grouping ──
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

// ── Execution state per task ──
interface ExecState {
  logs: ExecutionLog[];
  completed: boolean;
  approvals: Approval[];
}

// ══════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════

export default function ChatPage() {
  const router = useRouter();

  // ── Core state ──
  const [tasks, setTasks] = useState<TaskQueueItem[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [input, setInput] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // ── Describe states (/node, /workflow commands) ──
  const [describeNodeResult, setDescribeNodeResult] = useState<DescribeNodeResponse | null>(null);
  const [describeWorkflowResult, setDescribeWorkflowResult] = useState<DescribeWorkflowResponse | null>(null);

  // ── Execution state per task (keyed by client-side task.id) ──
  const [executionMap, setExecutionMap] = useState<Record<string, ExecState>>({});
  const [approvalLoading, setApprovalLoading] = useState(false);

  // ── Refs ──
  const logIdRef = useRef(0);
  const lastProcessedSSEIdx = useRef(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Hooks ──
  const { match: doMatch } = useMatch();
  const { createAndStart } = useTaskCreate();
  const { describeNode, confirmNode, describeWorkflow, confirmWorkflow, loading: describeLoading } = useDescribe();

  // ── Derived ──
  const activeTask = tasks.find(t => t.id === activeTaskId);
  const activeExec = activeTask ? executionMap[activeTask.id] : undefined;

  // Show right panel when there's an active task with content to display
  const showRightPanel = !!(
    (activeTask && activeTask.status !== "matching") ||
    describeNodeResult ||
    describeWorkflowResult
  );

  // Show title prominently when there are no tasks
  const showTitleProminently = tasks.length === 0 && !describeNodeResult && !describeWorkflowResult;

  // ── SSE for active executing task ──
  const sseTaskId = activeTask?.status === "executing" ? activeTask.taskId : undefined;
  const { events: sseEvents } = useSSE(
    sseTaskId ? "/api/events/stream" : null,
    { taskId: sseTaskId }
  );

  // Reset SSE processing index when the SSE connection changes (different task)
  useEffect(() => {
    lastProcessedSSEIdx.current = 0;
  }, [sseTaskId]);

  // ── Helpers to update tasks ──
  const updateTask = useCallback((id: string, patch: Partial<TaskQueueItem>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const updateExecState = useCallback((id: string, patch: Partial<ExecState>) => {
    setExecutionMap(prev => ({
      ...prev,
      [id]: { ...(prev[id] || { logs: [], completed: false, approvals: [] }), ...patch },
    }));
  }, []);

  // ── Approval polling for active executing task ──
  useEffect(() => {
    if (!activeTask?.taskId || activeTask.status !== "executing") return;
    let active = true;
    const fetchApprovals = async () => {
      try {
        const res = await api.get<APIResponse<Approval[]>>(`/approvals?task_id=${activeTask.taskId}`);
        if (active && res.data) {
          const pendingApprovals = res.data.filter(a => a.status === "pending");
          const hasPaused = res.data.some(a => a.status === "paused");
          updateExecState(activeTask.id, { approvals: pendingApprovals });
          // If any approval is paused (timed out), mark task as paused
          if (hasPaused) {
            updateTask(activeTask.id, { status: "paused" });
          }
        }
      } catch { /* ignore */ }
    };
    fetchApprovals();
    const timer = setInterval(fetchApprovals, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [activeTask?.taskId, activeTask?.status, activeTask?.id, updateExecState, updateTask]);

  // ── SSE event processing — only process NEW events ──
  useEffect(() => {
    if (!activeTask || activeTask.status !== "executing") return;
    const startIdx = lastProcessedSSEIdx.current;
    const newEvents = sseEvents.slice(startIdx);

    for (const evt of newEvents) {
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
          content = `Node ${data.node_id} completed${summary ? ` — ${summary}` : ""}`; break;
        }
        case "dag:node_failed": content = `Node ${data.node_id} failed: ${data.error}`; break;
        case "dag:node_skipped": content = `Node ${data.node_id} skipped: ${data.reason}`; break;
        case "dag:level_completed": content = `Level ${data.level} completed`; break;
        case "dag:execution_completed":
          content = "Workflow execution complete";
          updateTask(activeTask.id, { status: "completed" });
          updateExecState(activeTask.id, { completed: true });
          break;
        case "approval:created": content = `Approval required: ${data.title}`; eventLabel = "approval"; break;
        case "approval:resolved": content = `Approval resolved: ${data.status}`; break;
        default: content = JSON.stringify(data).slice(0, 100);
      }

      setExecutionMap(prev => {
        const state = prev[activeTask.id] || { logs: [], completed: false, approvals: [] };
        return {
          ...prev,
          [activeTask.id]: {
            ...state,
            logs: [
              ...state.logs.slice(-49),
              { id: logId, event: eventLabel, node_id: data.node_id as string | undefined, content, timestamp: Date.now() },
            ],
          },
        };
      });
    }

    lastProcessedSSEIdx.current = sseEvents.length;
  }, [sseEvents, activeTask, updateTask, updateExecState]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeExec?.logs]);

  // ── Handlers ──

  const handleResolveApproval = useCallback(async (approvalId: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
    setApprovalLoading(true);
    try {
      const body: ApprovalResolve = { status, result: result ?? null };
      await api.post<APIResponse<Approval>>(`/approvals/${approvalId}/resolve`, body);
      if (activeTask) {
        updateExecState(activeTask.id, {
          approvals: (activeExec?.approvals ?? []).filter(a => a.id !== approvalId),
        });
      }
    } catch { /* ignore */ } finally {
      setApprovalLoading(false);
    }
  }, [activeTask, activeExec, updateExecState]);

  const handleInput = useCallback((value: string) => {
    setInput(value);
    setShowSlash(value.startsWith("/") && value.length < 20);
  }, []);

  /** Submit a new task — always creates a queue entry and immediately re-enables input */
  const handleSubmit = useCallback(async (text: string) => {
    setShowSlash(false);

    // Handle /node and /workflow commands (separate from task queue)
    if (text.startsWith("/node ")) {
      const desc = text.slice(6).trim();
      if (!desc) return;
      const result = await describeNode(desc);
      if (result) setDescribeNodeResult(result);
      setInput("");
      return;
    }
    if (text.startsWith("/workflow ")) {
      const desc = text.slice(10).trim();
      if (!desc) return;
      const result = await describeWorkflow(desc);
      if (result) setDescribeWorkflowResult(result);
      setInput("");
      return;
    }

    // Create new task queue item
    const newTask: TaskQueueItem = {
      id: crypto.randomUUID(),
      userQuery: text,
      status: "matching",
      createdAt: Date.now(),
      teamId: selectedTeamId,
    };

    setTasks(prev => [...prev, newTask]);
    setActiveTaskId(newTask.id);
    setInput("");

    // Reset textarea height
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });

    // Call match API
    const result = await doMatch(text, selectedTeamId);
    if (result) {
      updateTask(newTask.id, { status: "matched", matchResult: result });
    } else {
      updateTask(newTask.id, {
        status: "matched",
        matchResult: { mode: "bare_agent", reasoning: "Match service unavailable, will use bare Agent mode" },
      });
    }
  }, [doMatch, describeNode, describeWorkflow, updateTask]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) handleSubmit(input.trim());
    }
    if (e.key === "Escape") {
      setShowSlash(false);
    }
  }, [input, handleSubmit]);

  /** Confirm a matched task — create and start */
  const handleConfirm = useCallback(async (queueId: string) => {
    const task = tasks.find(t => t.id === queueId);
    if (!task?.matchResult) return;

    updateTask(queueId, { status: "confirming" });

    const taskData: TaskCreate = {
      title: task.userQuery,
      input_data: { user_input: task.userQuery },
    };
    // Pass team_id from match result or user selection
    if (task.matchResult.team_id) taskData.team_id = task.matchResult.team_id;
    else if (task.teamId) taskData.team_id = task.teamId;
    if (task.matchResult.mode === "matched") taskData.workflow_id = task.matchResult.workflow_id ?? null;
    else if (task.matchResult.mode === "dynamic_assembly") {
      taskData.execution_mode = "dynamic_assembly";
      taskData.dag = task.matchResult.dag ?? null;
    }

    const created = await createAndStart(taskData);
    if (created) {
      updateTask(queueId, { status: "executing", taskId: created.id });
      setExecutionMap(prev => ({
        ...prev,
        [queueId]: { logs: [], completed: false, approvals: [] },
      }));
      logIdRef.current = 0;
    } else {
      updateTask(queueId, { status: "failed", error: "创建任务失败" });
    }
  }, [tasks, createAndStart, updateTask]);

  /** Retry a task — re-run match */
  const handleRetry = useCallback(async (queueId: string) => {
    const task = tasks.find(t => t.id === queueId);
    if (!task) return;

    updateTask(queueId, { status: "matching", matchResult: undefined, error: undefined });
    setActiveTaskId(queueId);

    const result = await doMatch(task.userQuery, task.teamId);
    if (result) {
      updateTask(queueId, { status: "matched", matchResult: result });
    } else {
      updateTask(queueId, {
        status: "failed",
        error: "匹配服务不可用",
      });
    }
  }, [tasks, doMatch, updateTask]);

  /** Remove a task from the queue — auto-select nearest task */
  const handleRemove = useCallback((queueId: string) => {
    setTasks(prev => {
      const next = prev.filter(t => t.id !== queueId);
      // Auto-select nearest task if removing the active one
      if (activeTaskId === queueId && next.length > 0) {
        const removedIdx = prev.findIndex(t => t.id === queueId);
        const newActive = next[Math.min(removedIdx, next.length - 1)];
        setActiveTaskId(newActive.id);
      } else if (activeTaskId === queueId) {
        setActiveTaskId(undefined);
      }
      return next;
    });
    setExecutionMap(prev => {
      const next = { ...prev };
      delete next[queueId];
      return next;
    });
  }, [activeTaskId]);

  /** Cancel a describe operation */
  const handleCancelDescribe = useCallback(() => {
    setDescribeNodeResult(null);
    setDescribeWorkflowResult(null);
  }, []);

  /** Scene category selected — fill input */
  const handleCategorySelect = useCallback((prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
        textareaRef.current.focus();
      }
    });
  }, []);

  /** Select a task in the queue */
  const handleSelectTask = useCallback((id: string) => {
    setActiveTaskId(id);
    setDescribeNodeResult(null);
    setDescribeWorkflowResult(null);
  }, []);

  // ── Loading states ──
  const isConfirming = activeTask?.status === "confirming";

  // ══════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left column ── */}
        <div className={cn(
          "flex flex-col px-8 lg:px-16 xl:px-24 py-12 transition-all duration-500",
          showRightPanel ? "flex-1" : "w-full",
          showTitleProminently ? "items-center justify-center" : "items-start justify-start"
        )}>
          {/* Title — only when empty */}
          {showTitleProminently && (
            <motion.div
              className="text-center mb-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">
                What do you want<br />to build today?
              </h1>
              <p className="mt-2.5 text-sm text-muted-foreground max-w-sm">
                Describe your task in natural language. I&apos;ll find the best way to get it done.
              </p>
            </motion.div>
          )}

          {/* Input area — always available */}
          <div className="w-full max-w-[560px] mt-6">
            <div className="relative">
              {/* Slash command menu */}
              <AnimatePresence>
                {showSlash && (
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

              {/* Team selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Team:</span>
                <TeamSelector value={selectedTeamId} onChange={setSelectedTeamId} />
              </div>

              {/* Input box */}
              <div className={cn(
                "chat-input-box flex items-end gap-2 rounded-2xl border bg-card/80 backdrop-blur-sm p-3 transition-all duration-300",
                focused ? "border-brand/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-brand)_30%,transparent)]" : "border-border/60"
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
                  className="max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0"
                  style={{ height: "auto" }}
                  onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }}
                />
                {/* Send button — always clickable when there's input */}
                <motion.button
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                    input.trim()
                      ? "bg-brand text-brand-foreground hover:bg-brand/90"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                  disabled={!input.trim()}
                  onClick={() => { if (input.trim()) handleSubmit(input.trim()); }}
                  whileTap={{ scale: 0.93 }}
                  transition={{ type: "spring", stiffness: 600, damping: 25 }}
                >
                  <ArrowRight className="h-4 w-4" />
                </motion.button>
              </div>

              {/* Status hint */}
              <motion.div
                className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                <span>Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">/</kbd> for commands</span>
                <span>Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send</span>
              </motion.div>
            </div>
          </div>

          {/* Scene categories — show when no tasks */}
          {showTitleProminently && (
            <SceneCategories onSelect={handleCategorySelect} />
          )}

          {/* Task queue */}
          <TaskQueue
            tasks={tasks}
            activeTaskId={activeTaskId}
            onSelect={handleSelectTask}
            onRetry={handleRetry}
            onRemove={handleRemove}
          />
        </div>

        {/* ── Right column — conditional ── */}
        <AnimatePresence mode="wait">
          {showRightPanel && (
            <motion.div
              className="w-[460px] xl:w-[520px] shrink-0 flex flex-col justify-start px-4 py-12 overflow-y-auto border-l border-border/40 bg-surface/30"
              variants={panelSlideIn}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {/* Match result for active task */}
              {activeTask && (activeTask.status === "matched" || activeTask.status === "confirming") && activeTask.matchResult && (
                <motion.div key={`match-${activeTask.id}`} variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                  <MatchResultCard
                    result={activeTask.matchResult}
                    onConfirm={() => handleConfirm(activeTask.id)}
                    onCancel={() => handleRemove(activeTask.id)}
                    onRetry={() => handleRetry(activeTask.id)}
                    loading={isConfirming}
                  />
                </motion.div>
              )}

              {/* Execution panel for active task */}
              {activeTask && (activeTask.status === "executing" || activeTask.status === "completed" || activeTask.status === "paused") && activeTask.taskId && activeExec && (
                <motion.div key={`exec-${activeTask.id}`} variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                  <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-lg">
                    {/* Header */}
                    <div className="px-5 py-3.5 border-b border-border bg-surface-hover/30 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {activeExec.completed ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : activeTask.status === "paused" ? (
                            <PauseCircle className="h-4 w-4 text-amber" />
                          ) : (
                            <Loader2 className="h-4 w-4 text-brand animate-spin" />
                          )}
                          <span className="text-sm font-medium text-foreground">
                            {activeExec.completed ? "Execution complete" : activeTask.status === "paused" ? "Paused — awaiting response" : "Executing..."}
                          </span>
                        </div>
                        <button
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
                          onClick={() => router.push(`/tasks/${activeTask.taskId}`)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />Details
                        </button>
                      </div>
                      {activeTask.matchResult && (
                        <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
                          activeTask.matchResult.mode === "matched" ? "bg-brand/5 border border-brand/15" :
                          activeTask.matchResult.mode === "dynamic_assembly" ? "bg-violet/5 border border-violet/15" : "bg-amber/5 border border-amber/15")}>
                          <span className={cn("font-medium", activeTask.matchResult.mode === "matched" ? "text-brand" : activeTask.matchResult.mode === "dynamic_assembly" ? "text-violet" : "text-amber")}>
                            {activeTask.matchResult.mode === "matched" ? `Workflow: ${activeTask.matchResult.workflow_name || "-"}` : activeTask.matchResult.mode === "dynamic_assembly" ? "Dynamic Assembly" : "Bare Agent"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Pending approvals */}
                    {activeExec.approvals.length > 0 && (
                      <div className="px-4 py-3 border-b border-amber/20 bg-amber-muted/20 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-amber">
                          <AlertCircle className="h-3.5 w-3.5" />Response needed ({activeExec.approvals.length})
                        </div>
                        {activeExec.approvals.map(a => (
                          <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />
                        ))}
                      </div>
                    )}

                    {/* Paused notice — approval timed out */}
                    {activeTask.status === "paused" && (
                      <div className="px-4 py-3 border-b border-amber/20 bg-amber/5">
                        <div className="flex items-start gap-2.5">
                          <PauseCircle className="h-4 w-4 text-amber shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-amber">审批超时，任务已暂停</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              你可以前往任务详情页恢复执行
                            </p>
                            <button
                              className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber hover:bg-amber/20 transition-colors"
                              onClick={() => router.push(`/tasks/${activeTask.taskId}`)}
                            >
                              <ExternalLink className="h-3 w-3" />前往恢复
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Log entries */}
                    <div className="max-h-[260px] overflow-y-auto px-5 py-3">
                      {activeExec.logs.length === 0 && (
                        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />Waiting for events...
                        </div>
                      )}
                      {renderExecutionGroups(activeExec.logs)}
                      <div ref={logsEndRef} />
                    </div>

                    {/* Footer */}
                    {activeExec.completed && (
                      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-hover/20">
                        <button className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                          onClick={() => handleRemove(activeTask.id)}>New Task</button>
                        <button className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 transition-colors"
                          onClick={() => router.push(`/tasks/${activeTask.taskId}`)}>
                          <ExternalLink className="h-3.5 w-3.5" />View Details
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Failed state for active task */}
              {activeTask && activeTask.status === "failed" && (
                <motion.div key={`failed-${activeTask.id}`} variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                  <div className="rounded-2xl border border-red-400/30 bg-card overflow-hidden shadow-lg">
                    <div className="px-5 py-6 text-center space-y-3">
                      <XCircle className="h-8 w-8 text-red-400 mx-auto" />
                      <p className="text-sm font-medium text-foreground">任务执行失败</p>
                      {activeTask.error && (
                        <p className="text-xs text-muted-foreground">{activeTask.error}</p>
                      )}
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-brand hover:bg-brand/10 transition-colors"
                          onClick={() => handleRetry(activeTask.id)}
                        >
                          重试
                        </button>
                        <button
                          className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                          onClick={() => handleRemove(activeTask.id)}
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Describe node result */}
              {describeNodeResult && (
                <motion.div key="desc-node" variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                  <DescribeNodeResult result={describeNodeResult}
                    onConfirm={async (skillMd, overrides) => {
                      const node = await confirmNode(skillMd, overrides);
                      if (node) { setDescribeNodeResult(null); setInput(""); }
                    }}
                    onCancel={handleCancelDescribe} loading={describeLoading} />
                </motion.div>
              )}

              {/* Describe workflow result */}
              {describeWorkflowResult && (
                <motion.div key="desc-wf" variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                  <DescribeWorkflowResult result={describeWorkflowResult}
                    onConfirm={async (name, dag) => {
                      const wf = await confirmWorkflow(name, {
                        description: describeWorkflowResult.description ?? undefined,
                        category: describeWorkflowResult.category ?? undefined,
                        dag: dag as unknown as Record<string, unknown>,
                      });
                      if (wf) router.push(`/workflows/${wf.id}`);
                    }}
                    onCancel={handleCancelDescribe} loading={describeLoading} />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-1.5 pb-3 text-[11px] text-muted-foreground/30 border-t border-border/30 pt-2.5">
        <Zap className="h-3 w-3" /><span>Nexus Workbench</span>
      </div>
    </div>
  );
}
