/** Match API hook */

"use client";

import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { APIResponse, MatchResult } from "@/lib/types";

export function useMatch() {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const match = useCallback(async (userInput: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // 3 分钟安全网超时，后端耗时不可预估，正常等待即可
      const res = await api.post<APIResponse<MatchResult>>("/match", {
        user_input: userInput,
      }, 3 * 60 * 1000);
      setResult(res.data);
      return res.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "匹配失败";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { result, loading, error, match, reset };
}
