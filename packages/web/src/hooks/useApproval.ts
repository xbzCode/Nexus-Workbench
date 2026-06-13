/** Approval API hook — 分页 + 筛选 + 搜索 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { APIResponse, Approval, ApprovalListData, ApprovalStatus, ApprovalType, ApprovalSource, ApprovalUrgency } from "@/lib/types";

export interface ApprovalFilters {
  status?: ApprovalStatus | "all";
  type?: ApprovalType | "all";
  source?: ApprovalSource | "all";
  urgency?: ApprovalUrgency | "all";
  search?: string;
  task_id?: string;
}

export interface StatusCounts {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  auto_approved: number;
}

const STATUS_KEYS: ApprovalStatus[] = ["pending", "approved", "rejected", "expired", "auto_approved"];

export function useApprovals(initialFilters?: ApprovalFilters) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ApprovalFilters>(initialFilters ?? { status: "all" });
  const [offset, setOffset] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({ all: 0, pending: 0, approved: 0, rejected: 0, expired: 0, auto_approved: 0 });
  const limit = 50;
  const mountedRef = useRef(true);

  // 独立获取各状态计数（不受当前筛选影响）
  const fetchStatusCounts = useCallback(async () => {
    try {
      const counts: StatusCounts = { all: 0, pending: 0, approved: 0, rejected: 0, expired: 0, auto_approved: 0 };
      // 并发查询各状态 total
      const results = await Promise.all(
        STATUS_KEYS.map(async (status) => {
          const res = await api.get<APIResponse<ApprovalListData>>("/approvals", { status, limit: "1" });
          return { status, total: res.data?.total ?? 0 };
        })
      );
      if (!mountedRef.current) return;
      for (const { status, total: count } of results) {
        counts[status] = count;
        counts.all += count;
      }
      setStatusCounts(counts);
    } catch {
      // 计数获取失败不影响主流程
    }
  }, []);

  const fetchAll = useCallback(async (newFilters?: ApprovalFilters, newOffset?: number) => {
    const f = newFilters ?? filters;
    const o = newOffset ?? offset;
    try {
      const params: Record<string, string> = {
        limit: String(limit),
        offset: String(o),
      };
      if (f.status && f.status !== "all") params.status = f.status;
      if (f.type && f.type !== "all") params.type = f.type;
      if (f.source && f.source !== "all") params.source = f.source;
      if (f.urgency && f.urgency !== "all") params.urgency = f.urgency;
      if (f.search) params.search = f.search;
      if (f.task_id) params.task_id = f.task_id;

      const res = await api.get<APIResponse<ApprovalListData>>("/approvals", params);
      if (mountedRef.current) {
        setApprovals(res.data?.items ?? []);
        setTotal(res.data?.total ?? 0);
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "加载审批列表失败");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [filters, offset]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    fetchStatusCounts();
    return () => { mountedRef.current = false; };
  }, [fetchAll, fetchStatusCounts]);

  const resolve = useCallback(
    async (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => {
      try {
        const body = { status, result };
        await api.post<APIResponse<Approval>>(`/approvals/${id}/resolve`, body);
        await fetchAll();
        await fetchStatusCounts();
      } catch (e: unknown) {
        // 审批可能已过期/已被处理，刷新列表让 UI 同步最新状态
        await fetchAll();
        await fetchStatusCounts();
        const msg = e instanceof Error ? e.message : "操作失败";
        toast.error(msg);
        throw e; // 让调用方也知道失败了
      }
    },
    [fetchAll, fetchStatusCounts]
  );

  const updateFilters = useCallback((newFilters: ApprovalFilters) => {
    setFilters(newFilters);
    setOffset(0);
    setLoading(true);
    fetchAll(newFilters, 0);
  }, [fetchAll]);

  const loadMore = useCallback(() => {
    const newOffset = offset + limit;
    setOffset(newOffset);
    fetchAll(filters, newOffset);
  }, [offset, filters, fetchAll]);

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  return {
    approvals, pending, resolved, total, statusCounts,
    loading, error, resolve, refetch: fetchAll,
    filters, updateFilters, loadMore,
    hasMore: offset + approvals.length < total,
  };
}
