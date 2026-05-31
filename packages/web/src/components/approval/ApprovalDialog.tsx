/** 审批弹框 — 用于在弹窗中展示审批详情并操作 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import StatusBadge from "@/components/shared/StatusBadge";
import type { Approval } from "@/lib/types";
import { CheckCircle2, XCircle, ShieldCheck, Clock, AlertTriangle, Zap } from "lucide-react";

const URGENCY_STYLE: Record<string, { bg: string; icon: React.ElementType }> = {
  auto_decidable: { bg: "bg-emerald-500/10 text-emerald-600", icon: Zap },
  normal: { bg: "bg-brand/10 text-brand", icon: Clock },
  high: { bg: "bg-amber/10 text-amber", icon: AlertTriangle },
  critical: { bg: "bg-red-500/10 text-red-500", icon: AlertTriangle },
};

interface ApprovalDialogProps {
  approval: Approval;
  onResolve: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  onClose: () => void;
}

export function ApprovalDialog({ approval, onResolve, onClose }: ApprovalDialogProps) {
  const [rejectConfirm, setRejectConfirm] = useState(false);
  const isPending = approval.status === "pending";
  const urgency = URGENCY_STYLE[approval.urgency] ?? URGENCY_STYLE.normal;
  const UrgencyIcon = urgency.icon;
  const isAutoDecided = approval.urgency === "auto_decidable" && approval.status === "approved";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <StatusBadge status={approval.status} />
              <h2 className="text-lg font-semibold text-foreground">{approval.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-muted-foreground"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs">
                <ShieldCheck className="h-3 w-3" />
                来源: {approval.source}
              </span>
              <span className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-xs", urgency.bg)}>
                <UrgencyIcon className="h-3 w-3" />
                {approval.urgency === "auto_decidable"
                  ? "可自动决定"
                  : approval.urgency === "normal"
                  ? "普通"
                  : approval.urgency === "high"
                  ? "紧急"
                  : "严重"}
              </span>
              {approval.type && (
                <span className="rounded-md bg-muted px-2 py-1 text-xs">{approval.type}</span>
              )}
              {isAutoDecided && (
                <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-500 font-medium">
                  已自动批准
                </span>
              )}
            </div>

            {approval.description && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">描述</p>
                <p className="text-sm text-foreground">{approval.description}</p>
              </div>
            )}

            {approval.context_data && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">上下文数据</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-muted-foreground border border-border">
                  {JSON.stringify(approval.context_data, null, 2)}
                </pre>
              </div>
            )}

            {approval.validation_result && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">验证结果</p>
                <pre className="max-h-32 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-muted-foreground border border-border">
                  {JSON.stringify(approval.validation_result, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Footer */}
          {isPending && (
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setRejectConfirm(true)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                拒绝
              </Button>
              <Button
                onClick={() => onResolve(approval.id, "approved")}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                批准
              </Button>
            </div>
          )}

          {!isPending && (
            <div className="flex items-center justify-end border-t border-border px-6 py-4">
              <span className="text-xs text-muted-foreground">
                {approval.status === "approved" ? "已批准" : "已拒绝"}
                {approval.resolved_at && ` · ${new Date(approval.resolved_at).toLocaleString("zh-CN")}`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Reject confirm */}
      {rejectConfirm && (
        <ConfirmDialog
          open={rejectConfirm}
          variant="danger"
          title="确认拒绝"
          message={`确定要拒绝审批「${approval.title}」吗？此操作不可撤销。`}
          confirmLabel="确认拒绝"
          onConfirm={() => {
            onResolve(approval.id, "rejected");
            setRejectConfirm(false);
          }}
          onCancel={() => setRejectConfirm(false)}
        />
      )}
    </>
  );
}
