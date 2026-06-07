/** TaskBottomPanel — 可调整大小的底部 Tab 面板 */

"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import ApprovalCard from "@/components/approval/ApprovalCard";
import { Button } from "@/components/ui/button";
import type { Approval, SnapshotItem, ExecutionPathItem, FileEntry } from "@/lib/types";
import {
  Bell, ScrollText, Camera, Route, FileText, Folder,
  GripVertical, RotateCcw, Star, Download, Loader2,
  FileCode, Eye,
} from "lucide-react";

type BottomTab = "log" | "approval" | "snapshots" | "paths" | "files";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fp: string) {
  if (/\.(tsx?|jsx?|py)$/.test(fp)) return FileCode;
  if (/\.(json|yml|yaml|toml|xml|md|txt|log)$/.test(fp)) return FileText;
  return File;
}

interface TaskBottomPanelProps {
  activeTab: BottomTab;
  setActiveTab: (tab: BottomTab) => void;
  height: number;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent) => void;

  // Data
  taskId: string;
  approvals: Approval[];
  pendingApprovals: Approval[];
  snapshots: SnapshotItem[];
  execPaths: ExecutionPathItem[];
  files: FileEntry[];
  logEvents: { event: string; data: Record<string, unknown>; ts?: string }[];

  // Callbacks
  onResolveApproval: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  onApprovalDetail: (approval: Approval) => void;
  onRollback: (id: string) => void;
  onPrecipitate: (id: string) => void;
  onRatePath: (id: string, rating: number) => void;
  onPreviewFile: (filePath: string) => void;
  actionLoading: string | null;
}

export default function TaskBottomPanel({
  activeTab, setActiveTab, height, isResizing, onResizeStart,
  taskId, approvals, pendingApprovals, snapshots, execPaths, files, logEvents,
  onResolveApproval, onApprovalDetail, onRollback, onPrecipitate, onRatePath, onPreviewFile, actionLoading,
}: TaskBottomPanelProps) {
  const BOTTOM_TABS: { key: BottomTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: "log", label: "Logs", icon: ScrollText },
    { key: "approval", label: "Approvals", icon: Bell, badge: pendingApprovals.length || undefined },
    { key: "snapshots", label: "Snapshots", icon: Camera, badge: snapshots.length || undefined },
    { key: "paths", label: "Paths", icon: Route, badge: execPaths.length || undefined },
    { key: "files", label: "Files", icon: FileText, badge: files.length || undefined },
  ];

  return (
    <div className="shrink-0 border-t border-border bg-background flex flex-col" style={{ height }}>
      {/* Drag handle */}
      <div
        className={cn(
          "flex items-center justify-center cursor-row-resize py-1 hover:bg-surface-hover/40 transition-colors select-none",
          isResizing && "bg-brand/5"
        )}
        onMouseDown={onResizeStart}
      >
        <GripVertical className={cn("h-4 w-4 text-muted-foreground/30", isResizing && "text-brand/50")} />
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-border/60 bg-surface-hover/20 px-4">
        {BOTTOM_TABS.map(tab => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.key}
              className={cn(
                "relative flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
                activeTab === tab.key ? "text-brand" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              <TabIcon className="h-3.5 w-3.5" />{tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className={cn(
                  "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                  tab.key === "approval" ? "bg-amber" : "bg-muted-foreground/50"
                )}>{tab.badge}</span>
              )}
              {activeTab === tab.key && (
                <motion.span layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" transition={{ type: "spring", stiffness: 500, damping: 35 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="overflow-y-auto px-5 py-3 flex-1" style={{ minHeight: 0 }}>
        {/* Logs */}
        {activeTab === "log" && (
          <div className="font-mono text-xs space-y-px">
            {logEvents.length === 0 && <div className="text-muted-foreground py-6 text-center text-[13px]">No logs yet</div>}
            {logEvents.map((evt, i) => {
              const isNodeEvent = evt.event.startsWith("dag:node_");
              const isApprovalEvent = evt.event.startsWith("approval:");
              const summary = isNodeEvent
                ? `Node: ${String(evt.data.node_id ?? "").slice(0, 24)}`
                : isApprovalEvent ? `Approval: ${String(evt.data.title ?? evt.data.approval_id ?? "").slice(0, 24)}` : "";
              return (
                <div key={i} className="flex items-start gap-2.5 py-1 text-muted-foreground hover:bg-surface-hover/40 rounded px-2 -mx-2 transition-colors">
                  <span className="shrink-0 text-muted-foreground/30 w-16 text-right tabular-nums leading-5">
                    {evt.ts ? new Date(evt.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
                  </span>
                  <span className={cn(
                    "shrink-0 w-[150px] truncate font-medium leading-5",
                    evt.event.includes("completed") || evt.event.includes("resolved") ? "text-emerald-400/70" :
                    evt.event.includes("failed") || evt.event.includes("error") ? "text-red-400/70" :
                    evt.event.includes("started") ? "text-brand/70" :
                    evt.event.includes("approval") ? "text-amber/70" : ""
                  )} title={evt.event}>{evt.event}</span>
                  {summary && (<span className="shrink-0 w-[200px] truncate text-foreground/60 leading-5" title={summary}>{summary}</span>)}
                  {!summary && Object.keys(evt.data).length > 0 && (
                    <span className="text-foreground/40 break-all leading-5 line-clamp-1">{JSON.stringify(evt.data).slice(0, 120)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Approvals */}
        {activeTab === "approval" && (
          <div className="space-y-3">
            {approvals.length === 0 && (
              <div className="text-muted-foreground py-8 text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 opacity-40" />No approvals
              </div>
            )}
            {pendingApprovals.length > 0 && (
              <div className="text-xs font-medium text-amber uppercase tracking-wider mb-2">
                Pending ({pendingApprovals.length})
              </div>
            )}
            {pendingApprovals.map(a => (
              <ApprovalCard key={a.id} approval={a} onResolve={onResolveApproval} />
            ))}
            {approvals.filter(a => a.status !== "pending").length > 0 && (
              <>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 mt-4">Resolved</div>
                {approvals.filter(a => a.status !== "pending").map(a => (
                  <button key={a.id} onClick={() => onApprovalDetail(a)} className="block w-full text-left">
                    <ApprovalCard approval={a} compact />
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Snapshots */}
        {activeTab === "snapshots" && (
          <div className="space-y-2">
            {snapshots.length === 0 && (
              <div className="text-muted-foreground py-8 text-center">
                <Camera className="mx-auto mb-2 h-6 w-6 opacity-40" />No snapshots
              </div>
            )}
            {snapshots.map(snap => (
              <div key={snap.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-muted-foreground">{snap.git_commit_hash.slice(0, 8)}</span>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    snap.type === "pre_step" ? "bg-sky-500/10 text-sky-400" : "bg-emerald-500/10 text-emerald-400"
                  )}>{snap.type}</span>
                  <span className="text-muted-foreground">{new Date(snap.created_at).toLocaleString("zh-CN")}</span>
                </div>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onRollback(snap.id)} disabled={actionLoading === "rollback"}>
                  {actionLoading === "rollback" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}Rollback
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Paths */}
        {activeTab === "paths" && (
          <div className="space-y-2">
            {execPaths.length === 0 && (
              <div className="text-muted-foreground py-8 text-center">
                <Route className="mx-auto mb-2 h-6 w-6 opacity-40" />No execution paths
              </div>
            )}
            {execPaths.map(ep => (
              <div key={ep.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    ep.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                  )}>{ep.success ? "Success" : "Failed"}</span>
                  <span className="text-muted-foreground">{ep.source} &middot; {ep.total_duration?.toFixed(1)}s &middot; {ep.total_approvals} approvals</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(r => (
                      <Star
                        key={r}
                        className={cn("h-3 w-3 cursor-pointer transition-colors",
                          ep.user_rating && r <= ep.user_rating ? "text-amber fill-amber" : "text-muted-foreground/25 hover:text-amber/50")}
                        onClick={() => onRatePath(ep.id, r)}
                      />
                    ))}
                  </div>
                </div>
                {!ep.precipitated_to && (
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onPrecipitate(ep.id)}>
                    <Download className="h-3 w-3 mr-1" />Save
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Files */}
        {activeTab === "files" && (
          <div>
            {files.length === 0 && (
              <div className="text-muted-foreground py-8 text-center">
                <Folder className="mx-auto mb-2 h-6 w-6 opacity-40" />
                No output files<span className="block text-xs mt-1 opacity-60">Files appear after execution</span>
              </div>
            )}
            {files.length > 0 && (
              <>
                <div className="flex items-center justify-between px-2 pb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  <span>{files.length} files</span>
                  <div className="flex gap-8"><span>Size</span><span>Modified</span></div>
                </div>
                {files.map((f, i) => {
                  const FI = getFileIcon(f.path);
                  const isPreviewable = /\.(html?|png|jpe?g|gif|webp|svg|bmp|md|markdown|mdx|txt|json|yml|yaml|toml|xml|log|csv|tsv|py|js|ts|tsx|jsx|css|scss|less|go|rs|java|c|cpp|h|rb|php|sql|sh|bash|env|ini|cfg|conf)$/i.test(f.path);
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover text-xs transition-colors group">
                      <FI className="h-3.5 w-3.5 shrink-0 text-brand" />
                      <span className="flex-1 font-mono text-foreground/70 truncate min-w-0">{f.path}</span>
                      <span className="text-muted-foreground w-16 text-right shrink-0 tabular-nums">{formatFileSize(f.size)}</span>
                      <span className="text-muted-foreground w-20 text-right shrink-0">{new Date(f.modified_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isPreviewable && (
                          <button
                            onClick={() => onPreviewFile(f.path)}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-brand hover:bg-brand/10 transition-colors"
                            title="Preview"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <a
                          href={`/api/tasks/${taskId}/files/${f.path}?download=true`}
                          download
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-brand hover:bg-brand/10 transition-colors"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
