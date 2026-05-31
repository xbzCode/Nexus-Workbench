"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { useSSE } from "@/hooks/useSSE";
import StatusBadge from "@/components/shared/StatusBadge";
import StepTimeline from "@/components/task/StepTimeline";
import LiveLog from "@/components/task/LiveLog";
import ApprovalCard from "@/components/approval/ApprovalCard";
import DagEditor from "@/components/workflow/DagEditor";
import { Button } from "@/components/ui/button";
import type { APIResponse, Task, Step, Approval, DAGDefinition, ApprovalResolve, SSEEvent } from "@/lib/types";
import {
  Loader2,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  ArrowLeft,
  Clock,
  Workflow,
  Cpu,
  Sparkles,
  Wifi,
  WifiOff,
  Bell,
  ScrollText,
  ListOrdered,
  Camera,
  Route,
  Star,
  Download,
} from "lucide-react";

const MODE_INFO: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  workflow: { label: "工作流", icon: Workflow, color: "text-brand" },
  dynamic_assembly: { label: "动态组装", icon: Sparkles, color: "text-violet" },
  bare_agent: { label: "裸 Agent", icon: Cpu, color: "text-amber" },
};

/** 右侧面板 Tab */
type RightTab = "log" | "approval" | "steps" | "snapshots" | "paths";

/** 将 Step 转换为模拟的 SSE 事件，用于历史回放 */
function stepsToEvents(steps: Step[]): SSEEvent[] {
  return steps.map((s) => {
    const base: SSEEvent = {
      event: s.status === "completed" ? "dag:node_completed" : s.status === "failed" ? "dag:node_failed" : "dag:node_started",
      data: { node_id: s.node_id },
      source: s.node_id,
      task_id: s.task_id,
    };

    if (s.status === "completed" && s.output_data) {
      base.data = { node_id: s.node_id, output: s.output_data };
    } else if (s.status === "failed" && s.error) {
      base.data = { node_id: s.node_id, error: s.error };
    }

    return base;
  });
}

/** 将 Approval 转换为 SSE 事件（审批创建 + 审批解决），用于历史回放 */
function approvalsToEvents(approvals: Approval[]): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const a of approvals) {
    events.push({
      event: "approval:created",
      data: {
        approval_id: a.id,
        node_id: a.step_id,
        type: a.type,
        title: a.title,
        description: a.description,
      },
      source: a.step_id ?? "system",
      task_id: a.task_id,
    });
    if (a.status !== "pending") {
      events.push({
        event: "approval:resolved",
        data: {
          approval_id: a.id,
          status: a.status,
          result: a.result,
        },
        source: a.step_id ?? "system",
        task_id: a.task_id,
      });
    }
  }
  return events;
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [execPaths, setExecPaths] = useState<ExecutionPathItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RightTab>("log");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // SSE：running 状态下按 task_id 过滤订阅
  const sseUrl = task?.status === "running" ? "/api/events/stream" : null;
  const { events: sseEvents, isConnected } = useSSE(sseUrl, {
    taskId: id,
  });

  // 合并历史步骤 + 审批 + 实时 SSE 事件
  const historicalEvents = useMemo(() => {
    const stepEvents = stepsToEvents(steps);
    const approvalEvents = approvalsToEvents(approvals);
    // 构建 step_id → node_id 映射，用于审批事件关联到节点
    const stepToNode: Record<string, string> = {};
    for (const s of steps) {
      stepToNode[s.id] = s.node_id;
    }
    // 按时间交错：审批事件插在对应节点的 node_started 之后
    const result: SSEEvent[] = [];
    for (const s of stepEvents) {
      result.push(s);
      if (s.event === "dag:node_started") {
        const nodeId = s.data.node_id as string;
        // 找到属于该 node 的审批事件
        const relatedApprovals = approvalEvents.filter((ae) => {
          const aeStepId = ae.source ?? "";
          return stepToNode[aeStepId] === nodeId;
        });
        result.push(...relatedApprovals);
      }
    }
    return result;
  }, [steps, approvals]);
  const [liveEvents, setLiveEvents] = useState<SSEEvent[]>([]);

  // SSE 事件追加到 liveEvents
  useEffect(() => {
    if (sseEvents.length === 0) return;
    setLiveEvents((prev) => [...prev, ...sseEvents]);
  }, [sseEvents]);

  // 步骤数据更新时重置 liveEvents（避免重复）
  const stepsLengthRef = useRef(0);
  useEffect(() => {
    if (steps.length !== stepsLengthRef.current) {
      stepsLengthRef.current = steps.length;
      setLiveEvents([]);
    }
  }, [steps.length]);

  // 最终展示的事件列表 = 历史 + 实时
  const displayEvents = useMemo(() => {
    return [...historicalEvents, ...liveEvents];
  }, [historicalEvents, liveEvents]);

  const fetchData = useCallback(async () => {
    try {
      const [taskRes, stepsRes, approvalsRes, snapshotsRes, pathsRes] = await Promise.all([
        api.get<APIResponse<Task>>(`/tasks/${id}`),
        api.get<APIResponse<Step[]>>(`/tasks/${id}/steps`),
        api.get<APIResponse<Approval[]>>(`/approvals?task_id=${id}`).catch(() => ({ data: null } as APIResponse<Approval[]>)),
        api.get<APIResponse<SnapshotItem[]>>(`/snapshots?task_id=${id}`).catch(() => ({ data: null } as APIResponse<SnapshotItem[]>)),
        api.get<APIResponse<ExecutionPathItem[]>>(`/execution-paths?task_id=${id}`).catch(() => ({ data: null } as APIResponse<ExecutionPathItem[]>)),
      ]);
      setTask(taskRes.data);
      setSteps(stepsRes.data ?? []);
      setApprovals(approvalsRes.data ?? []);
      setSnapshots(snapshotsRes.data ?? []);
      setExecPaths(pathsRes.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // 初始加载
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // SSE 事件驱动：收到步骤/审批相关事件时刷新数据
  useEffect(() => {
    if (!task || task.status !== "running") return;

    const relevantEvents = sseEvents.filter(
      (e) =>
        e.event?.startsWith("dag:node_") ||
        e.event?.startsWith("node:") ||
        e.event?.startsWith("approval:") ||
        e.event?.startsWith("task:")
    );
    if (relevantEvents.length > 0) {
      fetchData();
    }
  }, [sseEvents, task, fetchData]);

  // 轮询兜底：running 状态下每5秒刷新
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    if (task?.status === "running") {
      pollRef.current = setInterval(fetchData, 5000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [task?.status, fetchData]);

  // 审批事件自动切换 Tab
  useEffect(() => {
    if (!task || task.status !== "running") return;
    const approvalEvents = sseEvents.filter((e) => e.event === "approval:created");
    if (approvalEvents.length > 0) {
      setActiveTab("approval");
    }
  }, [sseEvents, task]);

  const handleAction = async (action: string, endpoint: string) => {
    setActionLoading(action);
    try {
      await api.post<APIResponse<Task>>(endpoint);
      await fetchData();
    } catch {
      // error handling
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = () => handleAction("start", `/tasks/${id}/start`);
  const handleCancel = () => handleAction("cancel", `/tasks/${id}/cancel`);
  const handlePause = () => handleAction("pause", `/tasks/${id}/pause`);
  const handleResume = () => handleAction("resume", `/tasks/${id}/resume`);

  const handleResolveApproval = useCallback(
    async (approvalId: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
      const body: ApprovalResolve = { status, result: result ?? null };
      await api.post<APIResponse<Approval>>(`/approvals/${approvalId}/resolve`, body);
      await fetchData();
    },
    [fetchData]
  );

  const handleRollback = useCallback(
    async (snapshotId: string) => {
      if (!confirm("确认回滚到此快照？当前工作目录的文件将被恢复到快照时的状态。")) return;
      setActionLoading("rollback");
      try {
        await api.post<APIResponse<unknown>>(`/snapshots/${snapshotId}/rollback`);
        await fetchData();
      } catch {
        // error handling
      } finally {
        setActionLoading(null);
      }
    },
    [fetchData]
  );

  const handlePrecipitate = useCallback(
    async (pathId: string) => {
      const name = prompt("请输入工作流名称：");
      if (!name?.trim()) return;
      setActionLoading("precipitate");
      try {
        await api.post<APIResponse<{ workflow_id: string }>>(`/execution-paths/${pathId}/precipitate`, {
          workflow_name: name.trim(),
          workflow_description: `从任务 ${task?.title ?? id} 的执行路径沉淀`,
        });
        await fetchData();
      } catch {
        // error handling
      } finally {
        setActionLoading(null);
      }
    },
    [fetchData, task, id]
  );

  const handleRatePath = useCallback(
    async (pathId: string, rating: number) => {
      try {
        await api.post<APIResponse<unknown>>(`/execution-paths/${pathId}/rate`, { rating });
        await fetchData();
      } catch {
        // error handling
      }
    },
    [fetchData]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载中…
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="m-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {error ?? "任务不存在"}
      </div>
    );
  }

  const dag = (task.context?.dag ?? null) as DAGDefinition | null;
  const modeInfo = MODE_INFO[task.execution_mode] ?? MODE_INFO.bare_agent;
  const ModeIcon = modeInfo.icon;

  const nodeStatuses: Record<string, string> = {};
  for (const s of steps) {
    nodeStatuses[s.node_id] = s.status;
  }

  const isRunning = task.status === "running";
  const isPaused = task.status === "paused";
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const hasPendingApproval = pendingApprovals.length > 0;

  const TABS: { key: RightTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: "log", label: "日志", icon: ScrollText },
    { key: "approval", label: "审批", icon: Bell, badge: hasPendingApproval ? pendingApprovals.length : undefined },
    { key: "steps", label: "步骤", icon: ListOrdered },
    { key: "snapshots", label: "快照", icon: Camera, badge: snapshots.length > 0 ? snapshots.length : undefined },
    { key: "paths", label: "路径", icon: Route, badge: execPaths.length > 0 ? execPaths.length : undefined },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={() => router.push("/tasks")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-xl font-semibold tracking-tight">{task.title}</h2>
              <StatusBadge status={task.status} />
              <span className={`flex items-center gap-1 text-xs font-medium ${modeInfo.color}`}>
                <ModeIcon className="h-3.5 w-3.5" />
                {modeInfo.label}
              </span>
              {(isRunning || isPaused) && (
                <span className="flex items-center gap-1 text-xs">
                  {isConnected ? (
                    <><Wifi className="h-3 w-3 text-emerald-400" /> <span className="text-emerald-400">SSE</span></>
                  ) : (
                    <><WifiOff className="h-3 w-3 text-muted-foreground" /> <span className="text-muted-foreground">SSE 断开</span></>
                  )}
                </span>
              )}
            </div>
            <div className="ml-9 mt-1 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(task.created_at).toLocaleString("zh-CN")}
              </span>
              {task.started_at && (
                <span>开始: {new Date(task.started_at).toLocaleString("zh-CN")}</span>
              )}
              {task.completed_at && (
                <span>完成: {new Date(task.completed_at).toLocaleString("zh-CN")}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {task.status === "pending" && (
              <Button size="sm" onClick={handleStart} disabled={actionLoading === "start"}>
                {actionLoading === "start" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                启动
              </Button>
            )}
            {isRunning && (
              <>
                <Button variant="outline" size="sm" onClick={handlePause} disabled={actionLoading === "pause"}>
                  {actionLoading === "pause" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
                  暂停
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleCancel} disabled={actionLoading === "cancel"}>
                  {actionLoading === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                  取消
                </Button>
              </>
            )}
            {isPaused && (
              <>
                <Button size="sm" onClick={handleResume} disabled={actionLoading === "resume"}>
                  {actionLoading === "resume" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                  恢复
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleCancel} disabled={actionLoading === "cancel"}>
                  {actionLoading === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                  取消
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content: 左 DAG + 右面板 */}
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* 左侧：DAG 状态图 */}
          <div className="w-[55%] border-r border-border flex flex-col">
            <div className="flex-1 overflow-hidden">
              <DagEditor dag={dag} nodeStatuses={nodeStatuses} />
            </div>
            {/* 输入/输出概览（底部折叠区域） */}
            <div className="shrink-0 border-t border-border">
              <div className="grid grid-cols-2 divide-x divide-border">
                {task.input_data && (
                  <div className="p-3">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">输入</span>
                    <pre className="max-h-20 overflow-auto rounded-lg bg-surface p-2 font-mono text-[11px] text-foreground/70">
                      {JSON.stringify(task.input_data, null, 2)}
                    </pre>
                  </div>
                )}
                {task.output_data && (
                  <div className="p-3">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">输出</span>
                    <pre className="max-h-20 overflow-auto rounded-lg bg-surface p-2 font-mono text-[11px] text-emerald-400">
                      {JSON.stringify(task.output_data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：Tab 面板（日志 + 审批 + 步骤 + 快照） */}
          <div className="w-[45%] flex flex-col">
            {/* Tab bar */}
            <div className="shrink-0 flex items-center border-b border-border bg-surface-hover/30 px-2">
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    className={`
                      relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors
                      ${activeTab === tab.key
                        ? "text-brand border-b-2 border-brand"
                        : "text-muted-foreground hover:text-foreground"
                      }
                    `}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {tab.label}
                    {tab.badge != null && tab.badge > 0 && (
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {/* 日志 Tab */}
              {activeTab === "log" && (
                <div className="h-full">
                  <LiveLog events={displayEvents} className="h-full" isLive={isRunning || isPaused} />
                </div>
              )}

              {/* 审批 Tab */}
              {activeTab === "approval" && (
                <div className="space-y-3 p-4">
                  {approvals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Bell className="mb-2 h-8 w-8 opacity-40" />
                      <p className="text-sm">暂无审批记录</p>
                    </div>
                  ) : (
                    <>
                      {pendingApprovals.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-amber uppercase tracking-wider">
                            待处理 ({pendingApprovals.length})
                          </h4>
                          {pendingApprovals.map((a) => (
                            <ApprovalCard key={a.id} approval={a} onResolve={handleResolveApproval} />
                          ))}
                        </div>
                      )}
                      {approvals.filter((a) => a.status !== "pending").length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            已处理
                          </h4>
                          {approvals
                            .filter((a) => a.status !== "pending")
                            .map((a) => (
                              <ApprovalCard key={a.id} approval={a} compact />
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 步骤 Tab */}
              {activeTab === "steps" && (
                <div className="p-4">
                  <StepTimeline steps={steps} />
                </div>
              )}

              {/* 快照 Tab */}
              {activeTab === "snapshots" && (
                <div className="p-4">
                  {snapshots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Camera className="mb-2 h-8 w-8 opacity-40" />
                      <p className="text-sm">暂无快照</p>
                      <p className="mt-1 text-xs text-muted-foreground/60">任务执行时会在关键节点自动创建快照</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {snapshots.map((snap) => (
                        <div
                          key={snap.id}
                          className="rounded-xl border border-border bg-card p-4 transition-all hover:border-brand/20"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`
                                  inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium
                                  ${snap.type === "pre_step" ? "bg-sky-500/10 text-sky-400" :
                                    snap.type === "post_step" ? "bg-emerald-500/10 text-emerald-400" :
                                    snap.type === "pre_validation" ? "bg-amber/10 text-amber" :
                                    "bg-muted text-muted-foreground"}
                                `}>
                                  {snap.type === "pre_step" ? "步骤前" :
                                   snap.type === "post_step" ? "步骤后" :
                                   snap.type === "pre_validation" ? "验证前" :
                                   snap.type === "manual" ? "手动" : snap.type}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground">
                                  {snap.git_commit_hash.slice(0, 8)}
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {new Date(snap.created_at).toLocaleString("zh-CN")}
                              </div>
                              {snap.untracked_files && Array.isArray(snap.untracked_files) && snap.untracked_files.length > 0 && (
                                <div className="mt-1 text-[11px] text-muted-foreground/60">
                                  {snap.untracked_files.length} 个未跟踪文件
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0 gap-1 text-xs"
                              onClick={() => handleRollback(snap.id)}
                              disabled={actionLoading === "rollback"}
                            >
                              {actionLoading === "rollback" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              回滚
                            </Button>
                          </div>
                          {snap.git_diff && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                                查看变更
                              </summary>
                              <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-surface p-2 font-mono text-[10px] text-foreground/70">
                                {snap.git_diff.length > 2000 ? snap.git_diff.slice(0, 2000) + "\n..." : snap.git_diff}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 执行路径 Tab */}
              {activeTab === "paths" && (
                <div className="p-4">
                  {execPaths.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Route className="mb-2 h-8 w-8 opacity-40" />
                      <p className="text-sm">暂无执行路径</p>
                      <p className="mt-1 text-xs text-muted-foreground/60">任务完成后会自动生成执行路径</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {execPaths.map((ep) => (
                        <div
                          key={ep.id}
                          className="rounded-xl border border-border bg-card p-4 transition-all hover:border-brand/20"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`
                                  inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium
                                  ${ep.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}
                                `}>
                                  {ep.success ? "成功" : "失败"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  来源: {ep.source}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                {ep.total_duration != null && (
                                  <span>耗时 {ep.total_duration.toFixed(1)}s</span>
                                )}
                                <span>审批 {ep.total_approvals} 次</span>
                                <span>{new Date(ep.created_at).toLocaleString("zh-CN")}</span>
                              </div>
                              {/* 评分 */}
                              <div className="mt-2 flex items-center gap-1">
                                <span className="text-[11px] text-muted-foreground mr-1">评分</span>
                                {[1, 2, 3, 4, 5].map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => handleRatePath(ep.id, r)}
                                    className="transition-colors"
                                  >
                                    <Star
                                      className={`h-3.5 w-3.5 ${
                                        ep.user_rating && r <= ep.user_rating
                                          ? "text-amber fill-amber"
                                          : "text-muted-foreground/30 hover:text-amber/60"
                                      }`}
                                    />
                                  </button>
                                ))}
                                {ep.user_rating && (
                                  <span className="ml-1 text-[11px] text-amber">{ep.user_rating}/5</span>
                                )}
                              </div>
                            </div>
                            {/* 沉淀为工作流 */}
                            {!ep.precipitated_to && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 gap-1 text-xs"
                                onClick={() => handlePrecipitate(ep.id)}
                                disabled={actionLoading === "precipitate"}
                              >
                                {actionLoading === "precipitate" ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                沉淀为工作流
                              </Button>
                            )}
                            {ep.precipitated_to && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 gap-1 text-xs text-brand"
                                onClick={() => router.push(`/workflows/${ep.precipitated_to}`)}
                              >
                                <Workflow className="h-3 w-3" />
                                查看工作流
                              </Button>
                            )}
                          </div>
                          {/* 步骤概览 */}
                          {ep.steps && Array.isArray(ep.steps) && ep.steps.length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                                步骤详情 ({ep.steps.length} 步)
                              </summary>
                              <div className="mt-1 space-y-1">
                                {ep.steps.map((step: Record<string, unknown>, i: number) => (
                                  <div key={i} className="flex items-center gap-2 text-[11px]">
                                    <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                                    <span className="text-foreground">{(step.node_id as string) || `step_${i + 1}`}</span>
                                    <span className="text-muted-foreground">
                                      {(step.definition_id as string) || ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Snapshot 类型（前端本地） ──

interface SnapshotItem {
  id: string;
  task_id: string;
  step_id?: string | null;
  type: string;
  git_commit_hash: string;
  git_diff?: string | null;
  untracked_files?: unknown[] | null;
  environment?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ── ExecutionPath 类型（前端本地） ──

interface ExecutionPathItem {
  id: string;
  task_id: string;
  source: string;
  steps: Record<string, unknown>[] | null;
  total_duration: number | null;
  total_approvals: number;
  success: boolean;
  user_rating: number | null;
  precipitated_to: string | null;
  created_at: string;
}
