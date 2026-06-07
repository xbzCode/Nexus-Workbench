/** Task Detail Page — 左右分栏工作台布局 */

"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { useSSE } from "@/hooks/useSSE";
import { cn } from "@/lib/utils";
import TaskHeader from "@/components/task/TaskHeader";
import StepList from "@/components/task/StepList";
import RightPanel from "@/components/task/RightPanel";
import LeftBottomPanel from "@/components/task/LeftBottomPanel";
import FilePreviewDialog from "@/components/task/FilePreviewDialog";
import { ApprovalDialog } from "@/components/approval/ApprovalDialog";
import type {
  APIResponse, Task, Step, Approval, DAGDefinition,
  FileEntry,
} from "@/lib/types";
import { Loader2, GripVertical } from "lucide-react";

interface FileEntryLocal extends FileEntry { path: string; size: number; modified_at: string; }
interface SnapshotItemLocal { id: string; task_id: string; step_id?: string | null; type: string; git_commit_hash: string; git_diff?: string | null; untracked_files?: unknown[] | null; created_at: string; }
interface ExecutionPathItemLocal { id: string; task_id: string; source: string; steps: Record<string, unknown>[] | null; total_duration: number | null; total_approvals: number; success: boolean; user_rating: number | null; precipitated_to: string | null; created_at: string; }

// 左右分栏比例 (0~100)，默认 60/40
const DEFAULT_LEFT_RATIO = 60;
const MIN_LEFT_RATIO = 40;
const MAX_LEFT_RATIO = 75;

/** 从审批结果中提取用户回复的摘要文本 */
function extractApprovalResult(result: Record<string, unknown>, type?: string): string {
  if (result.answer) return String(result.answer);
  if (result.yes !== undefined) return result.yes ? "是" : "否";
  if (result.choices) {
    const choices = result.choices as string[];
    return `选择了: ${choices.join(", ")}`;
  }
  if (result.choice) return `选择了: ${String(result.choice)}`;
  if (result.labels) {
    const labels = result.labels as string[];
    return `排序: ${labels.join(" > ")}`;
  }
  if (result.ranked) {
    const ranked = result.ranked as string[];
    return `排序: ${ranked.join(" > ")}`;
  }
  // fallback
  const str = JSON.stringify(result);
  return str.length > 100 ? str.slice(0, 100) + "..." : str;
}

export default function TaskDetailPage() {
  const params = useParams();
  const id = params.id as string;

  // State
  const [task, setTask] = useState<Task | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotItemLocal[]>([]);
  const [execPaths, setExecPaths] = useState<ExecutionPathItemLocal[]>([]);
  const [files, setFiles] = useState<FileEntryLocal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [leftRatio, setLeftRatio] = useState(DEFAULT_LEFT_RATIO);
  const [isResizing, setIsResizing] = useState(false);
  const [dialogApproval, setDialogApproval] = useState<Approval | null>(null);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // SSE
  const sseUrl = task?.status === "running" ? "/api/events/stream" : null;
  const { events: sseEvents, isConnected } = useSSE(sseUrl, { taskId: id });

  // Data fetching
  const fetchData = useCallback(async () => {
    try {
      const [t, st, ap, sn, ep, fl] = await Promise.all([
        api.get<APIResponse<Task>>(`/tasks/${id}`),
        api.get<APIResponse<Step[]>>(`/tasks/${id}/steps`),
        api.get<APIResponse<Approval[]>>(`/approvals?task_id=${id}`).catch(() => ({ data: null } as APIResponse<Approval[]>)),
        api.get<APIResponse<SnapshotItemLocal[]>>(`/snapshots?task_id=${id}`).catch(() => ({ data: null } as APIResponse<SnapshotItemLocal[]>)),
        api.get<APIResponse<ExecutionPathItemLocal[]>>(`/execution-paths?task_id=${id}`).catch(() => ({ data: null } as APIResponse<ExecutionPathItemLocal[]>)),
        api.get<APIResponse<FileEntryLocal[]>>(`/tasks/${id}/files`).catch(() => ({ data: null } as APIResponse<FileEntryLocal[]>)),
      ]);
      setTask(t.data);
      setSteps(st.data ?? []);
      setApprovals(ap.data ?? []);
      setSnapshots(sn.data ?? []);
      setExecPaths(ep.data ?? []);
      setFiles(fl.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (!task || task.status !== "running") return;
    const r = sseEvents.filter(e =>
      e.event?.startsWith("dag:node_") || e.event?.startsWith("node:") ||
      e.event?.startsWith("approval:") || e.event?.startsWith("task:")
    );
    if (r.length > 0) fetchData();
  }, [sseEvents, task, fetchData]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (task?.status === "running") pollRef.current = setInterval(fetchData, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [task?.status, fetchData]);

  // Actions
  const handleAction = async (act: string, ep: string) => {
    setActionLoading(act);
    try { await api.post(`/tasks/${id}/${ep}`); await fetchData(); }
    catch {} finally { setActionLoading(null); };
  };

  const handleResolveApproval = useCallback(async (
    aid: string, status: "approved" | "rejected", result?: Record<string, unknown>
  ) => {
    await api.post(`/approvals/${aid}/resolve`, { status, result: result ?? null });
    await fetchData();
  }, [fetchData]);

  const handleRollback = async (sid: string) => {
    if (!confirm("确认回滚到此快照？")) return;
    setActionLoading("rollback");
    try { await api.post(`/snapshots/${sid}/rollback`); await fetchData(); }
    catch {} finally { setActionLoading(null); };
  };

  const handlePrecipitate = async (pid: string) => {
    const n = prompt("工作流名称:");
    if (!n?.trim()) return;
    setActionLoading("precipitate");
    try { await api.post(`/execution-paths/${pid}/precipitate`, { workflow_name: n.trim() }); await fetchData(); }
    catch {} finally { setActionLoading(null); };
  };

  // 快速发送
  const handleQuickSend = async (message: string) => {
    // TODO: 实现快速消息发送逻辑
    console.log("Quick send:", message);
  };

  const toggleStep = (sid: string) =>
    setExpandedSteps(prev => { const nx = new Set(prev); if (nx.has(sid)) nx.delete(sid); else nx.add(sid); return nx; });

  // 步骤审批角标点击 - 滚动右侧到行动中心
  const handleStepApprovalClick = (_stepId: string) => {
    // 可以高亮对应的审批卡片或做其他交互
    console.log("Step approval clicked, scroll to action center");
  };

  // 中间分割线拖拽 — 基于百分比比例调整
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startRatio = leftRatio;
    const container = containerRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      if (!container) return;
      const containerW = container.clientWidth;
      const deltaX = ev.clientX - startX; // 向右拖 → 左侧变大
      const deltaRatio = (deltaX / containerW) * 100;
      const newRatio = Math.round(Math.min(Math.max(startRatio + deltaRatio, MIN_LEFT_RATIO), MAX_LEFT_RATIO));
      setLeftRatio(newRatio);
    };

    const onMouseUp = () => { setIsResizing(false); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [leftRatio]);

  // Derived data
  const dag = (task?.dag ?? task?.context?.dag ?? null) as DAGDefinition | null;

  const stepStatusMap: Record<string, string> = {};
  for (const s of steps) stepStatusMap[s.node_id] = s.status;

  const stepApprovalsMap: Record<string, Approval[]> = {};
  for (const a of approvals) {
    if (a.step_id) { if (!stepApprovalsMap[a.step_id]) stepApprovalsMap[a.step_id] = []; stepApprovalsMap[a.step_id].push(a); }
  }

  const nodeNameMap: Record<string, string> = {};
  if (dag) { for (const n of dag.nodes) { nodeNameMap[n.id] = n.display_name || n.definition_id || n.id; } }

  const totalNodes = dag?.nodes.length ?? 0;
  const completedNodes = steps.filter(s => s.status === "completed").length;
  const failedNodes = steps.filter(s => s.status === "failed").length;
  const pendingApprovals = approvals.filter(a => a.status === "pending");

  // Log events — 提取有意义的内容用于日志展示
  const logEvents = useMemo(() => {
    const evts: { event: string; data: Record<string, unknown>; ts?: string }[] = [];

    // 步骤事件：提取 text 和 error 信息
    for (const s of steps) {
      const text = (s.output_data as Record<string, unknown>)?.text;
      const error = s.error;
      evts.push({
        event: s.status === "completed" ? "dag:node_completed" : s.status === "failed" ? "dag:node_failed" : "dag:node_started",
        data: {
          node_id: s.node_id,
          text: text ? String(text).slice(0, 200) : undefined,
          error: error ? (typeof error === "string" ? error : JSON.stringify(error).slice(0, 200)) : undefined,
        },
        ts: (s.completed_at ?? s.started_at) ?? undefined,
      });
    }

    // 审批事件：拆分为「提问」和「回复」两条日志
    for (const a of approvals) {
      // 提问事件
      evts.push({
        event: "approval:question",
        data: {
          approval_id: a.id,
          type: a.type,
          title: a.title,
          description: a.description ? String(a.description).slice(0, 200) : undefined,
          node_id: a.context_data?.node_id ? String(a.context_data.node_id) : undefined,
        },
        ts: a.created_at,
      });
      // 已解决时，追加回复事件
      if (a.status !== "pending" && a.resolved_at) {
        evts.push({
          event: `approval:${a.status}`,
          data: {
            approval_id: a.id,
            title: a.title,
            result: a.result ? extractApprovalResult(a.result, a.type) : undefined,
          },
          ts: a.resolved_at,
        });
      }
    }

    // SSE 事件：保留 content 字段用于日志展示
    for (const e of sseEvents) {
      evts.push({ event: e.event, data: e.data, ts: e.timestamp });
    }

    // 按时间升序排序（最旧在上，最新在下）
    evts.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return ta - tb;
    });

    return evts;
  }, [steps, approvals, sseEvents]);

  const isRunning = task?.status === "running";

  // ── Render ──

  return (
    <div className="flex h-full flex-col">
      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中...
        </div>
      )}
      {(error || !task) && !loading && (
        <div className="m-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "任务未找到"}
        </div>
      )}

      {/* Header + Body */}
      {task && !loading && (
        <>
          <TaskHeader
            task={task}
            dag={dag}
            stepStatusMap={stepStatusMap}
            totalNodes={totalNodes}
            completedNodes={completedNodes}
            failedNodes={failedNodes}
            isConnected={isConnected}
            actionLoading={actionLoading}
            onAction={handleAction}
          />

          {/* 左右分栏主区域 */}
          <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
            {/* 左侧：步骤 + 日志/审批面板 (60%) */}
            <div className="flex flex-col overflow-hidden" style={{ flex: `0 0 ${leftRatio}%` }}>
              {/* 步骤列表区域 — 可滚动 */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-5 py-4 space-y-3 max-w-[900px] mx-auto lg:max-w-none lg:px-6">
                  <StepList
                    steps={steps}
                    nodeNameMap={nodeNameMap}
                    stepApprovalsMap={stepApprovalsMap}
                    isRunning={isRunning}
                    expandedSteps={expandedSteps}
                    onToggleStep={toggleStep}
                    onStepApprovalClick={handleStepApprovalClick}
                    taskIO={{ input: task?.input_data, output: task?.output_data }}
                  />
                </div>
              </div>

              {/* 左侧底部：日志/审批/快照等 Tab 面板 */}
              <LeftBottomPanel
                taskId={id}
                approvals={approvals}
                pendingApprovals={pendingApprovals}
                snapshots={snapshots}
                execPaths={execPaths}
                files={files}
                logEvents={logEvents}
                nodeNameMap={nodeNameMap}
                onResolveApproval={handleResolveApproval}
                onApprovalDetail={setDialogApproval}
                onRollback={handleRollback}
                onPrecipitate={handlePrecipitate}
                onRatePath={(pid: string, r: number) => { api.post(`/execution-paths/${pid}/rate`, { rating: r }); fetchData(); }}
                onPreviewFile={setPreviewFilePath}
                actionLoading={actionLoading}
              />
            </div>

            {/* 可拖拽分割线 */}
            <div
              className={cn(
                "shrink-0 w-[5px] flex items-center justify-center cursor-col-resize hover:bg-brand/20 transition-colors group relative",
                isResizing && "bg-brand/30"
              )}
              onMouseDown={handleDragStart}
            >
              <GripVertical
                className={cn(
                  "h-4 w-4 text-muted-foreground/20 transition-colors",
                  isResizing ? "text-brand/50" : "group-hover:text-muted-foreground/40"
                )}
              />
            </div>

            {/* 右侧：行动中心 (清爽) */}
            <RightPanel
              pendingApprovals={pendingApprovals}
              onResolveApproval={handleResolveApproval}
              onQuickSend={handleQuickSend}
            />
          </div>

          {/* Approval Detail Dialog */}
          {dialogApproval && (
            <ApprovalDialog
              approval={dialogApproval}
              onResolve={handleResolveApproval}
              onClose={() => setDialogApproval(null)}
            />
          )}

          {/* File Preview Dialog */}
          <FilePreviewDialog
            open={!!previewFilePath}
            filePath={previewFilePath ?? ""}
            taskId={id}
            onClose={() => setPreviewFilePath(null)}
          />
        </>
      )}
    </div>
  );
}
