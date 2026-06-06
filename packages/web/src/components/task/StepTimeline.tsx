/** Step timeline — visual execution timeline */

"use client";

import { motion, AnimatePresence } from "framer-motion";
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

const STATUS_LINE: Record<string, string> = {
  pending: "bg-amber/40",
  running: "bg-brand",
  completed: "bg-emerald-400",
  failed: "bg-red-400",
  skipped: "bg-muted-foreground/25",
  waiting_approval: "bg-violet",
  rolled_back: "bg-orange-400",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber/15 text-amber border-amber/40",
  running: "bg-brand/15 text-brand border-brand/50 animate-pulse",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30",
  failed: "bg-red-500/10 text-red-400 border-red-400/30",
  skipped: "bg-muted/30 text-muted-foreground border-muted-foreground/25",
  waiting_approval: "bg-violet/10 text-violet border-violet/30",
  rolled_back: "bg-orange-400/10 text-orange-400 border-orange-400/30",
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
        <p className="text-sm">No execution steps</p>
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
          index={i}
        />
      ))}
    </div>
  );
}

function StepItem({ step, isLast, index }: { step: Step; isLast: boolean; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const dotClass = STATUS_DOT[step.status] ?? STATUS_DOT.pending;
  const lineClass = STATUS_LINE[step.status] ?? STATUS_LINE.pending;
  const hasDetails = step.input_data || step.output_data || step.error;
  const duration = formatDuration(step.started_at, step.completed_at);

  return (
    <div className="relative flex gap-4">
      {/* Timeline axis */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
            dotClass
          )}
        >
          <StepStatusIcon status={step.status} className="h-3.5 w-3.5" />
        </div>
        {!isLast && (
          <div className={cn("w-0.5 flex-1 min-h-[24px]", lineClass)} />
        )}
      </div>

      {/* Content */}
      <div className={cn("pb-5 flex-1 min-w-0", isLast && "pb-0")}>
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
              <motion.span
                className="ml-auto shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors"
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </motion.span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {duration}
              </span>
            )}
            {step.round_count > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> {step.round_count} rounds
              </span>
            )}
            {step.approval_count > 0 && (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> {step.approval_count} approvals
              </span>
            )}
            {step.retry_count > 0 && (
              <span className="flex items-center gap-1 text-orange-400">
                <RotateCw className="h-3 w-3" /> Retry {step.retry_count}
              </span>
            )}
          </div>
        </button>

        <AnimatePresence>
          {expanded && hasDetails && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] as const }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-2">
                {step.error && (
                  <DataBlock label="Error" data={step.error} variant="error" />
                )}
                {step.input_data && (
                  <DataBlock label="Input" data={step.input_data} />
                )}
                {step.output_data && (
                  <DataBlock label="Output" data={step.output_data} variant="success" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

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
    default: "text-foreground/60 bg-surface",
    error: "text-red-400 bg-red-500/5 border border-red-400/15",
    success: "text-emerald-400 bg-emerald-500/5 border border-emerald-400/15",
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
