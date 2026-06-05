"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { APIResponse, Task, TaskCreate, Step } from "@/lib/types";
import {
  Plus, Loader2, Clock, Zap, AlertCircle, CheckCircle2,
  Loader, XCircle, Play, Cpu, Sparkles, Workflow, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "running" | "pending" | "completed" | "failed";

const FILTER_TABS: { key: FilterKey; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "全部", icon: Zap },
  { key: "running", label: "执行中", icon: Loader },
  { key: "pending", label: "待执行", icon: Clock },
  { key: "completed", label: "已完成", icon: CheckCircle2 },
  { key: "failed", label: "失败", icon: XCircle },
];

const MODE_CONFIG: Record<string, { label: string; icon: React.ElementType; tagClass: string; borderClass: string }> = {
  workflow: { label: "工作流", icon: Workflow, tagClass: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30", borderClass: "border-l-emerald-400" },
  dynamic_assembly: { label: "动态组装", icon: Sparkles, tagClass: "bg-cyan-500/10 text-cyan-400 border-cyan-400/30", borderClass: "border-l-cyan-400" },
  bare_agent: { label: "Agent", icon: Cpu, tagClass: "bg-amber/10 text-amber border-amber/30", borderClass: "border-l-amber" },
};
const DEFAULT_MODE = { label: "", icon: Cpu, tagClass: "bg-muted text-muted-foreground border-border", borderClass: "border-l-muted-foreground" };

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

/** 从 context.dag 或 output_data 中提取节点状态 */
function getNodeProgress(task: Task): { nodes: string[]; statuses: Record<string, string> } {
  const dag = task.context?.dag as { nodes: { id: string }[] } | undefined;
  const nodeIds = dag?.nodes?.map(n => n.id) ?? [];
  const statuses: Record<string, string> = {};

  // 从 output_data 或 steps 推断节点状态
  const outputs = task.output_data as Record<string, unknown> | null;
  if (outputs) {
    for (const nodeId of nodeIds) {
      const nodeOut = outputs[nodeId] as { status?: string } | undefined;
      if (nodeOut) {
        statuses[nodeId] = nodeOut.status === "completed" ? "completed" :
          nodeOut.status === "failed" ? "failed" : "running";
      }
    }
  }

  // running 状态默认全部 pending（除非有完成记录）
  if (task.status === "running" && Object.keys(statuses).length === 0) {
    for (const nodeId of nodeIds) statuses[nodeId] = "pending";
  }
  if (task.status === "completed" && Object.keys(statuses).length === 0) {
    for (const nodeId of nodeIds) statuses[nodeId] = "completed";
  }

  return { nodes: nodeIds, statuses };
}

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [inputData, setInputData] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get<APIResponse<Task[]>>("/tasks");
      setTasks(res.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // 5s 轮询 running/pending 任务
  useEffect(() => {
    const hasActive = tasks.some(t => t.status === "running" || t.status === "pending");
    if (!hasActive) return;
    const timer = setInterval(fetchTasks, 5000);
    return () => clearInterval(timer);
  }, [tasks, fetchTasks]);

  const filtered = useMemo(() => {
    if (activeFilter === "all") return tasks;
    return tasks.filter(t => t.status === activeFilter);
  }, [tasks, activeFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const body: TaskCreate = {
        title: title.trim(),
        input_data: inputData.trim() ? JSON.parse(inputData) : null,
      };
      const res = await api.post<APIResponse<Task>>("/tasks", body);
      const taskId = res.data?.id;
      if (taskId) {
        try { await api.post(`/tasks/${taskId}/start`); } catch {}
        router.push(`/tasks/${taskId}`);
      }
      setShowCreate(false);
      setTitle("");
      setInputData("");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中…</div>;
  }
  if (error) {
    return <div className="mx-6 mt-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">任务</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">查看和管理任务执行</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />新建任务
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {FILTER_TABS.map(tab => {
            const Icon = tab.icon;
            const count = counts[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
                  activeFilter === tab.key ? "bg-brand-muted text-brand" : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                )}
              >
                <Icon className="h-3.5 w-3.5" />{tab.label}
                {count > 0 && (
                  <span className={cn("min-w-[18px] rounded-full px-1 text-[10px] font-semibold text-center", activeFilter === tab.key ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-6">
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface"><Zap className="h-8 w-8" /></div>
            <p className="mb-1 text-base font-medium">暂无任务</p>
            <p className="mb-4 text-sm">创建你的第一个执行任务</p>
            <Button onClick={() => setShowCreate(true)}>新建任务</Button>
          </div>
        )}

        {tasks.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p className="text-sm">没有{FILTER_TABS.find(t => t.key === activeFilter)?.label}的任务</p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((task) => {
              const mode = MODE_CONFIG[task.execution_mode] ?? DEFAULT_MODE;
              const ModeIcon = mode.icon;
              const { nodes, statuses } = getNodeProgress(task);

              return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="group block"
                >
                  <div className={cn(
                    "rounded-xl border border-border bg-card p-4 transition-all hover:shadow-md hover:border-brand/30 hover:-translate-y-0.5 border-l-4",
                    mode.borderClass
                  )}>
                    {/* Top row */}
                    <div className="flex items-center justify-between mb-2">
                      <StatusBadge status={task.status} />
                      <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", mode.tagClass)}>
                        <ModeIcon className="h-3 w-3" />{mode.label}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="mb-2 text-sm font-semibold text-foreground group-hover:text-brand transition-colors line-clamp-2">
                      {task.title}
                    </h3>

                    {/* Progress dots */}
                    {nodes.length > 0 && (
                      <div className="flex items-center gap-1.5 mb-2">
                        {nodes.map((nodeId, i) => {
                          const s = statuses[nodeId] || "pending";
                          return (
                            <div key={nodeId} className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  s === "completed" && "bg-emerald-400",
                                  s === "running" && "bg-brand animate-pulse",
                                  s === "failed" && "bg-red-400",
                                  s === "pending" && "bg-muted-foreground/30",
                                )}
                                title={`${nodeId}: ${s}`}
                              />
                              {i < nodes.length - 1 && (
                                <span className={cn("w-2 h-px", statuses[nodes[i + 1]] === "completed" ? "bg-emerald-400/40" : "bg-muted-foreground/20")} />
                              )}
                            </div>
                          );
                        })}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {nodes.filter(n => statuses[n] === "completed").length}/{nodes.length}
                        </span>
                      </div>
                    )}

                    {/* Bottom */}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatRelativeTime(task.created_at)}</span>
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-brand flex items-center gap-0.5">查看<ArrowRight className="h-3 w-3" /></span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div className="animate-scale-in w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-base font-semibold text-foreground">新建任务</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task-title">标题 *</Label>
                <Input id="task-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：修复登录页bug" autoFocus required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-input">输入数据 (JSON)</Label>
                <Textarea id="task-input" value={inputData} onChange={e => setInputData(e.target.value)} placeholder='{"key": "value"}' rows={3} className="font-mono text-sm" />
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-hover/30 text-[11px] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                系统将自动匹配工作流或组装节点执行
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
                <Button type="submit" disabled={submitting || !title.trim()}>
                  {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}创建并执行
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
