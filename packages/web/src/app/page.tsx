"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useTaskQueue } from "@/hooks/useTaskQueue";
import { useExecutionState } from "@/hooks/useExecutionState";
import { useDescribe } from "@/hooks/useDescribe";
import MatchResultCard from "@/components/chat/MatchResult";
import ApprovalCard from "@/components/approval/ApprovalCard";
import SceneCategories from "@/components/chat/SceneCategories";
import TaskQueue from "@/components/chat/TaskQueue";
import { TeamSelector } from "@/components/team/TeamSelector";
import { DescribeNodeResult, DescribeWorkflowResult } from "@/components/chat/DescribeResult";
import {
  ArrowRight, Zap, ExternalLink, CheckCircle2, XCircle,
  Loader2, Brain, AlertCircle, PauseCircle, PanelRightOpen, X,
} from "lucide-react";
import type {
  DescribeNodeResponse, DescribeWorkflowResponse,
  Approval,
} from "@/lib/types";
import type { ExecutionLog } from "@/types/task-queue";

// ── 动画 ──
const cardSpring = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: "spring" as const, stiffness: 400, damping: 30 },
  },
  exit: { opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.2 } },
};

// ── 执行日志分组渲染 ──
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

// ══════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════

export default function ChatPage() {
  const router = useRouter();

  // ── 输入状态 ──
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // ── Describe 状态 ──
  const [describeNodeResult, setDescribeNodeResult] = useState<DescribeNodeResponse | null>(null);
  const [describeWorkflowResult, setDescribeWorkflowResult] = useState<DescribeWorkflowResponse | null>(null);

  // ── 右面板开关 ──
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // ── Hooks ──
  const {
    tasks, activeTaskId, activeTask,
    handleSubmit: queueSubmit,
    handleConfirm, handleRetry, handleRemove, handleSelectTask: selectTask, updateTask,
  } = useTaskQueue();

  const {
    activeExec, approvalLoading, logsEndRef,
    handleResolveApproval, initExecState, cleanExecState,
  } = useExecutionState(activeTask, updateTask);

  const { describeNode, confirmNode, describeWorkflow, confirmWorkflow, loading: describeLoading } = useDescribe();

  // ── Refs ──
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Derived ──
  const hasRightPanelContent = !!(
    (activeTask && activeTask.status !== "matching") ||
    describeNodeResult ||
    describeWorkflowResult
  );
  const showRightPanel = hasRightPanelContent && rightPanelOpen;
  const showTitleProminently = tasks.length === 0 && !describeNodeResult && !describeWorkflowResult;
  const isConfirming = activeTask?.status === "confirming";

  // 新任务匹配/执行时自动打开右面板
  useEffect(() => {
    if (hasRightPanelContent) setRightPanelOpen(true);
  }, [hasRightPanelContent]);

  // ── Handlers ──

  const handleInput = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleSubmit = useCallback(async (text: string) => {
    await queueSubmit(text, selectedTeamId);
    setInput("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }, [queueSubmit, selectedTeamId]);

  const handleConfirmTask = useCallback(async (queueId: string) => {
    initExecState(queueId);
    await handleConfirm(queueId);
  }, [handleConfirm, initExecState]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (input.trim()) handleSubmit(input.trim());
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) handleSubmit(input.trim());
    }
  }, [input, handleSubmit]);

  const handleCancelDescribe = useCallback(() => {
    setDescribeNodeResult(null);
    setDescribeWorkflowResult(null);
  }, []);

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

  const handleSelectTask = useCallback((id: string) => {
    selectTask(id);
    setDescribeNodeResult(null);
    setDescribeWorkflowResult(null);
  }, [selectTask]);

  const handleRemoveTask = useCallback((queueId: string) => {
    handleRemove(queueId);
    cleanExecState(queueId);
  }, [handleRemove, cleanExecState]);

  // ══════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════

  return (
    <div className="flex h-full flex-col relative">
      <div className="flex flex-1 overflow-hidden">
        {/* ── 主内容区（始终占满宽度，内容居中） ── */}
        <div className={cn(
          "flex-1 flex flex-col px-6 sm:px-10 lg:px-16 xl:px-24 py-12 transition-all duration-300",
          showTitleProminently ? "items-center justify-center" : "items-start justify-start",
          showRightPanel && "lg:pr-2"
        )}>
          <div className="w-full max-w-[600px]">
            {/* 标题 — 无任务时展示 */}
            {showTitleProminently && (
              <motion.div
                className="mb-6"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <h1 className="text-[32px] font-bold tracking-tight leading-tight text-center">
                  <span className="bg-gradient-to-r from-foreground via-foreground to-brand/70 bg-clip-text text-transparent">What do you want to build?</span>
                </h1>
                <p className="mt-4 text-sm text-muted-foreground/80 max-w-xl text-center leading-relaxed">
                  Describe your task in natural language, and I&apos;ll find the optimal execution plan.
                </p>
              </motion.div>
            )}

                {/* 输入区 */}
            <div className="w-full mt-10">
              <div className="relative rounded-[20px] bg-gradient-to-b from-brand/[0.04] via-brand/[0.02] to-transparent p-[1px]">
                {/* Team 快捷选择 */}
                <div className="mb-1.5">
                  <TeamSelector value={selectedTeamId} onChange={setSelectedTeamId} />
                </div>

                {/* 输入框 */}
                <div className={cn(
                  "chat-input-box flex items-end gap-3 rounded-[19px] border bg-card/90 backdrop-blur-md p-4 transition-all duration-300",
                  focused ? "border-brand/50 shadow-[0_0_24px_-4px_rgba(var(--color-brand-rgb),0.15),0_0_0_1px_color-mix(in_srgb,var(--color-brand)_30%,transparent)]" : "border-border/50 shadow-sm"
                )}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => handleInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder="Describe your task..."
                    rows={1}
                    className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 py-1.5"
                    style={{ height: "auto" }}
                    onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }}
                  />
                  <motion.button
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
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

                {/* 快捷键提示 */}
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground/40">
                  <span>Press <kbd className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> to send, <kbd className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> for newline</span>
                </div>
              </div>
            </div>

            {/* 场景分类 — 无任务时展示 */}
            {showTitleProminently && (
              <SceneCategories onSelect={handleCategorySelect} />
            )}

            {/* 任务队列 */}
            <TaskQueue
              tasks={tasks}
              activeTaskId={activeTaskId}
              onSelect={handleSelectTask}
              onRetry={handleRetry}
              onRemove={handleRemoveTask}
            />
          </div>
        </div>

        {/* ── 右侧浮层面板（抽屉式，不挤压左侧） ── */}
        <AnimatePresence mode="wait">
          {showRightPanel && (
            <motion.div
              className="absolute right-0 top-0 bottom-0 w-[440px] xl:w-[500px] shrink-0 flex flex-col justify-start border-l border-border/40 bg-background/95 backdrop-blur-md shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.15)] z-20"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 35 }}
            >
              {/* 面板头：关闭按钮 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">任务详情</span>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                  onClick={() => setRightPanelOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 面板内容 — 可滚动 */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {/* 匹配结果 */}
                {activeTask && (activeTask.status === "matched" || activeTask.status === "confirming") && activeTask.matchResult && (
                  <motion.div key={`match-${activeTask.id}`} variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                    <MatchResultCard
                      result={activeTask.matchResult}
                      onConfirm={() => handleConfirmTask(activeTask.id)}
                      onCancel={() => handleRemoveTask(activeTask.id)}
                      onRetry={() => handleRetry(activeTask.id)}
                      loading={isConfirming}
                    />
                  </motion.div>
                )}

                {/* 执行面板 */}
                {activeTask && (activeTask.status === "executing" || activeTask.status === "completed" || activeTask.status === "paused") && activeTask.taskId && activeExec && (
                  <motion.div key={`exec-${activeTask.id}`} variants={cardSpring} initial="hidden" animate="visible" exit="exit">
                    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-lg">
                      {/* 头部 */}
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
                              {activeExec.completed ? "执行完成" : activeTask.status === "paused" ? "已暂停 — 等待响应" : "执行中..."}
                            </span>
                          </div>
                          <button
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
                            onClick={() => router.push(`/tasks/${activeTask.taskId}`)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />详情
                          </button>
                        </div>
                        {activeTask.matchResult && (
                          <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
                            activeTask.matchResult.mode === "matched" ? "bg-brand/5 border border-brand/15" :
                            activeTask.matchResult.mode === "dynamic_assembly" ? "bg-violet/5 border border-violet/15" : "bg-amber/5 border border-amber/15")}>
                            <span className={cn("font-medium", activeTask.matchResult.mode === "matched" ? "text-brand" : activeTask.matchResult.mode === "dynamic_assembly" ? "text-violet" : "text-amber")}>
                              {activeTask.matchResult.mode === "matched" ? `工作流: ${activeTask.matchResult.workflow_name || "-"}` : activeTask.matchResult.mode === "dynamic_assembly" ? "动态组装" : "Bare Agent"}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 待审批 */}
                      {activeExec.approvals.length > 0 && (
                        <div className="px-4 py-3 border-b border-amber/20 bg-amber-muted/20 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-amber">
                            <AlertCircle className="h-3.5 w-3.5" />需要响应 ({activeExec.approvals.length})
                          </div>
                          {activeExec.approvals.map(a => (
                            <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />
                          ))}
                        </div>
                      )}

                      {/* 暂停通知 */}
                      {activeTask.status === "paused" && (
                        <div className="px-4 py-3 border-b border-amber/20 bg-amber/5">
                          <div className="flex items-start gap-2.5">
                            <PauseCircle className="h-4 w-4 text-amber shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-medium text-amber">审批超时，任务已暂停</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">前往任务详情页恢复执行</p>
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

                      {/* 日志 */}
                      <div className="max-h-[320px] overflow-y-auto px-5 py-3">
                        {activeExec.logs.length === 0 && !activeExec.completed && (
                          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />等待事件...
                          </div>
                        )}
                        {renderExecutionGroups(activeExec.logs)}
                        <div ref={logsEndRef} />
                      </div>

                      {/* 底部操作 */}
                      {activeExec.completed && (
                        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-hover/20">
                          <button className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                            onClick={() => handleRemoveTask(activeTask.id)}>新任务</button>
                          <button className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 transition-colors"
                            onClick={() => router.push(`/tasks/${activeTask.taskId}`)}>
                            <ExternalLink className="h-3.5 w-3.5" />查看详情
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* 失败状态 */}
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
                            onClick={() => handleRemoveTask(activeTask.id)}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Describe 节点结果 */}
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

                {/* Describe 工作流结果 */}
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 面板重新打开按钮 — 面板关闭且有内容时显示 */}
      <AnimatePresence>
        {hasRightPanelContent && !rightPanelOpen && (
          <motion.button
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg text-muted-foreground hover:text-foreground hover:border-brand/30 hover:shadow-brand/10 transition-all"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setRightPanelOpen(true)}
            title="打开详情面板"
          >
            <PanelRightOpen className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* 底部 */}
      <div className="flex items-center justify-center gap-1.5 pb-3 text-[11px] text-muted-foreground/30 border-t border-border/30 pt-2.5">
        <Zap className="h-3 w-3" /><span>Nexus Workbench</span>
      </div>
    </div>
  );
}
