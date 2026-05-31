/** DAG 自定义节点 — 状态色 + 配置入口 */

"use client";

import { Handle, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Settings2 } from "lucide-react";

export interface DagNodeData {
  label: string;
  definition_id: string;
  status?: string;
  config?: Record<string, unknown>;
  onConfigClick?: (nodeId: string) => void;
  [key: string]: unknown;
}

const NODE_STATUS_STYLES: Record<string, string> = {
  pending:   "border-amber/50 bg-amber-muted",
  running:   "border-brand/60 bg-brand-muted shadow-md shadow-brand-muted",
  completed: "border-emerald-400/50 bg-emerald-500/10",
  failed:    "border-red-400/50 bg-red-500/10",
  skipped:   "border-muted bg-muted",
};

interface DagNodeProps {
  id: string;
  data: DagNodeData;
}

export function DagNodeComponent({ id, data }: DagNodeProps) {
  const borderStyle = data.status
    ? NODE_STATUS_STYLES[data.status] ?? "border-border bg-card"
    : "border-border bg-card";

  return (
    <div
      className={cn(
        "min-w-[150px] rounded-xl border-2 px-4 py-2.5 shadow-sm transition-all group",
        borderStyle
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-foreground/30"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {data.label}
        </span>
        <div className="flex items-center gap-1">
          {data.onConfigClick && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onConfigClick?.(id);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 flex items-center justify-center rounded hover:bg-foreground/10"
              title="节点配置"
            >
              <Settings2 className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
          {data.status && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 py-0 text-[10px]"
            >
              {data.status}
            </Badge>
          )}
        </div>
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {data.definition_id}
      </p>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-foreground/30"
      />
    </div>
  );
}
