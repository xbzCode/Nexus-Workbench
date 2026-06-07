/** 任务队列类型定义 — Chat 页面多任务模型 */

import type { MatchResult } from "@/lib/types";

// ── 任务队列状态 ──

export type TaskQueueStatus =
  | "matching"       // 匹配中（调用 /match API）
  | "matched"        // 匹配完成，待用户确认
  | "confirming"     // 用户点击了确认，正在创建任务
  | "executing"      // 任务执行中
  | "paused"         // 审批超时暂停，等待用户恢复
  | "completed"     // 执行完成
  | "failed";        // 失败（匹配失败 or 执行失败）

// ── 任务队列项 ──

export interface TaskQueueItem {
  /** 客户端生成的临时 ID */
  id: string;
  /** 用户输入的原始文本 */
  userQuery: string;
  /** 当前状态 */
  status: TaskQueueStatus;
  /** 创建时间 */
  createdAt: number;
  /** 用户选择的 Team ID（可选） */
  teamId?: string | null;
  /** 匹配结果（status >= matched 时存在） */
  matchResult?: MatchResult;
  /** 后端真实任务 ID（已创建时存在） */
  taskId?: string;
  /** 错误信息 */
  error?: string;
}

// ── 场景分类 ──

export interface SceneCategory {
  icon: string;      // lucide icon name (用于动态加载或静态引用)
  name: string;
  hint: string;
  color: string;     // tailwind text-* class
  prompt: string;    // 填入输入框的提示语
}

// ── 执行日志 ──

export interface ExecutionLog {
  id: number;
  event: string;
  node_id?: string;
  content: string;
  timestamp: number;
}
