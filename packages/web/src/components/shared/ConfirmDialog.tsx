/** 确认弹框组件 */

"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, CheckCircle2, XCircle } from "lucide-react";

type ConfirmVariant = "danger" | "warning" | "info" | "success";

const VARIANT_CONFIG: Record<ConfirmVariant, { icon: React.ElementType; color: string; btnClass: string }> = {
  danger: { icon: XCircle, color: "text-destructive", btnClass: "bg-destructive text-white hover:opacity-90" },
  warning: { icon: AlertTriangle, color: "text-amber", btnClass: "bg-amber text-white hover:opacity-90" },
  info: { icon: Info, color: "text-brand", btnClass: "bg-brand text-brand-foreground hover:opacity-90" },
  success: { icon: CheckCircle2, color: "text-emerald-500", btnClass: "bg-emerald-500 text-white hover:opacity-90" },
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  className?: string;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  variant = "info",
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  loading,
  className,
}: ConfirmDialogProps) {
  if (!open) return null;

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className={cn(
          "animate-scale-in w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-surface", config.color)}>
            <Icon className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        </div>

        <p className="mb-5 text-sm text-muted-foreground leading-relaxed">{message}</p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={loading} className={config.btnClass}>
            {loading && <span className="mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
