"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { useSSE } from "@/hooks/useSSE";
import StatusBadge from "@/components/shared/StatusBadge";
import ApprovalCard from "@/components/approval/ApprovalCard";
import { Button } from "@/components/ui/button";
import type { APIResponse, Task, Step, Approval, DAGDefinition, ApprovalResolve } from "@/lib/types";
import {
  Loader2, Play, Pause, RotateCcw, XCircle, ArrowLeft, Clock,
  Workflow, Cpu, Sparkles, Wifi, WifiOff, Bell, ScrollText,
  Camera, Route, Star, Download, ChevronRight,
  FileText, FileCode, File, Folder, CheckCircle2, AlertCircle,
  ExternalLink, ListOrdered, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MODE_INFO: Record<string, { label: string; icon: React.ElementType; color: string; tagClass: string }> = {
  workflow: { label: "Workflow", icon: Workflow, color: "text-emerald-400", tagClass: "bg-emerald-500/10 text-emerald-400 border-emerald-400/30" },
  dynamic_assembly: { label: "Dynamic", icon: Sparkles, color: "text-violet", tagClass: "bg-violet/10 text-violet border-violet/30" },
  bare_agent: { label: "Agent", icon: Cpu, color: "text-amber", tagClass: "bg-amber/10 text-amber border-amber/30" },
};

type BottomTab = "log" | "approval" | "snapshots" | "paths" | "files";

interface FileEntry { path: string; size: number; modified_at: string; }
interface SnapshotItem { id: string; task_id: string; step_id?: string | null; type: string; git_commit_hash: string; git_diff?: string | null; untracked_files?: unknown[] | null; created_at: string; }
interface ExecutionPathItem { id: string; task_id: string; source: string; steps: Record<string, unknown>[] | null; total_duration: number | null; total_approvals: number; success: boolean; user_rating: number | null; precipitated_to: string | null; created_at: string; }

function formatDuration(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function getFileIcon(fp: string) {
  if (/\.(tsx?|jsx?|py)$/.test(fp)) return FileCode;
  if (/\.(json|yml|yaml|toml|xml|md|txt|log)$/.test(fp)) return FileText;
  return File;
}

const easeOut: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export default function TaskDetailPage() {
  const params = useParams(); const router = useRouter(); const id = params.id as string;
  const [task, setTask] = useState<Task | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [execPaths, setExecPaths] = useState<ExecutionPathItem[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BottomTab>("log");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [bottomPanelHeight, setBottomPanelHeight] = useState(220);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sseUrl = task?.status === "running" ? "/api/events/stream" : null;
  const { events: sseEvents, isConnected } = useSSE(sseUrl, { taskId: id });

  const fetchData = useCallback(async () => {
    try {
      const [t, st, ap, sn, ep, fl] = await Promise.all([
        api.get<APIResponse<Task>>(`/tasks/${id}`),
        api.get<APIResponse<Step[]>>(`/tasks/${id}/steps`),
        api.get<APIResponse<Approval[]>>(`/approvals?task_id=${id}`).catch(() => ({ data: null } as APIResponse<Approval[]>)),
        api.get<APIResponse<SnapshotItem[]>>(`/snapshots?task_id=${id}`).catch(() => ({ data: null } as APIResponse<SnapshotItem[]>)),
        api.get<APIResponse<ExecutionPathItem[]>>(`/execution-paths?task_id=${id}`).catch(() => ({ data: null } as APIResponse<ExecutionPathItem[]>)),
        api.get<APIResponse<FileEntry[]>>(`/tasks/${id}/files`).catch(() => ({ data: null } as APIResponse<FileEntry[]>)),
      ]);
      setTask(t.data); setSteps(st.data ?? []); setApprovals(ap.data ?? []);
      setSnapshots(sn.data ?? []); setExecPaths(ep.data ?? []); setFiles(fl.data ?? []);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (!task || task.status !== "running") return; const r = sseEvents.filter(e => e.event?.startsWith("dag:node_") || e.event?.startsWith("node:") || e.event?.startsWith("approval:") || e.event?.startsWith("task:")); if (r.length > 0) fetchData(); }, [sseEvents, task, fetchData]);
  useEffect(() => { if (pollRef.current) clearInterval(pollRef.current); if (task?.status === "running") pollRef.current = setInterval(fetchData, 5000); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [task?.status, fetchData]);
  useEffect(() => { if (!task || task.status !== "running") return; if (sseEvents.some(e => e.event === "approval:created")) setActiveTab("approval"); }, [sseEvents, task]);

  const handleAction = async (act: string, ep: string) => { setActionLoading(act); try { await api.post(`/tasks/${id}/${ep}`); await fetchData(); } catch {} finally { setActionLoading(null); } };
  const handleResolveApproval = useCallback(async (aid: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
    await api.post(`/approvals/${aid}/resolve`, { status, result: result ?? null }); await fetchData();
  }, [fetchData]);
  const handleRollback = async (sid: string) => { if (!confirm("Confirm rollback?")) return; setActionLoading("rollback"); try { await api.post(`/snapshots/${sid}/rollback`); await fetchData(); } catch {} finally { setActionLoading(null); } };
  const handlePrecipitate = async (pid: string) => { const n = prompt("Workflow name:"); if (!n?.trim()) return; setActionLoading("precipitate"); try { await api.post(`/execution-paths/${pid}/precipitate`, { workflow_name: n.trim() }); await fetchData(); } catch {} finally { setActionLoading(null); } };
  const toggleStep = (sid: string) => setExpandedSteps(prev => { const nx = new Set(prev); if (nx.has(sid)) nx.delete(sid); else nx.add(sid); return nx; });

  const dag = (task?.dag ?? task?.context?.dag ?? null) as DAGDefinition | null;
  const modeInfo = MODE_INFO[task?.execution_mode ?? ""] ?? MODE_INFO.bare_agent;
  const ModeIcon = modeInfo.icon;
  const isRunning = task?.status === "running";
  const isPaused = task?.status === "paused";
  const pendingApprovals = approvals.filter(a => a.status === "pending");

  const stepStatusMap: Record<string, string> = {};
  for (const s of steps) stepStatusMap[s.node_id] = s.status;
  const stepApprovalsMap: Record<string, Approval[]> = {};
  for (const a of approvals) {
    if (a.step_id) { if (!stepApprovalsMap[a.step_id]) stepApprovalsMap[a.step_id] = []; stepApprovalsMap[a.step_id].push(a); }
  }

  // 从 DAG 构建节点 ID → 显示名映射
  const nodeNameMap: Record<string, string> = {};
  if (dag) {
    for (const n of dag.nodes) {
      nodeNameMap[n.id] = n.display_name || n.definition_id || n.id;
    }
  }

  const BOTTOM_TABS: { key: BottomTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: "log", label: "Logs", icon: ScrollText },
    { key: "approval", label: "Approvals", icon: Bell, badge: pendingApprovals.length || undefined },
    { key: "snapshots", label: "Snapshots", icon: Camera, badge: snapshots.length || undefined },
    { key: "paths", label: "Paths", icon: Route, badge: execPaths.length || undefined },
    { key: "files", label: "Files", icon: FileText, badge: files.length || undefined },
  ];

  const logEvents = useMemo(() => {
    const evts: { event: string; data: Record<string, unknown>; ts?: string }[] = [];
    for (const s of steps) {
      evts.push({ event: s.status === "completed" ? "dag:node_completed" : s.status === "failed" ? "dag:node_failed" : "dag:node_started", data: { node_id: s.node_id, output: s.output_data, error: s.error }, ts: (s.completed_at ?? s.started_at) ?? undefined });
    }
    for (const a of approvals) {
      evts.push({ event: `approval:${a.status === "pending" ? "created" : "resolved"}`, data: { approval_id: a.id, type: a.type, title: a.title, status: a.status }, ts: a.created_at });
    }
    for (const e of sseEvents) evts.push({ event: e.event, data: e.data, ts: e.timestamp });
    return evts;
  }, [steps, approvals, sseEvents]);

  return (
    <div className="flex h-full flex-col">
      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading...</div>
      )}
      {(error || !task) && !loading && (
        <div className="m-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{error ?? "Task not found"}</div>
      )}

      {/* Header */}
      {task && !loading && (
      <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8 shrink-0" onClick={() => router.push("/tasks")}><ArrowLeft className="h-4 w-4" /></Button>
              <h2 className="text-lg font-semibold tracking-tight truncate">{task.title}</h2>
              <StatusBadge status={task.status} />
              <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", modeInfo.tagClass)}><ModeIcon className="h-3 w-3" />{modeInfo.label}</span>
              {(isRunning || isPaused) && (
                <span className="flex items-center gap-1.5 text-xs">
                  {isConnected
                    ? <><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span><span className="text-emerald-400 font-medium">Live</span></>
                    : <><WifiOff className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Offline</span></>
                  }
                </span>
              )}
            </div>
            <div className="ml-9 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(task.created_at).toLocaleString("zh-CN")}</span>
              {task.started_at && <span>Started: {new Date(task.started_at).toLocaleString("zh-CN")}</span>}
              {task.completed_at && <span>Done: {new Date(task.completed_at).toLocaleString("zh-CN")}</span>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {task.status === "pending" && <Button size="sm" onClick={() => handleAction("start", "start")} disabled={actionLoading === "start"}>{actionLoading === "start" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}Start</Button>}
            {isRunning && <>
              <Button variant="outline" size="sm" onClick={() => handleAction("pause", "pause")} disabled={actionLoading === "pause"}>{actionLoading === "pause" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}Pause</Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleAction("cancel", "cancel")} disabled={actionLoading === "cancel"}>{actionLoading === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}Cancel</Button>
            </>}
            {isPaused && <>
              <Button size="sm" onClick={() => handleAction("resume", "resume")} disabled={actionLoading === "resume"}>{actionLoading === "resume" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}Resume</Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleAction("cancel", "cancel")} disabled={actionLoading === "cancel"}>{actionLoading === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}Cancel</Button>
            </>}
          </div>
        </div>

        {/* DAG pipeline bar */}
        {dag && dag.nodes.length > 0 && (
          <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            <Activity className="h-3 w-3 text-muted-foreground/50 shrink-0 mr-1" />
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
                    {ns === "completed" ? <CheckCircle2 className="h-3 w-3" /> : ns === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : ns === "failed" ? <XCircle className="h-3 w-3" /> : ns === "waiting_approval" ? <AlertCircle className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />}
                    {nodeLabel}
                  </span>
                  {i < dag.nodes.length - 1 && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/20 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Body: main content area */}
      {task && !loading && (
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Step timeline area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-5 space-y-3">
            {steps.length === 0 && !isRunning && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface border border-border/40 mb-3">
                  <ListOrdered className="h-5 w-5 opacity-40" />
                </div>
                <p className="text-sm">No execution steps</p>
              </div>
            )}
            {steps.length === 0 && isRunning && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mb-3 h-6 w-6 animate-spin text-brand/60" />
                <p className="text-sm">Waiting for nodes...</p>
              </div>
            )}

            <AnimatePresence>
              {steps.map((step, i) => {
                const isExpanded = expandedSteps.has(step.id);
                const sApprovals = stepApprovalsMap[step.id] || [];
                const pendingSA = sApprovals.filter(a => a.status === "pending");
                const duration = formatDuration(step.started_at, step.completed_at);

                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: easeOut, delay: i * 0.04 }}
                    className={cn(
                      "rounded-xl border overflow-hidden transition-all duration-200",
                      step.status === "running" && "border-brand/25 bg-brand/[0.02]",
                      step.status === "waiting_approval" && "border-amber/15",
                      step.status === "failed" && "border-red-400/15 bg-red-500/[0.02]",
                      step.status === "completed" && "border-border bg-card",
                      step.status === "pending" && "border-border/60 bg-card opacity-40",
                      isExpanded && "shadow-sm",
                    )}
                  >
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover/30 transition-colors"
                      onClick={() => toggleStep(step.id)}
                    >
                      {/* Step number indicator */}
                      <div className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                        step.status === "completed" && "bg-emerald-500/10 text-emerald-400",
                        step.status === "running" && "bg-brand/10 text-brand",
                        step.status === "failed" && "bg-red-500/10 text-red-400",
                        step.status === "pending" && "bg-muted text-muted-foreground",
                        step.status === "waiting_approval" && "bg-amber/10 text-amber",
                      )}>
                        {i + 1}
                      </div>
                      <span className="flex-1 text-sm font-medium text-foreground">{nodeNameMap[step.node_id] || step.node_id}</span>
                      <StatusBadge status={step.status} />
                      {duration && <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0"><Clock className="h-3 w-3" />{duration}</span>}
                      {pendingSA.length > 0 && <span className="shrink-0 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber px-1.5 text-[10px] font-bold text-white">{pendingSA.length}</span>}
                      <motion.span
                        className="shrink-0 text-muted-foreground/40"
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </motion.span>
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: easeOut }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 space-y-3 border-t border-border/40 bg-surface-hover/[0.03]">
                            {step.error && (
                              <div className="mt-3 rounded-lg bg-red-500/5 border border-red-400/15 p-3">
                                <span className="mb-1 block text-xs font-medium text-red-400">Error</span>
                                <pre className="text-xs text-red-300/70 whitespace-pre-wrap break-all">{JSON.stringify(step.error, null, 2)}</pre>
                              </div>
                            )}

                            {step.input_data && (
                              <details className={cn("group mt-3", !step.error && "mt-3")}>
                                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Input Data</summary>
                                <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all">{JSON.stringify(step.input_data, null, 2)}</pre>
                              </details>
                            )}

                            {step.output_data && (
                              <details className="group" open>
                                <summary className="cursor-pointer text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors">Output</summary>
                                <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-emerald-400/70 whitespace-pre-wrap break-all">{JSON.stringify(step.output_data, null, 2)}</pre>
                              </details>
                            )}

                            {sApprovals.map(a => (
                              <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />
                            ))}

                            {!step.error && !step.input_data && !step.output_data && sApprovals.length === 0 && step.status === "running" && (
                              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Executing, waiting for output...</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Task I/O */}
            {task && (task.input_data || task.output_data) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {task.input_data && (
                  <div className="rounded-xl border border-border bg-card p-3">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Task Input</span>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-foreground/60 whitespace-pre-wrap break-all">{JSON.stringify(task.input_data, null, 2)}</pre>
                  </div>
                )}
                {task.output_data && (
                  <div className="rounded-xl border border-border bg-card p-3">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Task Output</span>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] text-emerald-400 whitespace-pre-wrap break-all">{JSON.stringify(task.output_data, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Tab Panel — resizable */}
        <div className="shrink-0 border-t border-border bg-background" style={{ height: bottomPanelHeight }}>
          {/* Tab bar */}
          <div className="flex items-center border-b border-border/60 bg-surface-hover/20 px-4">
            {BOTTOM_TABS.map(tab => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
                    activeTab === tab.key ? "text-brand" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <TabIcon className="h-3.5 w-3.5" />{tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span className={cn(
                      "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                      tab.key === "approval" ? "bg-amber" : "bg-muted-foreground/50"
                    )}>{tab.badge}</span>
                  )}
                  {activeTab === tab.key && (
                    <motion.span layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" transition={{ type: "spring", stiffness: 500, damping: 35 }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="overflow-y-auto px-5 py-3" style={{ height: bottomPanelHeight - 42 }}>
            {/* Logs */}
            {activeTab === "log" && (
              <div className="font-mono text-xs space-y-px">
                {logEvents.length === 0 && <div className="text-muted-foreground py-6 text-center text-[13px]">No logs yet</div>}
                {logEvents.map((evt, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-muted-foreground break-all hover:bg-surface-hover/40 rounded px-1 -mx-1 transition-colors">
                    <span className="shrink-0 text-muted-foreground/30 w-16 text-right tabular-nums">{evt.ts ? new Date(evt.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span>
                    <span className="shrink-0 opacity-20">&middot;</span>
                    <span className={cn(
                      "shrink-0 w-[140px] truncate font-medium",
                      evt.event.includes("completed") || evt.event.includes("resolved") ? "text-emerald-400/70" :
                      evt.event.includes("failed") || evt.event.includes("error") ? "text-red-400/70" :
                      evt.event.includes("started") ? "text-brand/70" :
                      evt.event.includes("approval") ? "text-amber/70" : ""
                    )}>
                      {evt.event}
                    </span>
                    <span className="text-foreground/50 break-all">{JSON.stringify(evt.data).slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Approvals */}
            {activeTab === "approval" && (
              <div className="space-y-3 max-w-2xl">
                {approvals.length === 0 && <div className="text-muted-foreground py-8 text-center"><Bell className="mx-auto mb-2 h-6 w-6 opacity-40" />No approvals</div>}
                {pendingApprovals.length > 0 && <div className="text-xs font-medium text-amber uppercase tracking-wider mb-2">Pending ({pendingApprovals.length})</div>}
                {pendingApprovals.map(a => <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />)}
                {approvals.filter(a => a.status !== "pending").length > 0 && (
                  <><div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 mt-4">Resolved</div>
                  {approvals.filter(a => a.status !== "pending").map(a => <ApprovalCard key={a.id} approval={a} compact />)}</>
                )}
              </div>
            )}

            {/* Snapshots */}
            {activeTab === "snapshots" && (
              <div className="space-y-2 max-w-2xl">
                {snapshots.length === 0 && <div className="text-muted-foreground py-8 text-center"><Camera className="mx-auto mb-2 h-6 w-6 opacity-40" />No snapshots</div>}
                {snapshots.map(snap => (
                  <div key={snap.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-muted-foreground">{snap.git_commit_hash.slice(0, 8)}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", snap.type === "pre_step" ? "bg-sky-500/10 text-sky-400" : "bg-emerald-500/10 text-emerald-400")}>{snap.type}</span>
                      <span className="text-muted-foreground">{new Date(snap.created_at).toLocaleString("zh-CN")}</span>
                    </div>
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handleRollback(snap.id)} disabled={actionLoading === "rollback"}>
                      {actionLoading === "rollback" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}Rollback
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Paths */}
            {activeTab === "paths" && (
              <div className="space-y-2 max-w-2xl">
                {execPaths.length === 0 && <div className="text-muted-foreground py-8 text-center"><Route className="mx-auto mb-2 h-6 w-6 opacity-40" />No execution paths</div>}
                {execPaths.map(ep => (
                  <div key={ep.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", ep.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{ep.success ? "Success" : "Failed"}</span>
                      <span className="text-muted-foreground">{ep.source} &middot; {ep.total_duration?.toFixed(1)}s &middot; {ep.total_approvals} approvals</span>
                      <div className="flex gap-0.5">{[1,2,3,4,5].map(r => <Star key={r} className={cn("h-3 w-3 cursor-pointer transition-colors", ep.user_rating && r <= ep.user_rating ? "text-amber fill-amber" : "text-muted-foreground/25 hover:text-amber/50")} onClick={() => { api.post(`/execution-paths/${ep.id}/rate`, { rating: r }); fetchData(); }} />)}</div>
                    </div>
                    {!ep.precipitated_to && <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handlePrecipitate(ep.id)}><Download className="h-3 w-3 mr-1" />Save</Button>}
                  </div>
                ))}
              </div>
            )}

            {/* Files */}
            {activeTab === "files" && (
              <div className="max-w-2xl">
                {files.length === 0 && <div className="text-muted-foreground py-8 text-center"><Folder className="mx-auto mb-2 h-6 w-6 opacity-40" />No output files<span className="block text-xs mt-1 opacity-60">Files appear after execution</span></div>}
                {files.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-2 pb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider"><span>{files.length} files</span><div className="flex gap-8"><span>Size</span><span>Modified</span></div></div>
                    {files.map((f, i) => {
                      const FI = getFileIcon(f.path);
                      return <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover text-xs transition-colors">
                        <FI className="h-3.5 w-3.5 shrink-0 text-brand" />
                        <span className="flex-1 font-mono text-foreground/70 truncate">{f.path}</span>
                        <span className="text-muted-foreground w-16 text-right shrink-0 tabular-nums">{formatFileSize(f.size)}</span>
                        <span className="text-muted-foreground w-20 text-right shrink-0">{new Date(f.modified_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      </div>;
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
