/** 断点调试控制台 */

"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Play, SkipForward, Pause, CircleDot, Terminal } from "lucide-react";
import JsonViewer from "@/components/shared/JsonViewer";

export interface Breakpoint {
  nodeId: string;
  nodeName?: string;
  stepIndex?: number;
  hit: boolean;
  data?: Record<string, unknown>;
}

interface DebugConsoleProps {
  breakpoints: Breakpoint[];
  isPaused: boolean;
  onAddBreakpoint: (nodeId: string) => void;
  onRemoveBreakpoint: (nodeId: string) => void;
  onContinue: () => void;
  onStep: () => void;
  onAbort: () => void;
  className?: string;
}

export function DebugConsole({
  breakpoints,
  isPaused,
  onAddBreakpoint,
  onRemoveBreakpoint,
  onContinue,
  onStep,
  onAbort,
  className,
}: DebugConsoleProps) {
  const [newNodeId, setNewNodeId] = useState("");

  const handleAdd = useCallback(() => {
    if (newNodeId.trim()) {
      onAddBreakpoint(newNodeId.trim());
      setNewNodeId("");
    }
  }, [newNodeId, onAddBreakpoint]);

  return (
    <div className={cn("flex flex-col h-full border border-border rounded-xl bg-card", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-brand" />
          <span className="text-sm font-medium text-foreground">调试控制台</span>
          {isPaused && (
            <span className="rounded-full bg-amber/20 px-2 py-0.5 text-[10px] font-medium text-amber">已暂停</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onContinue} disabled={!isPaused} className="h-7 w-7 p-0" title="继续">
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onStep} disabled={!isPaused} className="h-7 w-7 p-0" title="单步">
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onAbort} className="h-7 w-7 p-0 text-destructive" title="终止">
            <Pause className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Add breakpoint */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <input
          value={newNodeId}
          onChange={(e) => setNewNodeId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="输入节点 ID..."
          className="flex-1 h-7 rounded-md border border-border bg-surface px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <Button size="sm" variant="outline" onClick={handleAdd} className="h-7 text-xs gap-1">
          <CircleDot className="h-3 w-3" />添加
        </Button>
      </div>

      {/* Breakpoint list */}
      <div className="flex-1 overflow-auto">
        {breakpoints.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
            暂无断点
          </div>
        ) : (
          <div className="divide-y divide-border">
            {breakpoints.map((bp) => (
              <div key={bp.nodeId} className={cn("px-4 py-2.5", bp.hit && "bg-amber/5")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CircleDot className={cn("h-3 w-3", bp.hit ? "text-amber" : "text-muted-foreground")} />
                    <span className="text-xs font-medium text-foreground">{bp.nodeName || bp.nodeId}</span>
                    {bp.hit && <span className="text-[10px] text-amber">命中</span>}
                  </div>
                  <button
                    onClick={() => onRemoveBreakpoint(bp.nodeId)}
                    className="text-muted-foreground hover:text-destructive text-xs"
                  >
                    ✕
                  </button>
                </div>
                {bp.hit && bp.data && (
                  <div className="mt-1.5 ml-5">
                    <JsonViewer data={bp.data} maxDepth={3} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
