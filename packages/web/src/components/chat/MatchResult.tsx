/** 匹配结果展示组件 */

"use client";

import { cn } from "@/lib/utils";
import type { MatchResult } from "@/lib/types";
import { Workflow, Cpu, ArrowRight, Loader2, Sparkles } from "lucide-react";

interface MatchResultCardProps {
  result: MatchResult;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function MatchResultCard({
  result,
  onConfirm,
  onCancel,
  loading,
}: MatchResultCardProps) {
  const isWorkflow = result.mode === "matched";
  const isDynamicAssembly = result.mode === "dynamic_assembly";
  const isBareAgent = result.mode === "bare_agent";

  return (
    <div className="animate-scale-in w-full max-w-[560px] rounded-2xl border border-border bg-card p-5 shadow-lg">
      {/* Mode header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            isWorkflow ? "bg-brand/10" : isDynamicAssembly ? "bg-violet/10" : "bg-amber/10"
          )}
        >
          {isWorkflow ? (
            <Workflow className="h-5 w-5 text-brand" />
          ) : isDynamicAssembly ? (
            <Sparkles className="h-5 w-5 text-violet" />
          ) : (
            <Cpu className="h-5 w-5 text-amber" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {isWorkflow ? "匹配到工作流" : isDynamicAssembly ? "动态组装" : "裸 Agent 模式"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isWorkflow
              ? `置信度 ${Math.round((result.confidence ?? 0) * 100)}%`
              : isDynamicAssembly
              ? "根据意图从节点能力中组装工作流"
              : "未匹配到已有工作流，将直接使用 Agent 执行"}
          </p>
        </div>
      </div>

      {/* Workflow / DAG info */}
      {(isWorkflow || isDynamicAssembly) && result.dag && (
        <div className={cn(
          "mb-4 rounded-xl border p-3",
          isWorkflow ? "bg-brand/5 border-brand/20" : "bg-violet/5 border-violet/20"
        )}>
          <div className="flex items-center gap-2">
            {isWorkflow ? (
              <Workflow className="h-4 w-4 text-brand" />
            ) : (
              <Sparkles className="h-4 w-4 text-violet" />
            )}
            <span className="text-sm font-medium text-foreground">
              {isWorkflow ? result.workflow_name : "动态工作流"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            包含 {result.dag.nodes.length} 个节点,{" "}
            {result.dag.edges.length} 条边
          </p>
        </div>
      )}

      {/* Reasoning */}
      {result.reasoning && (
        <div className="mb-4 flex items-start gap-2 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{result.reasoning}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-hover"
          onClick={onCancel}
          disabled={loading}
        >
          取消
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            isWorkflow
              ? "bg-brand text-brand-foreground hover:opacity-90"
              : isDynamicAssembly
              ? "bg-violet text-white hover:opacity-90"
              : "bg-amber text-amber-foreground hover:opacity-90",
            loading && "opacity-70 cursor-not-allowed"
          )}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {isWorkflow ? "确认执行" : isDynamicAssembly ? "确认组装" : "开始执行"}
        </button>
      </div>
    </div>
  );
}
