/** SSE 实时事件 hook，支持按 task_id 过滤 */

"use client";

import { useEffect, useRef, useState } from "react";
import { createSSE } from "@/lib/sse";
import type { SSEEvent } from "@/lib/types";

interface UseSSEOptions {
  /** 按任务ID过滤，仅接收指定任务的事件 */
  taskId?: string;
  /** 最大保留事件数（默认100） */
  maxEvents?: number;
}

export function useSSE(url: string | null, options: UseSSEOptions = {}) {
  const { taskId, maxEvents = 100 } = options;
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const sseRef = useRef<ReturnType<typeof createSSE> | null>(null);

  useEffect(() => {
    if (!url) return;

    const sse = createSSE(url, {
      taskId,
      onOpen: () => setIsConnected(true),
      onError: () => setIsConnected(false),
    });

    const unsubscribe = sse.subscribe((event) => {
      setEvents((prev) => [...prev.slice(-(maxEvents - 1)), event]);
    });

    sseRef.current = sse;

    return () => {
      unsubscribe();
      sse.disconnect();
      setIsConnected(false);
    };
  }, [url, taskId, maxEvents]);

  const clearEvents = () => setEvents([]);

  return { events, isConnected, clearEvents };
}
