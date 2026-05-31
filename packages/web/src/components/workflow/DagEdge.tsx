/** DAG 自定义边 — 带条件表达式标签 + 选中高亮 */

"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { cn } from "@/lib/utils";

export interface DagEdgeData {
  condition?: string | null;
  onConditionClick?: (edgeId: string, sourceId: string, targetId: string) => void;
  [key: string]: unknown;
}

export function DagEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const condition = (data as DagEdgeData)?.condition;
  const onConditionClick = (data as DagEdgeData)?.onConditionClick;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "var(--color-brand)" : "var(--color-muted-foreground)",
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: condition ? "6 3" : undefined,
          opacity: selected ? 1 : 0.6,
        }}
      />
      {/* 条件表达式标签 */}
      {(condition || onConditionClick) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConditionClick?.(id, "", "");
              }}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] transition-colors cursor-pointer whitespace-nowrap",
                condition
                  ? "bg-brand/20 text-brand border border-brand/30 hover:bg-brand/30"
                  : "bg-muted text-muted-foreground border border-border hover:bg-surface-hover"
              )}
            >
              {condition || "+ 条件"}
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
