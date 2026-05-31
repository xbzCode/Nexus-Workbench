/** 实时日志面板 — SSE 事件流展示（增强版） */

"use client";

import { cn } from "@/lib/utils";
import type { SSEEvent } from "@/lib/types";
import { useState, useRef, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Brain,
  AlertCircle,
  SkipForward,
  Play,
  ChevronRight,
  ShieldCheck,
  Workflow,
  ScrollText,
} from "lucide-react";

// ── 事件类型配色 ──
const EVENT_STYLES: Record<string, { color: string; icon?: React.ElementType }> = {
  "dag:validation_passed": { color: "text-emerald-400", icon: CheckCircle2 },
  "dag:topo_sorted": { color: "text-blue-400", icon: Workflow },
  "dag:level_started": { color: "text-brand", icon: ChevronRight },
  "dag:level_completed": { color: "text-brand", icon: CheckCircle2 },
  "dag:node_started": { color: "text-amber", icon: Play },
  "dag:node_completed": { color: "text-emerald-400", icon: CheckCircle2 },
  "dag:node_failed": { color: "text-red-400", icon: XCircle },
  "dag:node_skipped": { color: "text-muted-foreground", icon: SkipForward },
  "dag:execution_completed": { color: "text-emerald-400", icon: CheckCircle2 },
  "node:thinking": { color: "text-violet", icon: Brain },
  "node:progress": { color: "text-brand", icon: Loader2 },
  "node:output": { color: "text-emerald-400", icon: CheckCircle2 },
  "node:error": { color: "text-red-400", icon: XCircle },
  "node:question": { color: "text-amber", icon: AlertCircle },
  "node:approval_required": { color: "text-violet", icon: ShieldCheck },
  "approval:created": { color: "text-amber", icon: ShieldCheck },
  "approval:resolved": { color: "text-emerald-400", icon: CheckCircle2 },
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 将事件数据转为可读摘要 */
function formatEventMessage(evt: SSEEvent): string {
  const d = evt.data || {};
  switch (evt.event) {
    case "dag:validation_passed":
      return `DAG 校验通过，共 ${d.node_count} 个节点`;
    case "dag:topo_sorted":
      return "拓扑排序完成，准备执行";
    case "dag:level_started":
      return `开始执行第 ${d.level} 层`;
    case "dag:level_completed":
      return `第 ${d.level} 层执行完成`;
    case "dag:node_started":
      return `节点 ${d.node_id} 开始执行`;
    case "dag:node_completed": {
      const output = d.output as Record<string, unknown> | undefined;
      const summary = output?.summary as string | undefined;
      return `节点 ${d.node_id} 完成${summary ? ` — ${summary}` : ""}`;
    }
    case "dag:node_failed":
      return `节点 ${d.node_id} 失败: ${d.error}`;
    case "dag:node_skipped":
      return `节点 ${d.node_id} 跳过: ${d.reason}`;
    case "dag:execution_completed":
      return "✓ 工作流执行完成";
    case "node:thinking":
      return `${d.node_id}: ${(d.content as string)?.slice(0, 120)}`;
    case "node:progress":
      return `${d.node_id}: ${(d.content as string)?.slice(0, 120)}`;
    case "node:question":
      return `Agent 提问: ${(d.question as string)?.slice(0, 100)}`;
    case "approval:created":
      return `需要审批: ${d.title}`;
    case "approval:resolved":
      return `审批已${d.status === "approved" ? "通过" : "拒绝"}`;
    default: {
      const msg = d.message ?? d.detail ?? d.content;
      return typeof msg === "string" ? msg : JSON.stringify(d).slice(0, 120);
    }
  }
}

interface LiveLogProps {
  events: SSEEvent[];
  className?: string;
  /** 是否有实时连接（显示"等待事件"动画） */
  isLive?: boolean;
}

export default function LiveLog({ events, className, isLive = false }: LiveLogProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  if (events.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-muted-foreground", className)}>
        {isLive ? (
          <>
            <Loader2 className="mb-2 h-6 w-6 animate-spin opacity-40" />
            <span className="text-sm">等待执行事件…</span>
          </>
        ) : (
          <>
            <ScrollText className="mb-2 h-6 w-6 opacity-40" />
            <span className="text-sm">暂无日志</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-hover/30">
        <span className="text-xs font-medium text-muted-foreground">
          实时日志 ({events.length})
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 rounded"
          />
          自动滚动
        </label>
      </div>

      {/* Log lines */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-xs space-y-px p-3 bg-surface"
      >
        {events.map((evt, i) => {
          const style = EVENT_STYLES[evt.event] ?? { color: "text-foreground" };
          const EventIcon = style.icon;
          const message = formatEventMessage(evt);

          return (
            <div key={i} className="flex items-start gap-2 leading-relaxed py-0.5">
              <span className="shrink-0 text-muted-foreground/50 w-[60px] text-right">
                {formatTime(new Date())}
              </span>
              <span className={cn("shrink-0 mt-0.5", style.color)}>
                {EventIcon ? <EventIcon className="h-3 w-3" /> : <span className="inline-block h-3 w-3 rounded-full border border-border" />}
              </span>
              <span className={cn("shrink-0 w-[140px] truncate", style.color)}>
                {evt.event}
              </span>
              <span className="text-foreground/80 break-all">
                {message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
