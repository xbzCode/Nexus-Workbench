/** Match result display — staggered reveal with framer-motion */

"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { MatchResult } from "@/lib/types";
import {
  Workflow, Cpu, ArrowRight, Loader2, Sparkles,
  Network, Tag, RotateCcw,
} from "lucide-react";

const staggerItems = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const itemFade = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] as const } },
};

/** Clean up a definition_id / node name for display */
function cleanLabel(raw: string): string {
  // UUID-like: show truncated version
  if (/^[0-9a-fA-F]{8}-/.test(raw) || /^[0-9a-fA-F]{10,}$/.test(raw)) {
    return raw.length > 12 ? raw.slice(0, 8) + "..." : raw;
  }
  return raw
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

interface MatchResultCardProps {
  result: MatchResult;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry?: () => void;
  loading?: boolean;
}

export default function MatchResultCard({
  result,
  onConfirm,
  onCancel,
  onRetry,
  loading,
}: MatchResultCardProps) {
  const isWorkflow = result.mode === "matched";
  const isDynamicAssembly = result.mode === "dynamic_assembly";
  const isBareAgent = result.mode === "bare_agent";

  const modeLabel = isWorkflow ? "Workflow Match" : isDynamicAssembly ? "Dynamic Assembly" : "Bare Agent";
  const modeAccent = isWorkflow ? "brand" : isDynamicAssembly ? "violet" : "amber";

  const nodes = result.dag?.nodes ?? [];

  return (
    <motion.div
      className="w-full max-w-[480px] rounded-2xl border border-border bg-card overflow-hidden shadow-xl shadow-black/10"
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      {/* Header — mode badge */}
      <div className={cn(
        "flex items-center gap-2.5 px-5 py-3 border-b border-border/40",
        isWorkflow ? "bg-brand/5" : isDynamicAssembly ? "bg-violet/5" : "bg-amber/5"
      )}>
        {isWorkflow ? (
          <Workflow className="h-4 w-4 text-brand" />
        ) : isDynamicAssembly ? (
          <Sparkles className="h-4 w-4 text-violet" />
        ) : (
          <Cpu className="h-4 w-4 text-amber" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {modeLabel}
        </span>
        {result.confidence != null && (
          <span className={cn("ml-auto text-xs font-medium", isWorkflow ? "text-brand" : "text-violet")}>
            {(result.confidence * 100).toFixed(0)}% confidence
          </span>
        )}
      </div>

      {/* Body */}
      <motion.div className="p-5 space-y-4" variants={staggerItems} initial="hidden" animate="visible">
        {/* Workflow / node chain */}
        {(isWorkflow || isDynamicAssembly) && nodes.length > 0 && (
          <>
            <motion.div className="flex items-center gap-2 flex-wrap" variants={itemFade}>
              {isWorkflow && result.workflow_name && (
                <span className="text-sm font-semibold text-foreground">{result.workflow_name}</span>
              )}
              {isDynamicAssembly && (
                <span className="text-sm font-semibold text-violet">Dynamic Workflow</span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Tag className="h-3 w-3" />
                {nodes.length} nodes &middot; {result.dag?.edges.length ?? 0} edges
              </span>
            </motion.div>

            {/* Node chain */}
            <motion.div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-surface/50 border border-border/50" variants={itemFade}>
              {nodes.map((node, i) => (
                <div key={node.id} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                    <Network className="h-3 w-3 text-brand" />
                    <span className="font-medium text-foreground truncate max-w-[120px]">
                      {node.display_name || cleanLabel(node.definition_id || node.id)}
                    </span>
                  </div>
                  {i < nodes.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                  )}
                </div>
              ))}
            </motion.div>
          </>
        )}

        {/* Bare agent note */}
        {isBareAgent && (
          <motion.div className="flex items-start gap-2 p-3 rounded-xl bg-amber/5 border border-amber/20" variants={itemFade}>
            <Cpu className="h-4 w-4 text-amber mt-0.5 shrink-0" />
            <div className="text-xs text-foreground space-y-1.5">
              <p className="font-medium">Bare Agent Mode</p>
              <p className="text-muted-foreground">
                No existing workflow matched. Will execute directly using CodeBuddy Agent.
              </p>
              {result.available_workflow_names && result.available_workflow_names.length > 0 && (
                <p className="pt-1 text-[11px] text-muted-foreground/70">
                  Available: {result.available_workflow_names.join(", ")} — configure LLM_API_KEY to enable semantic matching
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* Reasoning */}
        {result.reasoning && (
          <motion.div className="flex items-start gap-2" variants={itemFade}>
            <Sparkles className="h-3.5 w-3.5 text-brand mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">{result.reasoning}</p>
          </motion.div>
        )}

        {/* Confidence bar */}
        {result.confidence != null && !isBareAgent && (
          <motion.div className="space-y-1.5" variants={itemFade}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Match confidence</span>
              <span className={cn("font-medium", isWorkflow ? "text-brand" : "text-violet")}>
                {Math.round(result.confidence * 100)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface overflow-hidden">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  result.confidence >= 0.8 ? "bg-emerald-400" :
                  result.confidence >= 0.6 ? "bg-amber" : "bg-muted-foreground"
                )}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(result.confidence * 100)}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
              />
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-hover/20">
        <button
          className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-hover"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        {onRetry && (
          <button
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-brand hover:bg-brand/10"
            onClick={onRetry}
            disabled={loading}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        )}
        <motion.button
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-medium transition-colors",
            isWorkflow ? "bg-brand text-brand-foreground hover:bg-brand/90" :
            isDynamicAssembly ? "bg-violet text-white hover:bg-violet/90" :
            "bg-amber text-amber-foreground hover:bg-amber/90",
            loading && "opacity-70 cursor-not-allowed"
          )}
          onClick={onConfirm}
          disabled={loading}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {isWorkflow ? "Execute" : isDynamicAssembly ? "Assemble & Execute" : "Start"}
        </motion.button>
      </div>
    </motion.div>
  );
}
