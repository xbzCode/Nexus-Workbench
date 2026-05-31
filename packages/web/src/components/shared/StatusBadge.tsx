"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  pending:    { label: "待执行", variant: "outline", className: "border-amber/40 bg-amber-muted text-amber" },
  running:    { label: "执行中", variant: "outline", className: "border-brand/40 bg-brand-muted text-brand" },
  completed:  { label: "已完成", variant: "outline", className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-500" },
  failed:     { label: "失败",   variant: "destructive", className: "" },
  cancelled:  { label: "已取消", variant: "secondary", className: "" },
  skipped:    { label: "已跳过", variant: "secondary", className: "" },
  approved:   { label: "已通过", variant: "outline", className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-500" },
  rejected:   { label: "已拒绝", variant: "destructive", className: "" },
  draft:      { label: "草稿",   variant: "secondary", className: "" },
  published:  { label: "已发布", variant: "default", className: "" },
  archived:   { label: "已归档", variant: "secondary", className: "" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const, className: "" };

  return (
    <Badge variant={config.variant} className={cn("text-[11px]", config.className, className)}>
      {status === "running" && (
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse-soft" />
      )}
      {config.label}
    </Badge>
  );
}
