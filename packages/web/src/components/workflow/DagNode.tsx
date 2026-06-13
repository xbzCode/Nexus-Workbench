/** DAG 自定义节点 — memo 优化 + 删除/配置操作按钮 */

"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Settings2, X } from "lucide-react";

export interface DagNodeData {
  label: string;
  definition_id: string;
  displayName?: string;
  icon?: string;
  accentColor?: string;
  status?: string;
  config?: Record<string, unknown>;
  onConfigClick?: (nodeId: string) => void;
  onDeleteClick?: (nodeId: string) => void;
  selected?: boolean;
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
  selected?: boolean;
}

export const DagNodeComponent = memo(function DagNodeComponent({ id, data, selected }: DagNodeProps) {
  const statusStyle = data.status
    ? NODE_STATUS_STYLES[data.status] ?? "border-border bg-card"
    : "border-border bg-card";
  const accentColor = data.accentColor ?? "var(--color-muted-foreground)";
  const icon = data.icon ?? "⚙️";
  const isEditable = !!(data.onConfigClick || data.onDeleteClick);

  return (
    <div
      className={cn(
        "min-w-[160px] rounded-xl border-2 px-3 py-2.5 shadow-sm group relative",
        statusStyle,
        selected && !data.status && "border-brand/50 shadow-md shadow-brand/10",
        isEditable && "hover:shadow-md"
      )}
      style={{
        borderColor: data.status
          ? undefined
          : selected
            ? undefined
            : accentColor + "40",
        transition: "box-shadow 0.15s ease, border-color 0.15s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0"
        style={{ backgroundColor: accentColor + "60" }}
      />

      <div className="flex items-center gap-2.5">
        {/* 类型图标 */}
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm"
          style={{ backgroundColor: accentColor + "15" }}
        >
          <span>{icon}</span>
        </div>

        {/* 文本信息 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {data.displayName || data.label}
            </span>
            {data.status && (
              <Badge
                variant="outline"
                className="h-4 px-1 py-0 text-[9px] shrink-0"
              >
                {data.status}
              </Badge>
            )}
          </div>
          <p className="truncate text-[10px] text-muted-foreground/60 font-mono">
            {data.label}
          </p>
        </div>

        {/* 操作按钮区域 — 编辑模式下 hover 显示 */}
        {isEditable && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {data.onConfigClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  data.onConfigClick?.(id);
                }}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-foreground/10"
                title="节点配置"
              >
                <Settings2 className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
            {data.onDeleteClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  data.onDeleteClick?.(id);
                }}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10"
                title="删除节点"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            )}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0"
        style={{ backgroundColor: accentColor + "60" }}
      />
    </div>
  );
});
