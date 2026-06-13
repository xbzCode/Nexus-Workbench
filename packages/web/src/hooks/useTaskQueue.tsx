/** 任务队列状态管理 hook — 从 Chat page 抽离 */

"use client";

import { useState, useCallback } from "react";
import { useMatch } from "@/hooks/useMatch";
import { useTaskCreate } from "@/hooks/useTask";
import type { TaskCreate } from "@/lib/types";
import type { TaskQueueItem } from "@/types/task-queue";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

const brandIcon = <CheckCircle2 className="h-4 w-4 text-brand" />;
const errorIcon = <XCircle className="h-4 w-4 text-red-400" />;

export function useTaskQueue() {
  const [tasks, setTasks] = useState<TaskQueueItem[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();

  const { match: doMatch } = useMatch();
  const { createAndStart } = useTaskCreate();

  // ── Helpers ──

  const updateTask = useCallback((id: string, patch: Partial<TaskQueueItem>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // ── Derived ──

  const activeTask = tasks.find(t => t.id === activeTaskId);

  // ── Actions ──

  /** 提交新任务 — 创建队列项并调用匹配 */
  const handleSubmit = useCallback(async (text: string, teamId?: string | null) => {
    const newTask: TaskQueueItem = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      userQuery: text,
      status: "matching",
      createdAt: Date.now(),
      teamId: teamId ?? null,
    };

    setTasks(prev => [...prev, newTask]);
    setActiveTaskId(newTask.id);

    const result = await doMatch(text, teamId);
    if (result) {
      updateTask(newTask.id, { status: "matched", matchResult: result });
    } else {
      updateTask(newTask.id, {
        status: "matched",
        matchResult: { mode: "bare_agent", reasoning: "匹配服务不可用，将使用 bare Agent 模式" },
      });
    }
  }, [doMatch, updateTask]);

  /** 确认匹配结果 — 创建并启动后端任务 */
  const handleConfirm = useCallback(async (queueId: string) => {
    const task = tasks.find(t => t.id === queueId);
    if (!task?.matchResult) return;

    updateTask(queueId, { status: "confirming" });

    const taskData: TaskCreate = {
      title: task.userQuery,
      input_data: { user_input: task.userQuery },
    };
    if (task.matchResult.team_id) taskData.team_id = task.matchResult.team_id;
    else if (task.teamId) taskData.team_id = task.teamId;
    if (task.matchResult.mode === "matched") taskData.workflow_id = task.matchResult.workflow_id ?? null;
    else if (task.matchResult.mode === "dynamic_assembly") {
      taskData.execution_mode = "dynamic_assembly";
      taskData.dag = task.matchResult.dag ?? null;
    }

    const created = await createAndStart(taskData);
    if (created) {
      updateTask(queueId, { status: "executing", taskId: created.id });
      toast.success("任务已启动", {
        description: task.userQuery.slice(0, 60),
        icon: brandIcon,
      });
    } else {
      updateTask(queueId, { status: "failed", error: "创建任务失败" });
      toast.error("创建任务失败", {
        icon: errorIcon,
      });
    }
  }, [tasks, createAndStart, updateTask]);

  /** 重试任务 — 重新匹配 */
  const handleRetry = useCallback(async (queueId: string) => {
    const task = tasks.find(t => t.id === queueId);
    if (!task) return;

    updateTask(queueId, { status: "matching", matchResult: undefined, error: undefined });
    setActiveTaskId(queueId);

    const result = await doMatch(task.userQuery, task.teamId);
    if (result) {
      updateTask(queueId, { status: "matched", matchResult: result });
    } else {
      updateTask(queueId, { status: "failed", error: "匹配服务不可用" });
    }
  }, [tasks, doMatch, updateTask]);

  /** 移除任务 — 自动选中最近的任务 */
  const handleRemove = useCallback((queueId: string) => {
    setTasks(prev => {
      const next = prev.filter(t => t.id !== queueId);
      if (activeTaskId === queueId && next.length > 0) {
        const removedIdx = prev.findIndex(t => t.id === queueId);
        const newActive = next[Math.min(removedIdx, next.length - 1)];
        setActiveTaskId(newActive.id);
      } else if (activeTaskId === queueId) {
        setActiveTaskId(undefined);
      }
      return next;
    });
  }, [activeTaskId]);

  /** 选中任务 */
  const handleSelectTask = useCallback((id: string) => {
    setActiveTaskId(id);
  }, []);

  return {
    tasks,
    activeTaskId,
    activeTask,
    setActiveTaskId,
    updateTask,
    handleSubmit,
    handleConfirm,
    handleRetry,
    handleRemove,
    handleSelectTask,
  };
}
