/** 节点配置面板 — 侧边栏形式 */

"use client";

import { useState } from "react";
import { X, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeInstance } from "@/lib/types";

interface NodeConfigPanelProps {
  node: NodeInstance | null;
  onSave: (nodeId: string, config: Record<string, unknown>) => void;
  onClose: () => void;
  className?: string;
}

export function NodeConfigPanel({
  node,
  onSave,
  onClose,
  className,
}: NodeConfigPanelProps) {
  const [configJson, setConfigJson] = useState(() => {
    if (!node?.config) return "{}";
    try {
      return JSON.stringify(node.config, null, 2);
    } catch {
      return "{}";
    }
  });
  const [error, setError] = useState<string | null>(null);

  if (!node) return null;

  const handleSave = () => {
    try {
      const parsed = JSON.parse(configJson);
      setError(null);
      onSave(node.id, parsed);
    } catch {
      setError("JSON 格式错误");
    }
  };

  return (
    <div
      className={cn(
        "w-72 border-l border-border bg-card flex flex-col h-full",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate">
            {node.id}
          </h3>
          <p className="text-xs text-muted-foreground truncate">
            {node.definition_id}
          </p>
        </div>
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-surface-hover text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Config editor */}
      <div className="flex-1 p-4 space-y-3 overflow-auto">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            节点配置 (JSON)
          </label>
          <textarea
            value={configJson}
            onChange={(e) => {
              setConfigJson(e.target.value);
              setError(null);
            }}
            className={cn(
              "w-full h-48 rounded-lg border bg-slate-900/50 p-3 text-xs font-mono text-slate-300 resize-none focus:outline-none focus:ring-1",
              error
                ? "border-red-500/50 focus:ring-red-500"
                : "border-border focus:ring-brand"
            )}
            spellCheck={false}
          />
          {error && (
            <p className="mt-1 text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Position info */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            位置
          </label>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
              x: {node.position?.x ?? 0}
            </span>
            <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
              y: {node.position?.y ?? 0}
            </span>
          </div>
        </div>

        {/* Hooks info */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            钩子 ({node.hooks?.length ?? 0})
          </label>
          {(node.hooks?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground/60">暂无钩子</p>
          ) : (
            <div className="space-y-1">
              {node.hooks?.map((h, i) => (
                <div key={i} className="px-2 py-1 rounded bg-muted text-xs text-muted-foreground">
                  {JSON.stringify(h)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 transition-opacity"
        >
          <Save className="h-3.5 w-3.5" />
          保存配置
        </button>
      </div>
    </div>
  );
}
