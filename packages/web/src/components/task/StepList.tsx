/** StepList — 纯步骤列表，不含内嵌审批（审批由 ActionCenter 统一处理） */

"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import type { Step, Approval } from "@/lib/types";
import {
  ChevronRight, Clock, Loader2, ListOrdered,
  CheckCircle2, XCircle, AlertCircle, Bell,
} from "lucide-react";

const easeOut: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

function formatDuration(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

interface StepListProps {
  steps: Step[];
  nodeNameMap: Record<string, string>;
  stepApprovalsMap: Record<string, Approval[]>;
  isRunning: boolean;
  expandedSteps: Set<string>;
  onToggleStep: (id: string) => void;
  /** 点击步骤上的审批角标时回调 */
  onStepApprovalClick?: (stepId: string) => void;
  /** 任务级 I/O（可选，在列表末尾展示摘要） */
  taskIO?: { input?: unknown; output?: unknown };
}

export default function StepList({
  steps, nodeNameMap, stepApprovalsMap,
  isRunning, expandedSteps, onToggleStep, onStepApprovalClick, taskIO,
}: StepListProps) {
  if (steps.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface border border-border/40 mb-3">
          <ListOrdered className="h-5 w-5 opacity-40" />
        </div>
        <p className="text-sm">No execution steps</p>
      </div>
    );
  }

  if (steps.length === 0 && isRunning) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mb-3 h-6 w-6 animate-spin text-brand/60" />
        <p className="text-sm">Waiting for nodes...</p>
      </div>
    );
  }

  return (
    <>
    <AnimatePresence>
      {steps.map((step, i) => {
        const isExpanded = expandedSteps.has(step.id);
        const sApprovals = stepApprovalsMap[step.id] || [];
        const pendingCount = sApprovals.filter(a => a.status === "pending").length;
        const duration = formatDuration(step.started_at, step.completed_at);

        return (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: easeOut, delay: i * 0.04 }}
            className={cn(
              "rounded-xl border overflow-hidden transition-all duration-200",
              step.status === "running" && "border-brand/25 bg-brand/[0.02]",
              step.status === "waiting_approval" && "border-amber/15",
              step.status === "failed" && "border-red-400/15 bg-red-500/[0.02]",
              step.status === "completed" && "border-border bg-card",
              step.status === "pending" && "border-border/60 bg-card opacity-40",
              isExpanded && "shadow-sm",
            )}
          >
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover/30 transition-colors"
              onClick={() => onToggleStep(step.id)}
            >
              {/* Step number */}
              <div className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                step.status === "completed" && "bg-emerald-500/10 text-emerald-400",
                step.status === "running" && "bg-brand/10 text-brand",
                step.status === "failed" && "bg-red-500/10 text-red-400",
                step.status === "pending" && "bg-muted text-muted-foreground",
                step.status === "waiting_approval" && "bg-amber/10 text-amber",
              )}>
                {step.status === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : step.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : step.status === "failed" ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  i + 1
                )}
              </div>

              {/* Name + status */}
              <span className="flex-1 text-sm font-medium text-foreground min-w-0 truncate">
                {nodeNameMap[step.node_id] || step.node_id}
              </span>

              <StatusBadge status={step.status} size="sm" />

              {/* Duration */}
              {duration && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
                  <Clock className="h-3 w-3" />{duration}
                </span>
              )}

              {/* 审批角标 - 可点击跳转 */}
              {pendingCount > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onStepApprovalClick?.(step.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onStepApprovalClick?.(step.id); } }}
                  className="shrink-0 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber px-1.5 text-[10px] font-bold text-white hover:bg-amber/80 transition-colors cursor-pointer"
                  title={`${pendingCount} 个待处理审批`}
                >
                  <Bell className="h-2.5 w-2.5 mr-0.5" />{pendingCount}
                </span>
              )}

              <motion.span
                className="shrink-0 text-muted-foreground/40"
                animate={{ rotate: isExpanded ? 90 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronRight className="h-4 w-4" />
              </motion.span>
            </button>

            {/* 展开内容：仅展示输入输出和错误，不含审批卡片 */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: easeOut }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3 border-t border-border/40 bg-surface-hover/[0.03]">
                    {step.error && (
                      <div className="mt-3 rounded-lg bg-red-500/5 border border-red-400/15 p-3">
                        <span className="mb-1 block text-xs font-medium text-red-400">Error</span>
                        <pre className="text-xs text-red-300/70 whitespace-pre-wrap break-all">{JSON.stringify(step.error, null, 2)}</pre>
                      </div>
                    )}

                    {step.input_data && (
                      <details className={cn("group mt-3", !step.error && "mt-3")}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Input Data</summary>
                        <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all">{JSON.stringify(step.input_data, null, 2)}</pre>
                      </details>
                    )}

                    {step.output_data && (
                      <details className="group" open>
                        <summary className="cursor-pointer text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors">Output</summary>
                        <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-emerald-400/70 whitespace-pre-wrap break-all">{JSON.stringify(step.output_data, null, 2)}</pre>
                      </details>
                    )}

                    {!step.error && !step.input_data && !step.output_data && step.status === "running" && (
                      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />Executing, waiting for output...
                      </div>
                    )}

                    {sApprovals.length > 0 && (
                      <div className="text-[11px] text-muted-foreground pt-1">
                        {sApprovals.filter(a => a.status === "pending").length > 0 && (
                          <span className="text-amber">有 {sApprovals.filter(a => a.status === "pending").length} 个待处理审批 → 请在右侧行动中心操作</span>
                        )}
                        {sApprovals.filter(a => a.status !== "pending").length > 0 && (
                          <span>已解决审批: {sApprovals.filter(a => a.status !== "pending").length} 个（见右侧历史记录）</span>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

    </AnimatePresence>

    {/* 任务级 I/O 摘要（仅当有数据时显示） */}
    {taskIO && (taskIO.input || taskIO.output) && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: steps.length * 0.04 + 0.1 }}
        className="rounded-xl border border-border/60 bg-card/50 overflow-hidden"
      >
        {/* 始终可见的标题栏 */}
        <div
          className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none"
          onClick={(e) => {
            const details = e.currentTarget.nextElementSibling as HTMLDetailsElement | null;
            if (details) details.open = !details.open;
          }}
        >
          <span className="h-5 w-5 rounded-md bg-surface flex items-center justify-center text-[10px]">📋</span>
          <span className="text-xs font-medium text-muted-foreground">任务摘要</span>
          <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground/30" id="taskio-chevron" />
        </div>

        {/* 可折叠内容（默认收起，隐藏原生 summary） */}
        <details className="group [&_summary]:hidden" onToggle={(e) => {
          const el = document.getElementById("taskio-chevron");
          if (el) el.style.transform = e.currentTarget.open ? "rotate(90deg)" : "";
        }}>
          <summary />
          <div className="px-4 pb-3 space-y-2 border-t border-border/30">
            {taskIO.input && (
              <details className="group/input">
                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1">Task Input</summary>
                <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all">{JSON.stringify(taskIO.input, null, 2)}</pre>
              </details>
            )}
            {taskIO.output && (
              <details className="group/output" open>
                <summary className="cursor-pointer text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors py-1">Task Output</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-emerald-400/70 whitespace-pre-wrap break-all">{JSON.stringify(taskIO.output, null, 2)}</pre>
              </details>
            )}
          </div>
        </details>
      </motion.div>
    )}
    </>
  );
}
