/** 执行状态管理 hook — SSE 事件处理、审批轮询、状态同步 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useSSE } from "@/hooks/useSSE";
import type { APIResponse, Approval, ApprovalListData } from "@/lib/types";
import type { TaskQueueItem, ExecutionLog } from "@/types/task-queue";
import { toast } from "sonner";

interface ExecState {
  logs: ExecutionLog[];
  completed: boolean;
  approvals: Approval[];
}

export function useExecutionState(
  activeTask: TaskQueueItem | undefined,
  updateTask: (id: string, patch: Partial<TaskQueueItem>) => void,
) {
  const [executionMap, setExecutionMap] = useState<Record<string, ExecState>>({});
  const [approvalLoading, setApprovalLoading] = useState(false);

  const logIdRef = useRef(0);
  const lastProcessedSSEIdx = useRef(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const activeExec = activeTask ? executionMap[activeTask.id] : undefined;

  // SSE 连接
  const sseTaskId = (activeTask?.status === "executing" || activeTask?.status === "paused") ? activeTask.taskId : undefined;
  const { events: sseEvents } = useSSE(
    sseTaskId ? "/api/events/stream" : null,
    { taskId: sseTaskId }
  );

  // SSE 连接切换时重置处理索引
  useEffect(() => {
    lastProcessedSSEIdx.current = 0;
  }, [sseTaskId]);

  const updateExecState = useCallback((id: string, patch: Partial<ExecState>) => {
    setExecutionMap(prev => ({
      ...prev,
      [id]: { ...(prev[id] || { logs: [], completed: false, approvals: [] }), ...patch },
    }));
  }, []);

  // ── 审批轮询 ──
  useEffect(() => {
    if (!activeTask?.taskId || activeTask.status !== "executing") return;
    let active = true;
    const fetchApprovals = async () => {
      try {
        const res = await api.get<APIResponse<ApprovalListData>>(`/approvals?task_id=${activeTask.taskId}`);
        if (active && res.data) {
          const allApprovals = res.data.items ?? [];
          const pendingApprovals = allApprovals.filter(a => a.status === "pending");
          const hasExpired = allApprovals.some(a => a.status === "expired");
          updateExecState(activeTask.id, { approvals: pendingApprovals });
          if (hasExpired) {
            updateTask(activeTask.id, { status: "paused" });
          }
        }
      } catch { /* ignore */ }
    };
    fetchApprovals();
    const timer = setInterval(fetchApprovals, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [activeTask?.taskId, activeTask?.status, activeTask?.id, updateExecState, updateTask]);

  // ── 任务状态轮询兜底 ──
  useEffect(() => {
    if (!activeTask?.taskId || activeTask.status !== "executing") return;
    let active = true;
    const pollStatus = async () => {
      try {
        const res = await api.get<APIResponse<{ status: string; output_data?: Record<string, unknown> }>>(`/tasks/${activeTask.taskId}`);
        if (active && res.data) {
          const dbStatus = res.data.status;
          if (dbStatus === "completed") {
            updateTask(activeTask.id, { status: "completed" });
            updateExecState(activeTask.id, { completed: true });
          } else if (dbStatus === "failed") {
            const error = res.data.output_data?.error ? String(res.data.output_data.error) : "任务执行失败";
            updateTask(activeTask.id, { status: "failed", error });
            updateExecState(activeTask.id, { completed: true });
          } else if (dbStatus === "paused") {
            updateTask(activeTask.id, { status: "paused" });
          }
        }
      } catch { /* ignore */ }
    };
    const timer = setInterval(pollStatus, 8000);
    const initial = setTimeout(pollStatus, 5000);
    return () => { active = false; clearInterval(timer); clearTimeout(initial); };
  }, [activeTask?.taskId, activeTask?.status, activeTask?.id, updateTask, updateExecState]);

  // ── SSE 事件处理 ──
  useEffect(() => {
    if (!activeTask || activeTask.status !== "executing") return;
    const startIdx = lastProcessedSSEIdx.current;
    const newEvents = sseEvents.slice(startIdx);

    for (const evt of newEvents) {
      const logId = ++logIdRef.current;
      const data = evt.data || {};
      let content = "";
      let eventLabel = evt.event;

      switch (evt.event) {
        case "dag:validation_passed": content = `DAG 校验通过，${data.node_count} 个节点`; break;
        case "dag:topo_sorted": content = "拓扑排序完成，准备执行"; break;
        case "dag:level_started": content = `开始层级 ${data.level}`; break;
        case "dag:node_started": content = `节点 ${data.node_id} 开始执行`; break;
        case "node:thinking": content = `${data.node_id}: ${(data.content as string)?.slice(0, 200)}`; eventLabel = "thinking"; break;
        case "node:progress": content = `${data.node_id}: ${(data.content as string)?.slice(0, 200)}`; eventLabel = "progress"; break;
        case "node:question": content = `Agent 提问: ${(data.question as string)?.slice(0, 120)}`; eventLabel = "question"; break;
        case "dag:node_completed": {
          const output = data.output as Record<string, unknown> | undefined;
          const summary = output?.summary as string | undefined;
          content = `节点 ${data.node_id} 完成${summary ? ` — ${summary}` : ""}`; break;
        }
        case "dag:node_failed":
          content = `节点 ${data.node_id} 失败: ${data.error}`;
          updateTask(activeTask.id, { status: "failed", error: String(data.error || "节点执行失败") });
          updateExecState(activeTask.id, { completed: true });
          toast.error("节点执行失败", { description: String(data.node_id) });
          break;
        case "dag:execution_completed":
          content = "工作流执行完成";
          updateTask(activeTask.id, { status: "completed" });
          updateExecState(activeTask.id, { completed: true });
          toast.success("工作流执行完成");
          break;
        case "task:completed":
          content = "任务完成";
          updateTask(activeTask.id, { status: "completed" });
          updateExecState(activeTask.id, { completed: true });
          toast.success("任务执行完成");
          break;
        case "task:failed":
          content = `任务失败: ${data.error || "未知错误"}`;
          updateTask(activeTask.id, { status: "failed", error: String(data.error || "任务执行失败") });
          updateExecState(activeTask.id, { completed: true });
          toast.error("任务执行失败", { description: String(data.error || "").slice(0, 80) });
          break;
        case "dag:node_skipped": content = `节点 ${data.node_id} 跳过: ${data.reason}`; break;
        case "dag:level_completed": content = `层级 ${data.level} 完成`; break;
        case "approval:created": content = `需要审批: ${data.title}`; eventLabel = "approval"; break;
        case "approval:resolved": content = `审批已处理: ${data.status}`; break;
        default: content = JSON.stringify(data).slice(0, 100);
      }

      setExecutionMap(prev => {
        const state = prev[activeTask.id] || { logs: [], completed: false, approvals: [] };
        return {
          ...prev,
          [activeTask.id]: {
            ...state,
            logs: [
              ...state.logs.slice(-49),
              { id: logId, event: eventLabel, node_id: data.node_id as string | undefined, content, timestamp: Date.now() },
            ],
          },
        };
      });
    }

    lastProcessedSSEIdx.current = sseEvents.length;
  }, [sseEvents, activeTask, updateTask, updateExecState]);

  // 自动滚动日志
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeExec?.logs]);

  // ── 审批操作 ──
  const handleResolveApproval = useCallback(async (approvalId: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
    setApprovalLoading(true);
    try {
      await api.post<APIResponse<Approval>>(`/approvals/${approvalId}/resolve`, { status, result: result ?? null });
      if (activeTask) {
        updateExecState(activeTask.id, {
          approvals: (activeExec?.approvals ?? []).filter(a => a.id !== approvalId),
        });
      }
      toast.success(status === "approved" ? "已批准" : "已拒绝");
    } catch {
      toast.error("审批操作失败");
    } finally {
      setApprovalLoading(false);
    }
  }, [activeTask, activeExec, updateExecState]);

  /** 初始化执行状态（确认任务时调用） */
  const initExecState = useCallback((queueId: string) => {
    setExecutionMap(prev => ({
      ...prev,
      [queueId]: { logs: [], completed: false, approvals: [] },
    }));
    logIdRef.current = 0;
  }, []);

  /** 清理已移除任务的执行状态 */
  const cleanExecState = useCallback((queueId: string) => {
    setExecutionMap(prev => {
      const next = { ...prev };
      delete next[queueId];
      return next;
    });
  }, []);

  return {
    executionMap,
    activeExec,
    approvalLoading,
    logsEndRef,
    handleResolveApproval,
    initExecState,
    cleanExecState,
  };
}
