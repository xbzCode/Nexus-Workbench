/** Describe 结果展示 — SKILL.md 预览 或 DAG 工作流草稿 */

"use client";

import { useState } from "react";
import type { DescribeNodeResponse, DescribeWorkflowResponse, DAGDefinition } from "@/lib/types";

interface DescribeNodeResultProps {
  result: DescribeNodeResponse;
  onConfirm: (skillMd: string, overrides?: Record<string, string>) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DescribeNodeResult({ result, onConfirm, onCancel, loading }: DescribeNodeResultProps) {
  const [editName, setEditName] = useState(result.suggested.name || "");
  const [editDisplayName, setEditDisplayName] = useState(result.suggested.display_name || "");

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-violet-400 text-lg">✨</span>
        <span className="font-medium text-violet-300">AI 生成节点定义</span>
      </div>

      {/* 可编辑字段 */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <label className="text-slate-400 block mb-1">节点名称 (name)</label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1">显示名称</label>
          <input
            value={editDisplayName}
            onChange={(e) => setEditDisplayName(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
          />
        </div>
      </div>

      {/* SKILL.md 预览 */}
      <div>
        <p className="text-slate-400 text-xs mb-1">SKILL.md 预览</p>
        <pre className="bg-slate-900/80 rounded p-3 text-xs text-slate-300 max-h-60 overflow-auto whitespace-pre-wrap border border-slate-700">
          {result.skill_md}
        </pre>
      </div>

      {/* 操作 */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded border border-slate-600 text-slate-400 hover:bg-slate-800"
          disabled={loading}
        >
          取消
        </button>
        <button
          onClick={() => onConfirm(result.skill_md, { name: editName, display_name: editDisplayName })}
          className="px-3 py-1.5 text-sm rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "注册中..." : "确认注册"}
        </button>
      </div>
    </div>
  );
}

interface DescribeWorkflowResultProps {
  result: DescribeWorkflowResponse;
  onConfirm: (name: string, dag: DAGDefinition) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DescribeWorkflowResult({ result, onConfirm, onCancel, loading }: DescribeWorkflowResultProps) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-400 text-lg">🔄</span>
        <span className="font-medium text-amber-300">AI 生成工作流</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-slate-400 text-xs">名称</p>
          <p className="text-slate-200">{result.name}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs">显示名</p>
          <p className="text-slate-200">{result.display_name}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs">分类</p>
          <p className="text-slate-200">{result.category || "-"}</p>
        </div>
      </div>

      {result.description && (
        <p className="text-sm text-slate-300">{result.description}</p>
      )}

      {/* DAG 概览 */}
      <div>
        <p className="text-slate-400 text-xs mb-1">DAG 节点 ({result.dag.nodes.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {result.dag.nodes.map((n) => (
            <span key={n.id} className="px-2 py-0.5 bg-amber-900/30 border border-amber-700/40 rounded text-xs text-amber-300">
              {n.definition_id}
            </span>
          ))}
        </div>
      </div>

      {result.dag.edges.length > 0 && (
        <div>
          <p className="text-slate-400 text-xs mb-1">连线 ({result.dag.edges.length})</p>
          <div className="flex flex-wrap gap-1.5 text-xs text-slate-400">
            {result.dag.edges.map((e, i) => (
              <span key={i} className="px-2 py-0.5 bg-slate-800 rounded">
                {e.source_id} → {e.target_id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 操作 */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded border border-slate-600 text-slate-400 hover:bg-slate-800"
          disabled={loading}
        >
          取消
        </button>
        <button
          onClick={() => onConfirm(result.name, result.dag)}
          className="px-3 py-1.5 text-sm rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "保存中..." : "确认保存"}
        </button>
      </div>
    </div>
  );
}
