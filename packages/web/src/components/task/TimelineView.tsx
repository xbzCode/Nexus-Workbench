"use client";

import { cn } from "@/lib/utils";
import type { Step } from "@/lib/types";
import {
  Play, CheckCircle2, Loader2,
  Cpu, Clock, RefreshCw, Search,
} from "lucide-react";

// ── Types ──

interface Phase {
  name: string;
  ts: string;
  ts_end: string;
  type: "adapter_start" | "round" | "analyze" | "approval" | "resume";
  detail?: string;
  tool_calls?: string[];
  is_question?: boolean;
  approval_type?: string;
  approval_id?: string;
}

interface TimelineStep {
  step: Step;
  displayName: string;
  phases: Phase[];
}

interface TimelineViewProps {
  steps: Step[];
  taskStartedAt: string | null;
  taskCompletedAt: string | null;
  taskStatus: string;
  nodeNameMap: Record<string, string>;
}

// ── Helpers ──

function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function phaseDurationMs(p: Phase): number {
  return parseTs(p.ts_end) - parseTs(p.ts);
}

function stepDurationMs(s: Step): number | null {
  if (!s.started_at || !s.completed_at) return null;
  return new Date(s.completed_at).getTime() - new Date(s.started_at).getTime();
}

function totalTaskDurationMs(
  taskStartedAt: string | null,
  taskCompletedAt: string | null
): number | null {
  if (!taskStartedAt || !taskCompletedAt) return null;
  return new Date(taskCompletedAt).getTime() - new Date(taskStartedAt).getTime();
}

// ── Sub-components ──

function PhaseIcon({ type, isQuestion }: { type: Phase["type"]; isQuestion?: boolean }) {
  switch (type) {
    case "adapter_start":
      return <Play className="h-3 w-3 text-sky-400" />;
    case "round":
      return <Cpu className="h-3 w-3 text-violet-400" />;
    case "analyze":
      return isQuestion ? (
        <Search className="h-3 w-3 text-amber-400" />
      ) : (
        <Search className="h-3 w-3 text-muted-foreground" />
      );
    case "approval":
      return <Clock className="h-3 w-3 text-amber-400" />;
    case "resume":
      return <RefreshCw className="h-3 w-3 text-emerald-400" />;
    default:
      return <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
  }
}

function PhaseLabel({
  phase,
  stepDuration,
  taskDuration,
}: {
  phase: Phase;
  stepDuration: number | null;
  taskDuration: number | null;
}) {
  const dur = phaseDurationMs(phase);
  const durStr = fmtDuration(dur);

  // 计算占比
  const base = stepDuration ?? taskDuration;
  const pct = base && dur > 0 ? Math.round((dur / base) * 100) : null;
  const showPct = pct !== null && pct >= 10; // 只显示 ≥10% 的占比

  switch (phase.type) {
    case "adapter_start":
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-foreground/70">
            {phase.detail === "resume" ? "CLI resume (--resume ✅)" : "CLI 启动"}
          </span>
          <span className="text-muted-foreground tabular-nums">{durStr}</span>
        </span>
      );
    case "round": {
      const tools = phase.tool_calls ?? [];
      const toolSummary = tools.length > 0 ? tools.join(", ") : "LLM 输出";
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-foreground/70">{toolSummary}</span>
          <span className="text-muted-foreground tabular-nums">{durStr}</span>
          {showPct && (
            <span className="text-amber-400 tabular-nums">← {pct}%</span>
          )}
        </span>
      );
    }
    case "analyze":
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-foreground/70">
            {phase.is_question ? "ANALYZE → 检测到提问" : "ANALYZE → 无提问"}
          </span>
          <span className="text-muted-foreground tabular-nums">{durStr}</span>
        </span>
      );
    case "approval":
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-amber-400">⏳ 用户审批等待</span>
          <span className="text-amber-300 tabular-nums">{durStr}</span>
          {showPct && (
            <span className="text-amber-400 tabular-nums">← {pct}%</span>
          )}
        </span>
      );
    case "resume":
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-foreground/70">Resume 会话</span>
          <span className="text-muted-foreground tabular-nums">{durStr}</span>
        </span>
      );
    default:
      return <span className="text-foreground/70">{phase.name}</span>;
  }
}

function StepTimeline({
  item,
  taskDuration,
  isLast,
}: {
  item: TimelineStep;
  taskDuration: number | null;
  isLast: boolean;
}) {
  const { step, displayName, phases } = item;
  const sDur = stepDurationMs(step);
  const sDurStr = sDur !== null ? fmtDuration(sDur) : "";

  return (
    <div className="relative">
      {/* 节点行 */}
      <div className="flex items-start gap-2 py-1">
        {/* 时间 */}
        <span className="shrink-0 w-14 text-right tabular-nums text-muted-foreground/40 text-[11px] leading-5">
          {step.started_at ? fmtTime(step.started_at) : ""}
        </span>

        {/* 树线 + 状态点 */}
        <div className="shrink-0 w-4 flex flex-col items-center relative">
          {/* 状态圆点 */}
          <div
            className={cn(
              "h-4 w-4 rounded-full border-2 flex items-center justify-center z-[1] bg-background",
              step.status === "completed" && "border-emerald-400",
              step.status === "running" && "border-brand",
              step.status === "failed" && "border-red-400",
              step.status === "waiting_approval" && "border-amber"
            )}
          >
            {step.status === "completed" && (
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
            )}
            {step.status === "running" && (
              <Loader2 className="h-2.5 w-2.5 animate-spin text-brand" />
            )}
          </div>
          {/* 下延竖线（到子阶段） */}
          {phases.length > 0 && (
            <div className="w-px flex-1 bg-border/60 min-h-[4px]" />
          )}
        </div>

        {/* 节点名称 + 耗时 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-foreground truncate">
              [{displayName}]
            </span>
            {sDurStr && (
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {sDurStr}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 子阶段列表 */}
      {phases.length > 0 && (
        <div className="relative ml-[22px]">
          {/* 左侧竖线 */}
          <div className="absolute left-0 top-0 bottom-0 w-px bg-border/40" />

          {phases.map((phase, pi) => {
            return (
              <div key={pi} className="flex items-center gap-2 py-0.5 relative">
                {/* 横线分支 */}
                <div className="shrink-0 w-3 flex items-center">
                  <div className="w-3 h-px bg-border/40" />
                </div>

                {/* 时间 */}
                <span className="shrink-0 w-14 text-right tabular-nums text-muted-foreground/30 text-[10px] leading-4">
                  {fmtTime(phase.ts)}
                </span>

                {/* 图标 */}
                <PhaseIcon type={phase.type} isQuestion={phase.is_question} />

                {/* 标签 + 耗时 */}
                <div className="flex-1 min-w-0 text-[11px]">
                  <PhaseLabel
                    phase={phase}
                    stepDuration={sDur}
                    taskDuration={taskDuration}
                  />
                </div>
              </div>
            );
          })}

          {/* 节点底部竖线（连下一个节点） */}
          {!isLast && (
            <div className="w-px h-2 bg-border/40" />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export default function TimelineView({
  steps,
  taskStartedAt,
  taskCompletedAt,
  taskStatus,
  nodeNameMap,
}: TimelineViewProps) {
  const taskDur = totalTaskDurationMs(taskStartedAt, taskCompletedAt);

  // 构建 TimelineStep 列表 — 从 Step.debug_info.phases 解析
  const timelineSteps: TimelineStep[] = steps.map((s) => {
    const rawPhases = (s.debug_info as Record<string, unknown> | null)?.phases;
    const phases: Phase[] = Array.isArray(rawPhases)
      ? rawPhases.filter(
          (p: unknown) => typeof p === "object" && p !== null && "ts" in (p as Record<string, unknown>) && "ts_end" in (p as Record<string, unknown>)
        ) as Phase[]
      : [];
    return {
      step: s,
      displayName: nodeNameMap[s.node_id] || s.node_id,
      phases,
    };
  });

  return (
    <div className="font-mono text-[11px] space-y-0">
      {/* TASK START */}
      <div className="flex items-center gap-2 py-1">
        <span className="shrink-0 w-14 text-right tabular-nums text-muted-foreground/40 text-[11px] leading-5">
          {taskStartedAt ? fmtTime(taskStartedAt) : ""}
        </span>
        <div className="shrink-0 w-4 h-4 rounded-full bg-brand/20 border-2 border-brand flex items-center justify-center">
          <Play className="h-2.5 w-2.5 text-brand" />
        </div>
        <span className="text-[12px] font-semibold text-brand">TASK START</span>
        {taskDur !== null && (
          <span className="text-muted-foreground tabular-nums">
            总耗时 {fmtDuration(taskDur)}
          </span>
        )}
      </div>

      {/* 竖线 → 节点 */}
      <div className="ml-[7px] w-px h-1 bg-border/40" />

      {/* 节点时间线 */}
      {timelineSteps.length === 0 && (
        <div className="text-muted-foreground py-6 text-center text-[11px]">
          {taskStatus === "running" ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />等待节点启动...
            </span>
          ) : (
            "暂无执行记录"
          )}
        </div>
      )}

      {timelineSteps.map((item, i) => (
        <StepTimeline
          key={item.step.id}
          item={item}
          taskDuration={taskDur}
          isLast={i === timelineSteps.length - 1}
        />
      ))}

      {/* 竖线 → TASK END */}
      {timelineSteps.length > 0 && (
        <div className="ml-[7px] w-px h-1 bg-border/40" />
      )}

      {/* TASK COMPLETED */}
      {(taskStatus === "completed" || taskStatus === "failed") && taskCompletedAt && (
        <div className="flex items-center gap-2 py-1">
          <span className="shrink-0 w-14 text-right tabular-nums text-muted-foreground/40 text-[11px] leading-5">
            {fmtTime(taskCompletedAt)}
          </span>
          <div
            className={cn(
              "shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center",
              taskStatus === "completed"
                ? "bg-emerald-400/10 border-emerald-400"
                : "bg-red-400/10 border-red-400"
            )}
          >
            {taskStatus === "completed" ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-red-400" />
            )}
          </div>
          <span
            className={cn(
              "text-[12px] font-semibold",
              taskStatus === "completed" ? "text-emerald-400" : "text-red-400"
            )}
          >
            TASK {taskStatus.toUpperCase()}
          </span>
        </div>
      )}

      {/* 运行中 */}
      {taskStatus === "running" && (
        <div className="flex items-center gap-2 py-1">
          <span className="shrink-0 w-14 text-right tabular-nums text-muted-foreground/40 text-[11px] leading-5">
            ...
          </span>
          <Loader2 className="shrink-0 h-4 w-4 animate-spin text-brand" />
          <span className="text-brand text-[12px] font-medium">执行中...</span>
        </div>
      )}
    </div>
  );
}
