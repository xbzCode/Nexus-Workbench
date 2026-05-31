/** Task API hooks */

"use client";

import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { APIResponse, Task, TaskCreate } from "@/lib/types";

/** 创建并启动任务 */
export function useTaskCreate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAndStart = useCallback(async (data: TaskCreate) => {
    setLoading(true);
    setError(null);
    try {
      // 1. 创建任务
      const createRes = await api.post<APIResponse<Task>>("/tasks", data);
      const task = createRes.data;
      if (!task) throw new Error("创建任务返回空数据");

      // 2. 启动任务
      await api.post<APIResponse<Task>>(`/tasks/${task.id}/start`);

      // 3. 获取最新状态
      const latestRes = await api.get<APIResponse<Task>>(`/tasks/${task.id}`);
      return latestRes.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "创建任务失败";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createAndStart, loading, error };
}
