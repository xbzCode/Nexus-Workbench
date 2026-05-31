/** SSE EventSource 封装 */

import type { SSEEvent } from "./types";

interface SSEOptions {
  /** 连接成功回调 */
  onOpen?: () => void;
  /** 连接错误回调 */
  onError?: (err: Event) => void;
}

/**
 * 创建 SSE 连接，返回迭代器风格的消费函数
 *
 * 用法:
 * ```ts
 * // 全局事件
 * const { subscribe, disconnect } = createSSE("/api/events/stream");
 *
 * // 按任务过滤
 * const { subscribe, disconnect } = createSSE("/api/events/stream", { taskId: "xxx" });
 *
 * subscribe((event) => console.log(event));
 * // 清理
 * disconnect();
 * ```
 */
export function createSSE(baseUrl: string, options: SSEOptions & { taskId?: string } = {}) {
  let eventSource: EventSource | null = null;
  const listeners: Set<(event: SSEEvent) => void> = new Set();

  const { taskId, ...sseOptions } = options;

  function connect() {
    // 构建 URL：如有 taskId 则附加查询参数
    const url = taskId
      ? `${baseUrl}?task_id=${encodeURIComponent(taskId)}`
      : baseUrl;

    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseOptions.onOpen?.();
    };

    eventSource.onmessage = (e) => {
      // 跳过心跳
      if (e.data === "") return;

      try {
        const parsed: SSEEvent = JSON.parse(e.data);
        listeners.forEach((fn) => fn(parsed));
      } catch {
        // 非JSON数据忽略
      }
    };

    eventSource.onerror = (err) => {
      sseOptions.onError?.(err);
      // 自动重连由 EventSource 内置处理
    };
  }

  function subscribe(fn: (event: SSEEvent) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    listeners.clear();
  }

  connect();

  return { subscribe, disconnect };
}
