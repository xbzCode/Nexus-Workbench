/** API 客户端骨架 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  timeoutMs?: number;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, timeoutMs, ...fetchOptions } = options;
    const url = this.buildUrl(path, params);

    // AbortController 超时控制
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...fetchOptions.headers,
        },
        ...fetchOptions,
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: res.statusText }));
        throw new ApiError(res.status, error.message || "Request failed");
      }

      return res.json();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new ApiError(408, `请求超时（${Math.round((timeoutMs ?? 0) / 1000)}s）`);
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get<T>(path: string, params?: Record<string, string>) {
    return this.request<T>(path, { method: "GET", params });
  }

  post<T>(path: string, body?: unknown, timeoutMs?: number) {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
    });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const api = new ApiClient(API_BASE);
export { ApiError };
