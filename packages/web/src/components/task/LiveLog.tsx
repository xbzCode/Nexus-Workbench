/** Live log panel — SSE event stream with terminal aesthetics */

"use client";

import { motion } from "framer-motion";
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

function formatEventMessage(evt: SSEEvent): string {
  const d = evt.data || {};
  switch (evt.event) {
    case "dag:validation_passed":
      return `DAG validated, ${d.node_count} nodes`;
    case "dag:topo_sorted":
      return "Topo sort complete, ready to execute";
    case "dag:level_started":
      return `Starting level ${d.level}`;
    case "dag:level_completed":
      return `Level ${d.level} complete`;
    case "dag:node_started":
      return `Node ${d.node_id} started`;
    case "dag:node_completed": {
      const output = d.output as Record<string, unknown> | undefined;
      const summary = output?.summary as string | undefined;
      return `Node ${d.node_id} done${summary ? ` \u2014 ${summary}` : ""}`;
    }
    case "dag:node_failed":
      return `Node ${d.node_id} failed: ${d.error}`;
    case "dag:node_skipped":
      return `Node ${d.node_id} skipped: ${d.reason}`;
    case "dag:execution_completed":
      return "Workflow execution complete";
    case "node:thinking":
      return `${d.node_id}: ${(d.content as string)?.slice(0, 120)}`;
    case "node:progress":
      return `${d.node_id}: ${(d.content as string)?.slice(0, 120)}`;
    case "node:question":
      return `Agent: ${(d.question as string)?.slice(0, 100)}`;
    case "approval:created":
      return `Approval needed: ${d.title}`;
    case "approval:resolved":
      return `Approval ${d.status === "approved" ? "approved" : "rejected"}`;
    default: {
      const msg = d.message ?? d.detail ?? d.content;
      return typeof msg === "string" ? msg : JSON.stringify(d).slice(0, 120);
    }
  }
}

interface LiveLogProps {
  events: SSEEvent[];
  className?: string;
  isLive?: boolean;
}

export default function LiveLog({ events, className, isLive = false }: LiveLogProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

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
            <span className="text-sm">Waiting for events...</span>
          </>
        ) : (
          <>
            <ScrollText className="mb-2 h-6 w-6 opacity-40" />
            <span className="text-sm">No logs</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-surface-hover/20">
        <span className="text-xs font-medium text-muted-foreground">
          Live Log ({events.length})
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 rounded accent-brand"
          />
          Auto-scroll
        </label>
      </div>

      {/* Log lines */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-xs p-3 space-y-px bg-surface/50"
      >
        {events.map((evt, i) => {
          const style = EVENT_STYLES[evt.event] ?? { color: "text-foreground" };
          const EventIcon = style.icon;
          const message = formatEventMessage(evt);

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-2 leading-relaxed py-0.5"
            >
              <span className="shrink-0 text-muted-foreground/40 w-[60px] text-right tabular-nums">
                {evt.timestamp ? formatTime(new Date(evt.timestamp)) : formatTime(new Date())}
              </span>
              <span className={cn("shrink-0 mt-0.5", style.color)}>
                {EventIcon ? <EventIcon className="h-3 w-3" /> : <span className="inline-block h-3 w-3 rounded-full border border-border/40" />}
              </span>
              <span className={cn("shrink-0 w-[140px] truncate", style.color)}>
                {evt.event}
              </span>
              <span className="text-foreground/70 break-all">
                {message}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
