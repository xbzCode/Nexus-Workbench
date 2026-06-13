/** Task Detail Page — 左右分栏工作台布局 */

"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
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
  APIResponse, Task, Step, Approval, ApprovalListData, DAGDefinition,
  FileEntry,
} from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Loader2, GripVertical } from "lucide-react";

interface FileEntryLocal extends FileEntry { path: string; size: number; modified_at: string; }
interface SnapshotItemLocal { id: string; task_id: string; step_id?: string | null; type: string; git_commit_hash: string; git_diff?: string | null; untracked_files?: unknown[] | null; created_at: string; }
interface ExecutionPathItemLocal { id: string; task_id: string; source: string; steps: Record<string, unknown>[] | null; total_duration: number | null; total_approvals: number; success: boolean; user_rating: number | null; precipitated_to: string | null; created_at: string; }

// 左右分栏比例 (0~100)，默认 60/40
const DEFAULT_LEFT_RATIO = 60;
const MIN_LEFT_RATIO = 40;
const MAX_LEFT_RATIO = 75;

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
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [rollbackSnapshotId, setRollbackSnapshotId] = useState<string | null>(null);
  const [precipitateDialogOpen, setPrecipitateDialogOpen] = useState(false);
  const [precipitatePathId, setPrecipitatePathId] = useState<string | null>(null);
  const [precipitateName, setPrecipitateName] = useState("");
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
        api.get<APIResponse<ApprovalListData>>(`/approvals?task_id=${id}`).catch(() => ({ data: null } as APIResponse<ApprovalListData>)),
        api.get<APIResponse<SnapshotItemLocal[]>>(`/snapshots?task_id=${id}`).catch(() => ({ data: null } as APIResponse<SnapshotItemLocal[]>)),
        api.get<APIResponse<ExecutionPathItemLocal[]>>(`/execution-paths?task_id=${id}`).catch(() => ({ data: null } as APIResponse<ExecutionPathItemLocal[]>)),
        api.get<APIResponse<FileEntryLocal[]>>(`/tasks/${id}/files`).catch(() => ({ data: null } as APIResponse<FileEntryLocal[]>)),
      ]);
      setTask(t.data);
      setSteps(st.data ?? []);
      setApprovals(ap.data?.items ?? []);
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
    setRollbackSnapshotId(sid);
    setRollbackDialogOpen(true);
  };

  const confirmRollback = async () => {
    if (!rollbackSnapshotId) return;
    setActionLoading("rollback");
    try { await api.post(`/snapshots/${rollbackSnapshotId}/rollback`); await fetchData(); }
    catch {} finally { setActionLoading(null); setRollbackDialogOpen(false); };
  };

  const handlePrecipitate = async (pid: string) => {
    setPrecipitatePathId(pid);
    setPrecipitateName("");
    setPrecipitateDialogOpen(true);
  };

  const confirmPrecipitate = async () => {
    if (!precipitatePathId || !precipitateName.trim()) return;
    setActionLoading("precipitate");
    try { await api.post(`/execution-paths/${precipitatePathId}/precipitate`, { workflow_name: precipitateName.trim() }); await fetchData(); }
    catch {} finally { setActionLoading(null); setPrecipitateDialogOpen(false); };
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

    // 拖拽期间防止文字选中
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (ev: MouseEvent) => {
      if (!container) return;
      const containerW = container.clientWidth;
      const deltaX = ev.clientX - startX;
      const deltaRatio = (deltaX / containerW) * 100;
      const newRatio = Math.round(Math.min(Math.max(startRatio + deltaRatio, MIN_LEFT_RATIO), MAX_LEFT_RATIO));
      setLeftRatio(newRatio);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
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

              {/* 左侧底部：时间线/审批/快照等 Tab 面板 */}
              <LeftBottomPanel
                taskId={id}
                steps={steps}
                approvals={approvals}
                pendingApprovals={pendingApprovals}
                snapshots={snapshots}
                execPaths={execPaths}
                files={files}
                taskStartedAt={task?.started_at ?? null}
                taskCompletedAt={task?.completed_at ?? null}
                taskStatus={task?.status ?? "pending"}
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

            {/* 可拖拽分割线 — hover 区域加大，视觉指示器细线 */}
            <div
              className={cn(
                "shrink-0 w-[12px] flex items-center justify-center cursor-col-resize group relative",
                isResizing && "bg-brand/10"
              )}
              onMouseDown={handleDragStart}
            >
              <div className={cn(
                "w-[3px] rounded-full h-8 transition-all",
                isResizing ? "bg-brand/50" : "bg-border/60 group-hover:bg-brand/30"
              )} />
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

          {/* 回滚确认弹框 */}
          <AlertDialog open={rollbackDialogOpen} onOpenChange={setRollbackDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认回滚</AlertDialogTitle>
                <AlertDialogDescription>
                  确定要回滚到此快照吗？当前工作区的更改将被覆盖，此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmRollback}
                  className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                >
                  确认回滚
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* 沉淀工作流弹框 */}
          <AlertDialog open={precipitateDialogOpen} onOpenChange={setPrecipitateDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>沉淀为工作流</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>将此执行路径沉淀为可复用的工作流模板。</p>
                    <Input
                      placeholder="输入工作流名称"
                      value={precipitateName}
                      onChange={(e) => setPrecipitateName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmPrecipitate(); }}
                      autoFocus
                    />
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmPrecipitate}
                  disabled={!precipitateName.trim()}
                >
                  确认创建
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
