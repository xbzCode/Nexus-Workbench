/** TaskHeader — 紧凑标题栏：单行标题+状态+操作 + DAG进度条 */

"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { Task, DAGDefinition } from "@/lib/types";
import {
  Play, Pause, XCircle, ArrowLeft, Clock,
  Workflow, Cpu, Sparkles, WifiOff,
  ChevronRight, CheckCircle2, AlertCircle, Loader2, Activity,
} from "lucide-react";

const MODE_INFO: Record<string, { label: string; icon: React.ElementType; color: string; tagClass: string }> = {
  workflow: { label: "Workflow", icon: Workflow, color: "text-emerald-400", tagClass: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30" },
  dynamic_assembly: { label: "Dynamic", icon: Sparkles, color: "text-violet", tagClass: "bg-violet/10 text-violet border-violet/30" },
  bare_agent: { label: "Agent", icon: Cpu, color: "text-amber", tagClass: "bg-amber/10 text-amber border-amber/30" },
};

interface TaskHeaderProps {
  task: Task;
  dag: DAGDefinition | null;
  stepStatusMap: Record<string, string>;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  isConnected: boolean;
  actionLoading: string | null;
  onAction: (action: string, endpoint: string) => void;
}

export default function TaskHeader({
  task, dag, stepStatusMap,
  totalNodes, completedNodes, failedNodes,
  isConnected, actionLoading, onAction,
}: TaskHeaderProps) {
  const router = useRouter();
  const modeInfo = MODE_INFO[task.execution_mode ?? ""] ?? MODE_INFO.bare_agent;
  const ModeIcon = modeInfo.icon;
  const isRunning = task.status === "running";
  const isPaused = task.status === "paused";

  return (
    <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-5 py-3">
      {/* 第一行：面包屑 + 标题 + 状态 + 操作 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="-ml-1.5 h-8 w-8 shrink-0" onClick={() => router.push("/tasks")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 flex items-center gap-2.5 flex-wrap">
          <h2 className="text-base font-semibold tracking-tight truncate">{task.title}</h2>
          <StatusBadge status={task.status} />
          <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", modeInfo.tagClass)}>
            <ModeIcon className="h-3 w-3" />{modeInfo.label}
          </span>
          {(isRunning || isPaused) && (
            <span className="flex items-center gap-1.5 text-xs">
              {isConnected
                ? (<><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span><span className="text-emerald-400 font-medium">实时</span></>)
                : (<><WifiOff className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">离线</span></>)
              }
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 shrink-0">
          {task.status === "pending" && (
            <Button size="sm" onClick={() => onAction("start", "start")} disabled={actionLoading === "start"}>
              {actionLoading === "start" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3" />}启动
            </Button>
          )}
          {isRunning && (
            <>
              <Button variant="outline" size="sm" onClick={() => onAction("pause", "pause")} disabled={actionLoading === "pause"}>
                {actionLoading === "pause" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}暂停
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onAction("cancel", "cancel")} disabled={actionLoading === "cancel"}>
                {actionLoading === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}取消
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button size="sm" onClick={() => onAction("resume", "resume")} disabled={actionLoading === "resume"}>
                {actionLoading === "resume" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}恢复
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onAction("cancel", "cancel")} disabled={actionLoading === "cancel"}>
                {actionLoading === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}取消
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 第二行：时间元信息 */}
      <div className="ml-9 flex items-center gap-x-4 gap-y-0 mt-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />创建于 {new Date(task.created_at).toLocaleString("zh-CN")}</span>
        {task.started_at && <span>启动: {new Date(task.started_at).toLocaleString("zh-CN")}</span>}
        {task.completed_at && <span>完成: {new Date(task.completed_at).toLocaleString("zh-CN")}</span>}
      </div>

      {/* 第三行：DAG 进度条 */}
      {dag && dag.nodes.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          <Activity className="h-3 w-3 text-muted-foreground/50 shrink-0 mr-0.5" />
          {dag.nodes.map((node, i) => {
            const ns = stepStatusMap[node.id] || "pending";
            const nodeLabel = node.display_name || node.definition_id || node.id;
            return (
              <div key={node.id} className="flex items-center gap-1 shrink-0">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  ns === "completed" && "border-emerald-400/30 text-emerald-400 bg-emerald-500/5",
                  ns === "running" && "border-brand/40 text-brand bg-brand/5",
                  ns === "failed" && "border-red-400/30 text-red-400 bg-red-500/5",
                  ns === "pending" && "border-border text-muted-foreground/60",
                  ns === "waiting_approval" && "border-amber/30 text-amber bg-amber-muted/30",
                )}>
                  {ns === "completed"
                    ? <CheckCircle2 className="h-3 w-3" />
                    : ns === "running"
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : ns === "failed"
                        ? <XCircle className="h-3 w-3" />
                        : ns === "waiting_approval"
                          ? <AlertCircle className="h-3 w-3" />
                          : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />}
                  {nodeLabel}
                </span>
                {i < dag.nodes.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/20 shrink-0" />}
              </div>
            );
          })}
          {(isRunning || isPaused || task.status === "completed" || task.status === "failed") && totalNodes > 0 && (
            <span className="shrink-0 ml-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              {task.status === "failed"
                ? `${completedNodes}/${totalNodes} (${failedNodes} failed)`
                : `${completedNodes}/${totalNodes}`
              }
            </span>
          )}
        </div>
      )}
    </div>
  );
}
