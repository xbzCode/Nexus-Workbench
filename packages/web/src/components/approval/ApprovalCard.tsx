/** 审批卡片组件 — 支持 confirm/choice/input 三种审批类型
 * 
 * - confirm: 确认操作 → 通过/拒绝按钮
 * - choice: 多选一 → 选项单选按钮 + 确认按钮
 * - input: 开放输入 → 文本输入框 + 提交按钮
 */

"use client";

import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { Approval, ApprovalResolve } from "@/lib/types";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Clock,
  ListChecks,
  MessageSquare,
  HelpCircle,
  Send,
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
          </div>

          {!compact && approval.description && (
            <p className="mb-3 text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap leading-relaxed">
              {approval.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            <span className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5", typeConf.color)}>
              <TypeIcon className="h-3 w-3" />
              {typeConf.label}
            </span>
          </div>

          {/* 已处理结果 */}
          {!isPending && !compact && resolvedResult && (
            <div className="mt-2 rounded-lg bg-surface p-2 text-xs text-muted-foreground">
              {resolvedChoice && <span>选择: <span className="text-foreground font-medium">{resolvedChoice}</span></span>}
              {resolvedAnswer && <span>回答: <span className="text-foreground font-medium">{resolvedAnswer}</span></span>}
              {!resolvedChoice && !resolvedAnswer && approval.status === "approved" && <span className="text-emerald-500">已通过</span>}
              {approval.status === "rejected" && <span className="text-red-400">已拒绝</span>}
            </div>
          )}
        </div>

        {/* 右侧操作区 */}
        {isPending && onResolve && (
          <div className="flex shrink-0 flex-col gap-2 min-w-[180px]">
            {/* choice 类型：选项列表 */}
            {typeKey === "choice" && options.length > 0 && (
              <div className="flex flex-col gap-1">
                {options.map((opt, i) => (
                  <label
                    key={i}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors",
                      selectedOption === i
                        ? "border-brand bg-brand/10 text-brand font-medium"
                        : "border-border hover:border-brand/40 text-foreground"
                    )}
                  >
                    <input
                      type="radio"
                      name={`choice-${approval.id}`}
                      checked={selectedOption === i}
                      onChange={() => setSelectedOption(i)}
                      className="accent-brand shrink-0"
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* input 类型：文本框 */}
            {typeKey === "input" && (
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="输入你的回答…"
                rows={3}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none resize-none"
              />
            )}

            {/* question 类型：文本框（更大） */}
            {typeKey === "question" && (
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="请输入回答…"
                rows={3}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none resize-none"
              />
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
              {(typeKey === "input" || typeKey === "question") && (
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleResolve("approved")}
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  提交
                </Button>
              )}
              {typeKey === "choice" && options.length > 0 && (
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleResolve("approved")}
                >
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  确认选择
                </Button>
              )}
              {typeKey === "confirm" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-emerald-400/40 text-emerald-500 hover:bg-emerald-500/10"
                    onClick={() => handleResolve("approved")}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    通过
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => handleResolve("rejected")}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    拒绝
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 已处理时间 */}
        {!isPending && approval.resolved_at && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(approval.resolved_at).toLocaleString("zh-CN")}
          </span>
        )}
      </div>
    </div>
  );
}
