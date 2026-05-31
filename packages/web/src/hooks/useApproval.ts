/** Approval API hook */

"use client";

import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import type { APIResponse, Approval, ApprovalResolve } from "@/lib/types";

export function useApprovals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get<APIResponse<Approval[]>>("/approvals");
      setApprovals(res.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载审批列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const resolve = useCallback(
    async (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
      const body: ApprovalResolve = { status, result };
      await api.post<APIResponse<Approval>>(`/approvals/${id}/resolve`, body);
      // 刷新列表
      await fetchAll();
    },
    [fetchAll]
  );

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  return { approvals, pending, resolved, loading, error, resolve, refetch: fetchAll };
}
