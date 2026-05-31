/** 快照对比组件 — 显示 pre/post 步骤的差异 */

"use client";

import { cn } from "@/lib/utils";
import { GitCompare, ArrowRight } from "lucide-react";
import JsonViewer from "@/components/shared/JsonViewer";

export interface SnapshotPair {
  stepId: string;
  nodeName?: string;
  preSnapshot?: Record<string, unknown> | null;
  postSnapshot?: Record<string, unknown> | null;
  timestamp?: string;
}

interface SnapshotDiffProps {
  snapshots: SnapshotPair[];
  className?: string;
}

function computeChanges(pre: Record<string, unknown> | null | undefined, post: Record<string, unknown> | null | undefined) {
  const changes: { key: string; type: "added" | "removed" | "changed"; old?: unknown; new?: unknown }[] = [];
  const allKeys = new Set([...Object.keys(pre || {}), ...Object.keys(post || {})]);
  for (const key of allKeys) {
    const inPre = pre && key in pre;
    const inPost = post && key in post;
    if (!inPre && inPost) changes.push({ key, type: "added", new: post![key] });
    else if (inPre && !inPost) changes.push({ key, type: "removed", old: pre![key] });
    else if (inPre && inPost && JSON.stringify(pre![key]) !== JSON.stringify(post![key]))
      changes.push({ key, type: "changed", old: pre![key], new: post![key] });
  }
  return changes;
}

const CHANGE_STYLE: Record<string, string> = {
  added: "text-emerald-400 bg-emerald-500/10",
  removed: "text-red-400 bg-red-500/10",
  changed: "text-amber bg-amber/10",
};

export function SnapshotDiff({ snapshots, className }: SnapshotDiffProps) {
  if (!snapshots.length) {
    return <div className={cn("flex items-center justify-center h-32 text-sm text-muted-foreground", className)}>暂无快照数据</div>;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {snapshots.map((snap) => {
        const changes = computeChanges(snap.preSnapshot, snap.postSnapshot);
        return (
          <div key={snap.stepId} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-brand" />
                <span className="text-sm font-medium text-foreground">{snap.nodeName || snap.stepId}</span>
              </div>
              {snap.timestamp && <span className="text-xs text-muted-foreground">{new Date(snap.timestamp).toLocaleString("zh-CN")}</span>}
            </div>

            {changes.length > 0 ? (
              <div className="space-y-1.5">
                {changes.map((c) => (
                  <div key={c.key} className={cn("rounded-md px-3 py-1.5 text-xs", CHANGE_STYLE[c.type])}>
                    <span className="font-mono font-medium">{c.key}</span>
                    <span className="mx-1 opacity-60">{c.type === "added" ? "+" : c.type === "removed" ? "-" : "→"}</span>
                    {c.type === "changed" && (
                      <>
                        <span className="line-through opacity-60">{JSON.stringify(c.old)}</span>
                        <ArrowRight className="inline h-3 w-3 mx-1" />
                        <span>{JSON.stringify(c.new)}</span>
                      </>
                    )}
                    {c.type === "added" && <span>{JSON.stringify(c.new)}</span>}
                    {c.type === "removed" && <span className="line-through">{JSON.stringify(c.old)}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">无变化</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {snap.preSnapshot && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">执行前</p>
                  <JsonViewer data={snap.preSnapshot} maxDepth={2} />
                </div>
              )}
              {snap.postSnapshot && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">执行后</p>
                  <JsonViewer data={snap.postSnapshot} maxDepth={2} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
