"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Loader2, CheckCircle2, XCircle, AlertCircle, RotateCcw, PauseCircle,
} from "lucide-react";
import type { TaskQueueItem, TaskQueueStatus } from "@/types/task-queue";

// ── 状态视觉配置 ──

const STATUS_CONFIG: Record<TaskQueueStatus, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  dotClass: string;
  textClass: string;
}> = {
  matching:   { icon: Loader2,     label: "匹配中...",   dotClass: "bg-blue-400 animate-pulse", textClass: "text-blue-400" },
  matched:    { icon: AlertCircle,  label: "待确认",     dotClass: "bg-amber",               textClass: "text-amber" },
  confirming:{ icon: Loader2,      label: "创建中...",   dotClass: "bg-violet animate-pulse",  textClass: "text-violet" },
  executing:  { icon: Loader2,      label: "执行中",     dotClass: "bg-emerald-400 animate-pulse", textClass: "text-emerald-400" },
  paused:     { icon: PauseCircle,  label: "已暂停",     dotClass: "bg-amber",               textClass: "text-amber" },
  completed:  { icon: CheckCircle2, label: "已完成",     dotClass: "bg-muted-foreground/40",   textClass: "text-muted-foreground" },
  failed:     { icon: XCircle,     label: "失败",       dotClass: "bg-red-400",              textClass: "text-red-400" },
};

interface TaskQueueItemCardProps {
  task: TaskQueueItem;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
}

export default function TaskQueueItemCard({
  task,
  isActive,
  onSelect,
  onRetry,
  onRemove,
}: TaskQueueItemCardProps) {
  const cfg = STATUS_CONFIG[task.status];
  const Icon = cfg.icon;
  const isSpinning = task.status === "matching" || task.status === "confirming" || task.status === "executing";

  // 截断用户输入用于展示
  const displayQuery = task.userQuery.length > 24 ? task.userQuery.slice(0, 24) + "..." : task.userQuery;

  // 格式化时间
  const timeStr = new Date(task.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-3.5 py-2.5 cursor-pointer transition-all",
        isActive
          ? "border-brand/40 bg-brand/5 shadow-sm"
          : "border-border/40 bg-card/30 hover:border-border hover:bg-card/60"
      )}
      onClick={() => onSelect(task.id)}
    >
      {/* 状态指示点 */}
      <span className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dotClass)} />

      {/* 主内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground truncate">{displayQuery}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn("flex items-center gap-1 text-[11px] font-medium", cfg.textClass)}>
            <Icon className={cn("h-3 w-3", isSpinning && "animate-spin")} />
            {cfg.label}
          </span>
          <span className="text-[10px] text-muted-foreground/50">{timeStr}</span>
        </div>
      </div>

      {/* 操作按钮（hover 时显示） */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {task.status === "failed" && onRetry && (
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-brand hover:bg-brand/10 transition-colors"
            onClick={(e) => { e.stopPropagation(); onRetry(task.id); }}
            title="重试"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        {(task.status === "completed" || task.status === "failed") && onRemove && (
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
            onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
            title="移除"
          >
            <XCircle className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* 活跃指示条 */}
      {isActive && (
        <motion.div
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand"
          layoutId="active-indicator"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
    </motion.div>
  );
}
