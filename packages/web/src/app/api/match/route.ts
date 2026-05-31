import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * 代理 /api/match 请求到后端，绕过 Next.js rewrite 的默认超时限制
 * 设定 3 分钟安全网超时，后端 LLM 匹配耗时不可预估
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1000); // 3 分钟

  try {
    const res = await fetch(`${BACKEND_URL}/api/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return NextResponse.json(
        { data: { mode: "bare_agent", reasoning: "匹配超时（3分钟），降级为裸 Agent" } },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { data: { mode: "bare_agent", reasoning: "匹配服务暂不可用，降级为裸 Agent" } },
      { status: 200 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
