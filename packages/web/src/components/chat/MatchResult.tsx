/** 匹配结果展示组件 — 支持 DAG 节点链一览 */

"use client";

import { cn } from "@/lib/utils";
import type { MatchResult } from "@/lib/types";
import {
  Workflow, Cpu, ArrowRight, Loader2, Sparkles, CheckCircle2,
  Clock, Network, Tag,
} from "lucide-react";

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

  const modeLabel = isWorkflow ? "工作流匹配" : isDynamicAssembly ? "动态组装" : "裸 Agent";
  const modeColor = isWorkflow
    ? "border-brand bg-brand/5"
    : isDynamicAssembly
    ? "border-violet bg-violet/5"
    : "border-amber bg-amber/5";

  const nodes = result.dag?.nodes ?? [];

  return (
    <div className="animate-scale-in w-full max-w-[600px] rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
      {/* 顶部：模式标识 */}
      <div className={cn("flex items-center gap-2.5 px-5 py-3 border-b border-border/40", modeColor)}>
        {isWorkflow ? (
          <Workflow className={cn("h-4 w-4", "text-brand")} />
        ) : isDynamicAssembly ? (
          <Sparkles className={cn("h-4 w-4", "text-violet")} />
        ) : (
          <Cpu className={cn("h-4 w-4", "text-amber")} />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {modeLabel}
        </span>
        {result.confidence != null && (
          <span className={cn(
            "ml-auto text-xs font-medium",
            isWorkflow ? "text-brand" : "text-violet"
          )}>
            {(result.confidence * 100).toFixed(0)}% 置信度
          </span>
        )}
      </div>

      {/* 主体 */}
      <div className="p-5 space-y-4">
        {/* 工作流/节点链信息 */}
        {(isWorkflow || isDynamicAssembly) && nodes.length > 0 && (
          <>
            {/* 名称 + 分类 */}
            <div className="flex items-center gap-2 flex-wrap">
              {isWorkflow && result.workflow_name && (
                <span className="text-sm font-semibold text-foreground">
                  {result.workflow_name}
                </span>
              )}
              {isDynamicAssembly && (
                <span className="text-sm font-semibold text-violet">
                  动态工作流
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Tag className="h-3 w-3" />
                {nodes.length} 节点 · {result.dag?.edges.length ?? 0} 连线
              </span>
            </div>

            {/* DAG 节点链一览 */}
            <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-surface/50 border border-border/50">
              {nodes.map((node, i) => (
                <div key={node.id} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                    <Network className="h-3 w-3 text-brand" />
                    <span className="font-medium text-foreground truncate max-w-[120px]">
                      {node.id}
                    </span>
                  </div>
                  {i < nodes.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* bare_agent 说明 */}
        {isBareAgent && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber/5 border border-amber/20">
            <Cpu className="h-4 w-4 text-amber mt-0.5 shrink-0" />
            <div className="text-xs text-foreground space-y-1.5">
              <p className="font-medium">裸 Agent 模式</p>
              <p className="text-muted-foreground">
                未匹配到已有工作流，将直接使用 CodeBuddy Agent 执行。
              </p>
              {result.available_workflow_names && result.available_workflow_names.length > 0 && (
                <div className="pt-1 text-[11px] text-muted-foreground/70">
                  💡 已有工作流: {result.available_workflow_names.join("、")} — 确保 LLM_API_KEY 已配置即可启用语义匹配
                </div>
              )}
            </div>
          </div>
        )}

        {/* 推理说明 */}
        {result.reasoning && (
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-brand mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {result.reasoning}
            </p>
          </div>
        )}

        {/* 置信度进度条 (非 bare_agent 时展示) */}
        {result.confidence != null && !isBareAgent && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">匹配置信度</span>
              <span className={cn("font-medium", isWorkflow ? "text-brand" : "text-violet")}>
                {Math.round(result.confidence * 100)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  result.confidence >= 0.8 ? "bg-emerald-400" :
                  result.confidence >= 0.6 ? "bg-amber" : "bg-muted-foreground"
                )}
                style={{ width: `${Math.round(result.confidence * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-hover/30">
        <button
          className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-hover"
          onClick={onCancel}
          disabled={loading}
        >
          取消
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-medium transition-all",
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
          {isWorkflow ? "确认执行" : isDynamicAssembly ? "确认组装并执行" : "开始执行"}
        </button>
      </div>
    </div>
  );
}
