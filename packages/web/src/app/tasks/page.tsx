"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { APIResponse, Task, NodeInstance, EdgeDef } from "@/lib/types";
import {
  Plus, Loader2, Clock, Zap, AlertCircle, CheckCircle2,
  Loader, XCircle, Cpu, Sparkles, Workflow, ArrowRight,
  Search, ArrowUpDown, ChevronRight, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "running" | "pending" | "completed" | "failed";
type SortOrder = "newest" | "oldest";

const FILTER_TABS: { key: FilterKey; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All", icon: Zap },
  { key: "running", label: "Running", icon: Loader },
  { key: "pending", label: "Pending", icon: Clock },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
  { key: "failed", label: "Failed", icon: XCircle },
];

const MODE_CONFIG: Record<string, { label: string; icon: React.ElementType; tagClass: string; accentColor: string }> = {
  workflow: { label: "Workflow", icon: Workflow, tagClass: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30", accentColor: "var(--color-emerald-400, #34d399)" },
  dynamic_assembly: { label: "Dynamic", icon: Sparkles, tagClass: "bg-violet/10 text-violet border-violet/30", accentColor: "var(--color-violet, #7c3aed)" },
  bare_agent: { label: "Agent", icon: Cpu, tagClass: "bg-amber/10 text-amber border-amber/30", accentColor: "var(--color-amber, #d97706)" },
};
const DEFAULT_MODE = { label: "", icon: Cpu, tagClass: "bg-muted text-muted-foreground border-border", accentColor: "var(--color-muted-foreground)" };

/* ── Helpers ── */

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

function formatAbsoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** Extract DAG pipeline info with topological ordering */
interface PipelineNode {
  id: string;
  label: string;
  status: "completed" | "running" | "failed" | "pending";
}

/** Clean up a definition_id / node name for display */
function cleanLabel(raw: string): string {
  return raw
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function getPipeline(task: Task): PipelineNode[] {
  // 优先使用 API 联查填充的 task.dag，fallback 到 context.dag（兼容旧数据）
  const dag = (task.dag ?? task.context?.dag) as { nodes: NodeInstance[]; edges: EdgeDef[] } | undefined;
  if (!dag?.nodes?.length) return [];

  const nodes = dag.nodes;
  const edges = dag.edges ?? [];

  // Build adjacency for topo sort
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const n of nodes) {
    inDegree[n.id] = 0;
    adj[n.id] = [];
  }
  for (const e of edges) {
    if (adj[e.source_id]) {
      adj[e.source_id].push(e.target_id);
      inDegree[e.target_id] = (inDegree[e.target_id] ?? 0) + 1;
    }
  }

  // Kahn's topo sort
  const sorted: string[] = [];
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree[n.id] ?? 0) === 0) queue.push(n.id);
  }
  while (queue.length > 0) {
    const curr = queue.shift()!;
    sorted.push(curr);
    for (const next of adj[curr] ?? []) {
      inDegree[next] = (inDegree[next] ?? 1) - 1;
      if (inDegree[next] === 0) queue.push(next);
    }
  }
  // Fallback: add any unsorted nodes
  for (const n of nodes) {
    if (!sorted.includes(n.id)) sorted.push(n.id);
  }

  // Build id→node lookup for definition_id
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Build status map
  const outputs = task.output_data as Record<string, unknown> | null;
  const statusMap: Record<string, PipelineNode["status"]> = {};
  if (outputs) {
    for (const n of nodes) {
      const nodeOut = outputs[n.id] as { status?: string } | undefined;
      if (nodeOut?.status === "completed") statusMap[n.id] = "completed";
      else if (nodeOut?.status === "failed") statusMap[n.id] = "failed";
      else if (nodeOut) statusMap[n.id] = "running";
    }
  }
  if (task.status === "running" && Object.keys(statusMap).length === 0) {
    for (const n of nodes) statusMap[n.id] = "pending";
  }
  if (task.status === "completed" && Object.keys(statusMap).length === 0) {
    for (const n of nodes) statusMap[n.id] = "completed";
  }

  return sorted.map(id => {
    const node = nodeMap.get(id);
    // 优先使用 display_name，其次 cleanLabel(definition_id)，最后用 id
    const rawLabel = node?.display_name || (node?.definition_id ? cleanLabel(node.definition_id) : id);
    return {
      id,
      label: rawLabel,
      status: statusMap[id] ?? "pending",
    };
  });
}

/** Get user input summary from input_data */
function getInputSummary(task: Task): string | null {
  const input = task.input_data as Record<string, unknown> | null;
  if (!input) return null;
  const userInput = input.user_input as string | undefined;
  if (typeof userInput === "string" && userInput.trim()) {
    return userInput.trim().length > 80 ? userInput.trim().slice(0, 77) + "..." : userInput.trim();
  }
  return null;
}

/* ── Animation ── */

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 0.61, 0.36, 1] as const } },
};

/* ── Skeleton ── */

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card animate-pulse overflow-hidden">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 w-14 rounded bg-muted" />
          <div className="h-4 w-14 rounded bg-muted" />
        </div>
        <div className="h-3.5 w-4/5 rounded bg-muted mb-1.5" />
        <div className="h-3 w-1/2 rounded bg-muted mb-3" />
        <div className="flex items-center gap-1">
          <div className="h-5 w-12 rounded bg-muted" />
          <div className="h-3 w-3 text-muted">→</div>
          <div className="h-5 w-14 rounded bg-muted" />
          <div className="h-3 w-3 text-muted">→</div>
          <div className="h-5 w-10 rounded bg-muted" />
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-t border-border/40">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-3 w-10 rounded bg-muted" />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

/* ── Mini Pipeline ── */

const NODE_STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  running: "bg-brand/15 text-brand border-brand/25",
  failed: "bg-red-500/15 text-red-400 border-red-500/25",
  pending: "bg-muted/50 text-muted-foreground border-border/60",
};

function MiniPipeline({ pipeline }: { pipeline: PipelineNode[] }) {
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin">
      {pipeline.map((node, i) => (
        <span key={node.id} className="flex items-center gap-0.5 shrink-0">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border leading-tight whitespace-nowrap",
              NODE_STATUS_STYLE[node.status] ?? NODE_STATUS_STYLE.pending,
              node.status === "running" && "animate-pulse-soft",
            )}
          >
            {node.label}
          </span>
          {i < pipeline.length - 1 && (
            <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />
          )}
        </span>
      ))}
    </div>
  );
}

/* ── Agent Mode Indicator ── */

function AgentIndicator({ task }: { task: Task }) {
  const inputSummary = getInputSummary(task);

  return (
    <div className="flex items-start gap-1.5 rounded-md bg-surface/60 px-2 py-1.5">
      <Bot className="h-3.5 w-3.5 text-amber shrink-0 mt-px" />
      <span className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
        {inputSummary || "Agent executing..."}
      </span>
    </div>
  );
}

/* ── Main Page ── */

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get<APIResponse<Task[]>>("/tasks");
      setTasks(res.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    const hasActive = tasks.some(t => t.status === "running" || t.status === "pending");
    if (!hasActive) return;
    const timer = setInterval(fetchTasks, 5000);
    return () => clearInterval(timer);
  }, [tasks, fetchTasks]);

  const filtered = useMemo(() => {
    let result = tasks;
    if (activeFilter !== "all") result = result.filter(t => t.status === activeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) || t.execution_mode?.toLowerCase().includes(q) || t.workflow_name?.toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
    return result;
  }, [tasks, activeFilter, searchQuery, sortOrder]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  if (error) {
    return (
      <div className="mx-5 mt-5 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-5 py-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-foreground tracking-tight">Tasks</h1>
            <span className="text-[12px] text-muted-foreground/60">{tasks.length} total</span>
          </div>
          <Button size="sm" onClick={() => router.push("/")} className="shadow-sm gap-1.5">
            <Plus className="h-3.5 w-3.5" />New Task
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="pl-8 h-7 text-[13px] bg-surface border-border/60 focus:border-brand/40"
            />
          </div>

          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface border border-border/40">
            {FILTER_TABS.map(tab => {
              const Icon = tab.icon;
              const count = counts[tab.key] ?? 0;
              const isActive = activeFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveFilter(tab.key)}
                  className={cn(
                    "relative flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-200",
                    isActive
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-3 w-3", isActive && tab.key === "running" && "animate-spin-slow")} />
                  {tab.label}
                  {count > 0 && (
                    <span className={cn(
                      "min-w-[16px] rounded-full px-1 text-[9px] font-semibold text-center leading-[16px]",
                      isActive ? "bg-brand/15 text-brand" : "bg-muted text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setSortOrder(prev => prev === "newest" ? "oldest" : "newest")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            title={sortOrder === "newest" ? "Newest first" : "Oldest first"}
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortOrder === "newest" ? "Newest" : "Oldest"}
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <SkeletonGrid />}

        {!loading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-border/60">
              <Zap className="h-7 w-7 text-brand/40" />
            </div>
            <p className="mb-1 text-sm font-medium">No tasks yet</p>
            <p className="mb-4 text-[13px] text-muted-foreground/60">Describe what you need, we&apos;ll handle the rest</p>
            <Button size="sm" onClick={() => router.push("/")} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />Create Task
            </Button>
          </div>
        )}

        {!loading && tasks.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="mb-2 h-7 w-7 opacity-40" />
            <p className="text-[13px]">No {FILTER_TABS.find(t => t.key === activeFilter)?.label.toLowerCase()} tasks</p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {!loading && filtered.length > 0 && (
            <motion.div
              key={activeFilter}
              className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {filtered.map((task) => {
                const mode = MODE_CONFIG[task.execution_mode] ?? DEFAULT_MODE;
                const ModeIcon = mode.icon;
                const pipeline = getPipeline(task);
                const isWorkflow = task.execution_mode === "workflow" || task.execution_mode === "dynamic_assembly";

                return (
                  <motion.div key={task.id} variants={cardVariants} layout>
                    <Link href={`/tasks/${task.id}`} className="group block">
                      <div className={cn(
                        "relative flex flex-col rounded-xl border border-border bg-card transition-all duration-200 overflow-hidden",
                        "hover:border-brand/25 hover:shadow-[0_4px_20px_-4px_color-mix(in_srgb,var(--color-brand)_10%,transparent)]",
                        task.status === "running" && "border-brand/15 bg-brand/[0.02]"
                      )}>
                        {/* Mode accent line — top */}
                        <div
                          className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          style={{ background: mode.accentColor }}
                        />

                        {/* Card body */}
                        <div className="flex-1 p-3">
                          {/* Top row: status + mode */}
                          <div className="flex items-center justify-between mb-1.5">
                            <StatusBadge status={task.status} />
                            {mode.label && (
                              <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", mode.tagClass)}>
                                <ModeIcon className="h-2.5 w-2.5" />{mode.label}
                              </span>
                            )}
                          </div>

                          {/* Title */}
                          <h3 className="mb-2 text-[13px] font-semibold text-foreground group-hover:text-brand transition-colors duration-200 line-clamp-1 leading-snug">
                            {task.title}
                          </h3>

                          {/* Pipeline or Agent indicator */}
                          <div className="mt-2">
                            {isWorkflow ? (
                              <>
                                {/* Workflow/Dynamic name line — 统一高度 */}
                                <div className="flex items-center gap-1 mb-1.5 text-[11px]">
                                  {task.execution_mode === "workflow" ? (
                                    <>
                                      <Workflow className="h-3 w-3 shrink-0 text-emerald-400/80" />
                                      <span className="line-clamp-1 text-emerald-400/80">{task.workflow_name || "Workflow"}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="h-3 w-3 shrink-0 text-violet/80" />
                                      <span className="line-clamp-1 text-violet/80">Dynamic Assembly</span>
                                    </>
                                  )}
                                </div>
                                {pipeline.length > 0 ? (
                                  <MiniPipeline pipeline={pipeline} />
                                ) : (
                                  <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/5 px-2 py-1.5 border border-emerald-500/10">
                                    <Workflow className="h-3.5 w-3.5 text-emerald-400/60 shrink-0" />
                                    <span className="text-[11px] text-muted-foreground/60 line-clamp-1">
                                      Workflow pending
                                    </span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <AgentIndicator task={task} />
                            )}
                          </div>
                        </div>

                        {/* Bottom bar */}
                        <div className="flex items-center justify-between px-3 py-2 border-t border-border/40">
                          <span
                            className="flex items-center gap-1 text-[11px] text-muted-foreground/60"
                            title={formatAbsoluteTime(task.created_at)}
                          >
                            <Clock className="h-3 w-3" />{formatRelativeTime(task.created_at)}
                          </span>
                          <span className="flex items-center gap-0.5 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-brand font-medium">
                            View<ArrowRight className="h-3 w-3" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
