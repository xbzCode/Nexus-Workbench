"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { APIResponse, Team, TeamCreate, TeamUpdate } from "@/lib/types";

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<APIResponse<Team[]>>("/teams");
      if (res.success && res.data) {
        setTeams(res.data);
      } else {
        setError(res.message || "Failed to load teams");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const createTeam = useCallback(async (data: TeamCreate): Promise<Team | null> => {
    try {
      const res = await api.post<APIResponse<Team>>("/teams", data);
      if (res.success && res.data) {
        setTeams(prev => [...prev, res.data!]);
        return res.data;
      }
      throw new Error(res.message || "Failed to create team");
    } catch (err: unknown) {
      throw err;
    }
  }, []);

  const updateTeam = useCallback(async (id: string, data: TeamUpdate): Promise<Team | null> => {
    try {
      const res = await api.patch<APIResponse<Team>>(`/teams/${id}`, data);
      if (res.success && res.data) {
        setTeams(prev => prev.map(t => t.id === id ? res.data! : t));
        return res.data;
      }
      throw new Error(res.message || "Failed to update team");
    } catch (err: unknown) {
      throw err;
    }
  }, []);

  const deleteTeam = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await api.delete<APIResponse<null>>(`/teams/${id}`);
      if (res.success) {
        setTeams(prev => prev.filter(t => t.id !== id));
        return true;
      }
      throw new Error(res.message || "Failed to delete team");
    } catch (err: unknown) {
      throw err;
    }
  }, []);

  return {
    teams,
    loading,
    error,
    refetch: fetchTeams,
    createTeam,
    updateTeam,
    deleteTeam,
  };
}
