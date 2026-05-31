/** 审批卡片组件 — 支持 confirm/choice/input 三种审批类型 */

"use client";

import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { Approval, ApprovalResolve } from "@/lib/types";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Zap,
  HelpCircle,
  ListChecks,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";

// ── 紧急度样式 ──
const URGENCY_STYLE: Record<string, { bg: string; icon: React.ElementType }> = {
  auto_decidable: { bg: "bg-emerald-500/10 text-emerald-600", icon: Zap },
  normal: { bg: "bg-brand/10 text-brand", icon: Clock },
  high: { bg: "bg-amber/10 text-amber", icon: AlertTriangle },
  critical: { bg: "bg-red-500/10 text-red-500", icon: AlertTriangle },
};

// ── 审批类型配置 ──
const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  confirm: { label: "确认", icon: ShieldCheck, color: "text-violet" },
  choice: { label: "选择", icon: ListChecks, color: "text-blue-400" },
  input: { label: "输入", icon: MessageSquare, color: "text-amber" },
  question: { label: "提问", icon: HelpCircle, color: "text-amber" },
};

interface ApprovalCardProps {
  approval: Approval;
  onResolve?: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  compact?: boolean;
  className?: string;
}

export default function ApprovalCard({
  approval,
  onResolve,
  compact = false,
  className,
}: ApprovalCardProps) {
  const isPending = approval.status === "pending";
  const urgency = URGENCY_STYLE[approval.urgency] ?? URGENCY_STYLE.normal;
  const UrgencyIcon = urgency.icon;
  const typeKey = approval.type || "confirm";
  const typeConf = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.confirm;
  const TypeIcon = typeConf.icon;

  // 自动审批标记
  const isAutoDecided =
    approval.urgency === "auto_decidable" && approval.status === "approved";

  // choice 类型：选中项
  const [selectedOption, setSelectedOption] = useState<number>(0);
  // input 类型：用户输入
  const [inputValue, setInputValue] = useState("");

  // 解析选项列表
  const options = (approval.options as Array<{ label: string; value: string }> | null) ?? [];

  // 解析已处理的审批结果
  const resolvedResult = approval.result as Record<string, unknown> | null;
  const resolvedChoice = resolvedResult?.choice as string | undefined;
  const resolvedAnswer = resolvedResult?.answer as string | undefined;

  // 处理审批提交
  const handleResolve = (status: "approved" | "rejected") => {
    if (!onResolve) return;

    let result: Record<string, unknown> | undefined;
    if (typeKey === "choice" && status === "approved") {
      const opt = options[selectedOption];
      result = { choice: opt?.value ?? opt?.label, label: opt?.label };
    } else if ((typeKey === "input" || typeKey === "question") && status === "approved") {
      result = { answer: inputValue || "确认，请继续执行" };
    }
    onResolve(approval.id, status, result);
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all",
        isPending
          ? "border-amber/30 bg-amber-muted/50"
          : "border-border bg-card",
        className
      )}
    >
      <div className={cn("flex items-start justify-between gap-4", compact && "items-center")}>
        {/* 左侧信息 */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <StatusBadge status={approval.status} />
            <span className="text-sm font-medium text-foreground truncate">
              {approval.title}
            </span>
            {isAutoDecided && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                已自动批准
              </span>
            )}
          </div>

          {!compact && approval.description && (
            <p className="mb-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
              {approval.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5">
              <ShieldCheck className="h-3 w-3" />
              {approval.source}
            </span>
            <span className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5", urgency.bg)}>
              <UrgencyIcon className="h-3 w-3" />
              {approval.urgency === "auto_decidable"
                ? "可自动决定"
                : approval.urgency === "normal"
                ? "普通"
                : approval.urgency === "high"
                ? "紧急"
                : "严重"}
            </span>
            <span className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5", typeConf.color)}>
              <TypeIcon className="h-3 w-3" />
              {typeConf.label}
            </span>
          </div>

          {/* ── 已处理的结果展示 ── */}
          {!isPending && !compact && (
            <div className="mt-2 rounded-lg bg-surface p-2 text-xs text-muted-foreground">
              {resolvedChoice && (
                <span>选择: <span className="text-foreground font-medium">{resolvedChoice}</span></span>
              )}
              {resolvedAnswer && (
                <span>回答: <span className="text-foreground font-medium">{resolvedAnswer}</span></span>
              )}
              {!resolvedChoice && !resolvedAnswer && approval.status === "approved" && (
                <span className="text-emerald-500">已通过</span>
              )}
              {approval.status === "rejected" && (
                <span className="text-red-400">已拒绝</span>
              )}
            </div>
          )}

          {/* 上下文数据预览 */}
          {!compact && approval.context_data && (
            <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-surface p-2 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(approval.context_data, null, 2)}
            </pre>
          )}
        </div>

        {/* 右侧操作 */}
        {isPending && onResolve && (
          <div className="flex shrink-0 flex-col gap-2">
            {/* ── choice 类型：选项列表 ── */}
            {typeKey === "choice" && options.length > 0 && (
              <div className="flex flex-col gap-1 mb-2">
                {options.map((opt, i) => (
                  <label
                    key={i}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition-colors",
                      selectedOption === i
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border hover:border-brand/40"
                    )}
                  >
                    <input
                      type="radio"
                      name={`choice-${approval.id}`}
                      checked={selectedOption === i}
                      onChange={() => setSelectedOption(i)}
                      className="accent-brand"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}

            {/* ── input/question 类型：输入框 ── */}
            {(typeKey === "input" || typeKey === "question") && (
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="请输入回答…"
                rows={2}
                className="mb-2 w-48 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
              />
            )}

            {/* ── 通用按钮 ── */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-400/40 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                onClick={() => handleResolve("approved")}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                {typeKey === "choice" ? "选择" : typeKey === "input" || typeKey === "question" ? "提交" : "通过"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleResolve("rejected")}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                拒绝
              </Button>
            </div>
          </div>
        )}

        {/* 已处理的时间 */}
        {!isPending && approval.resolved_at && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(approval.resolved_at).toLocaleString("zh-CN")}
          </span>
        )}
      </div>
    </div>
  );
}
