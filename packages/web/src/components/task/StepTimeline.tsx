/** 步骤时间线 — 任务执行步骤的可视化 */

"use client";

import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import type { Step } from "@/lib/types";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  MessageSquare,
  AlertTriangle,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { useState, useCallback } from "react";

// ── 步骤状态对应的连线颜色 ──
const STATUS_LINE: Record<string, string> = {
  pending: "bg-amber/40",
  running: "bg-brand",
  completed: "bg-emerald-400",
  failed: "bg-red-400",
  skipped: "bg-muted-foreground/30",
  waiting_approval: "bg-violet",
  rolled_back: "bg-orange-400",
};

// ── 步骤状态对应的图标背景 ──
const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber/20 text-amber border-amber/40",
  running: "bg-brand/20 text-brand border-brand/60 animate-pulse",
  completed: "bg-emerald-500/15 text-emerald-500 border-emerald-400/40",
  failed: "bg-red-500/15 text-red-400 border-red-400/40",
  skipped: "bg-muted/50 text-muted-foreground border-muted-foreground/30",
  waiting_approval: "bg-violet/15 text-violet border-violet/40",
  rolled_back: "bg-orange-400/15 text-orange-400 border-orange-400/40",
};

function formatDuration(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

interface StepTimelineProps {
  steps: Step[];
  className?: string;
}

export default function StepTimeline({ steps, className }: StepTimelineProps) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Clock className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm">暂无执行步骤</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-0", className)}>
      {steps.map((step, i) => (
        <StepItem
          key={step.id}
          step={step}
          isLast={i === steps.length - 1}
        />
      ))}
    </div>
  );
}

// ── 单个步骤 ──

function StepItem({ step, isLast }: { step: Step; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const dotClass = STATUS_DOT[step.status] ?? STATUS_DOT.pending;
  const lineClass = STATUS_LINE[step.status] ?? STATUS_LINE.pending;
  const hasDetails = step.input_data || step.output_data || step.error;

  const duration = formatDuration(step.started_at, step.completed_at);

  return (
    <div className="relative flex gap-4">
      {/* 左侧时间轴线 */}
      <div className="flex flex-col items-center">
        {/* 圆点 */}
        <div
          className={cn(
            "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
            dotClass
          )}
        >
          <StepStatusIcon status={step.status} className="h-3.5 w-3.5" />
        </div>
        {/* 连线 */}
        {!isLast && (
          <div className={cn("w-0.5 flex-1 min-h-[24px]", lineClass)} />
        )}
      </div>

      {/* 右侧内容 */}
      <div className={cn("pb-5 flex-1 min-w-0", isLast && "pb-0")}>
        {/* 标题行 */}
        <button
          className="w-full text-left group"
          onClick={hasDetails ? toggle : undefined}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {step.node_id}
            </span>
            <StatusBadge status={step.status} />
            {hasDetails && (
              <span className="ml-auto shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </span>
            )}
          </div>

          {/* 元信息 */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {duration}
              </span>
            )}
            {step.round_count > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> {step.round_count} 轮
              </span>
            )}
            {step.approval_count > 0 && (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> {step.approval_count} 审批
              </span>
            )}
            {step.retry_count > 0 && (
              <span className="flex items-center gap-1 text-orange-400">
                <RotateCw className="h-3 w-3" /> 重试 {step.retry_count}
              </span>
            )}
          </div>
        </button>

        {/* 展开详情 */}
        {expanded && hasDetails && (
          <div className="mt-3 space-y-2 animate-scale-in">
            {step.error && (
              <DataBlock
                label="错误"
                data={step.error}
                variant="error"
              />
            )}
            {step.input_data && (
              <DataBlock label="输入" data={step.input_data} />
            )}
            {step.output_data && (
              <DataBlock label="输出" data={step.output_data} variant="success" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 状态图标 ──

function StepStatusIcon({ status, className }: { status: string; className?: string }) {
  switch (status) {
    case "pending":
      return <Clock className={className} />;
    case "running":
      return <div className={cn(className, "h-2 w-2 rounded-full bg-current animate-ping")} />;
    case "completed":
      return <div className={cn(className, "h-2 w-2 rounded-full bg-current")} />;
    case "failed":
      return <AlertTriangle className={className} />;
    case "waiting_approval":
      return <ShieldCheck className={className} />;
    case "skipped":
    case "rolled_back":
      return <RotateCw className={className} />;
    default:
      return <Clock className={className} />;
  }
}

// ── 数据块 ──

function DataBlock({
  label,
  data,
  variant = "default",
}: {
  label: string;
  data: Record<string, unknown>;
  variant?: "default" | "error" | "success";
}) {
  const colorMap = {
    default: "text-foreground bg-surface",
    error: "text-red-400 bg-red-500/5 border border-red-400/20",
    success: "text-emerald-400 bg-emerald-500/5 border border-emerald-400/20",
  };

  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <pre
        className={cn(
          "max-h-40 overflow-auto rounded-lg p-3 font-mono text-xs",
          colorMap[variant]
        )}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
