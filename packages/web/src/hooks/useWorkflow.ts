/** Workflow CRUD hooks */

"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { APIResponse, Workflow, WorkflowCreate, WorkflowUpdate } from "@/lib/types";

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<APIResponse<Workflow[]>>("/workflows");
      setWorkflows(res.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { workflows, loading, error, refetch: fetchAll };
}

export function useWorkflow(id: string | null) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) {
      setWorkflow(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .get<APIResponse<Workflow>>(`/workflows/${id}`)
      .then((res) => setWorkflow(res.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load workflow"))
      .finally(() => setLoading(false));
  }, [id, refreshKey]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { workflow, loading, error, refetch };
}

export function useWorkflowActions() {
  const create = useCallback(async (body: WorkflowCreate) => {
    const res = await api.post<APIResponse<Workflow>>("/workflows", body);
    return res.data!;
  }, []);

  const update = useCallback(async (id: string, body: WorkflowUpdate) => {
    const res = await api.put<APIResponse<Workflow>>(`/workflows/${id}`, body);
    return res.data!;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.delete(`/workflows/${id}`);
  }, []);

  return { create, update, remove };
}
