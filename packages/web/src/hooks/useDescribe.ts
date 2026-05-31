/** 自然语言创建节点/工作流 hook */

import { useState } from "react";
import { api } from "@/lib/api";
import type {
  APIResponse,
  DescribeNodeResponse,
  DescribeWorkflowResponse,
  NodeDefResponse,
  Workflow,
} from "@/lib/types";

export function useDescribe() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 自然语言 → SKILL.md 草稿 */
  async function describeNode(userInput: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<APIResponse<DescribeNodeResponse>>(
        "/describe/node",
        { user_input: userInput }
      );
      return res.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "生成节点失败";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  /** 确认 SKILL.md → 注册节点 */
  async function confirmNode(skillMd: string, overrides?: Record<string, string>) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<APIResponse<NodeDefResponse>>(
        "/describe/node/confirm",
        { skill_md: skillMd, overrides: overrides ?? null }
      );
      return res.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "确认节点失败";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  /** 自然语言 → DAG 工作流草稿 */
  async function describeWorkflow(userInput: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<APIResponse<DescribeWorkflowResponse>>(
        "/describe/workflow",
        { user_input: userInput }
      );
      return res.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "生成工作流失败";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  /** 确认 DAG → 保存工作流 */
  async function confirmWorkflow(
    name: string,
    options?: {
      description?: string;
      category?: string;
      dag?: Record<string, unknown>;
    }
  ) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<APIResponse<Workflow>>("/describe/workflow/confirm", {
        name,
        description: options?.description ?? null,
        category: options?.category ?? null,
        dag: options?.dag ?? null,
      });
      return res.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "确认工作流失败";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, describeNode, confirmNode, describeWorkflow, confirmWorkflow };
}
