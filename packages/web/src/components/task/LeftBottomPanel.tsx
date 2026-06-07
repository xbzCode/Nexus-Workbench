/** LeftBottomPanel — 左侧底部可折叠 Tab 面板（日志/审批/快照/路径/文件） */

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import ApprovalCard from "@/components/approval/ApprovalCard";
import { Button } from "@/components/ui/button";
import type { Approval, SnapshotItem, ExecutionPathItem, FileEntry } from "@/lib/types";
import {
  Bell, ScrollText, Camera, Route, File as FileIcon, FileText, Folder,
  ChevronUp, ChevronDown, RotateCcw, Star, Download, Loader2,
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
  return FileIcon;
}

interface LeftBottomPanelProps {
  taskId: string;
  approvals: Approval[];
  pendingApprovals: Approval[];
  snapshots: SnapshotItem[];
  execPaths: ExecutionPathItem[];
  files: FileEntry[];
  logEvents: { event: string; data: Record<string, unknown>; ts?: string }[];
  nodeNameMap?: Record<string, string>;

  // Callbacks
  onResolveApproval: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  onApprovalDetail: (approval: Approval) => void;
  onRollback: (id: string) => void;
  onPrecipitate: (id: string) => void;
  onRatePath: (id: string, rating: number) => void;
  onPreviewFile: (filePath: string) => void;
  actionLoading: string | null;
}

const PANEL_HEIGHT_EXPANDED = 280;
const PANEL_HEIGHT_COLLAPSED = 36;

export default function LeftBottomPanel({
  taskId, approvals, pendingApprovals, snapshots, execPaths, files, logEvents, nodeNameMap,
  onResolveApproval, onApprovalDetail, onRollback, onPrecipitate, onRatePath, onPreviewFile, actionLoading,
}: LeftBottomPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomTab>("log");
  const [isExpanded, setIsExpanded] = useState(false); // 默认折叠

  const TABS: { key: BottomTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: "log", label: "日志", icon: ScrollText },
    { key: "approval", label: "审批", icon: Bell, badge: pendingApprovals.length || undefined },
    { key: "snapshots", label: "快照", icon: Camera, badge: snapshots.length || undefined },
    { key: "paths", label: "路径", icon: Route, badge: execPaths.length || undefined },
    { key: "files", label: "文件", icon: FileText, badge: files.length || undefined },
  ];

  const activeLabel = TABS.find(t => t.key === activeTab)?.label ?? "";

  return (
    <div
      className="shrink-0 border-t border-border bg-background flex flex-col overflow-hidden transition-[height] duration-200"
      style={{ height: isExpanded ? PANEL_HEIGHT_EXPANDED : PANEL_HEIGHT_COLLAPSED }}
    >
      {/* 头部：始终显示标题 + 折叠/展开 */}
      <div
        className="flex items-center shrink-0 h-[35px] border-b border-border/40 bg-surface-hover/20 px-3 cursor-pointer hover:bg-surface-hover/40 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* 折叠状态：显示当前 tab 标题 */}
        {!isExpanded && (
          <>
            <div className="flex items-center gap-1.5">
              {TABS.map(tab => {
                const TabIcon = tab.icon;
                return (
                  <span key={tab.key} className={cn(
                    "text-[11px] font-medium",
                    activeTab === tab.key ? "text-brand" : "text-muted-foreground/50"
                  )}>
                    <TabIcon className="h-3 w-3 inline mr-0.5" />{tab.label}
                  </span>
                );
              })}
            </div>
            {pendingApprovals.length > 0 && activeTab !== "approval" && (
              <span className="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber px-1 text-[9px] font-bold text-white">{pendingApprovals.length}</span>
            )}
          </>
        )}

        {/* 展开状态：折叠按钮 + Tab 栏 */}
        {isExpanded && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors mr-1"
              title="收起面板"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
              {TABS.map(tab => {
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    className={cn(
                      "relative flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                      activeTab === tab.key ? "text-brand bg-brand/8" : "text-muted-foreground hover:text-foreground hover:bg-surface-hover/30"
                    )}
                    onClick={(e) => { e.stopPropagation(); setActiveTab(tab.key); }}
                  >
                    <TabIcon className="h-3 w-3" />
                    <span>{tab.label}</span>
                    {tab.badge != null && tab.badge > 0 && (
                      <span className={cn(
                        "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white",
                        tab.key === "approval" && tab.badge > 0 ? "bg-amber" : "bg-muted-foreground/40"
                      )}>{tab.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Tab 内容 */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
          {/* Logs */}
          {activeTab === "log" && (
            <div className="font-mono text-[11px] space-y-px">
              {logEvents.length === 0 && (
                <div className="text-muted-foreground py-6 text-center text-[11px]">暂无日志</div>
              )}
              {logEvents.map((evt, i) => {
                const isNodeEvent = evt.event.startsWith("dag:node_") || evt.event.startsWith("node:");
                const isApprovalQuestion = evt.event === "approval:question";
                const isApprovalReply = evt.event === "approval:approved" || evt.event === "approval:rejected";
                const isProgressEvent = evt.event === "node:progress" || evt.event === "node:thinking";
                const isRiskyEvent = evt.event === "node:risky_tool";

                // 提取有意义的日志内容
                const d = evt.data;
                const content = d.content ? String(d.content) : "";
                const text = d.text ? String(d.text) : "";
                const error = d.error ? String(d.error) : "";
                const description = d.description ? String(d.description) : "";
                const result = d.result ? String(d.result) : "";
                const toolName = d.tool_name ? String(d.tool_name) : "";

                // 构建展示内容
                let displayText = "";
                if (isApprovalQuestion) {
                  displayText = description || String(d.title ?? "");
                } else if (isApprovalReply) {
                  displayText = result || (evt.event === "approval:approved" ? "已批准" : "已拒绝");
                } else {
                  displayText = content || text || error || description || "";
                }
                if (isRiskyEvent && !displayText && toolName) {
                  displayText = `高风险工具: ${toolName}`;
                }

                // Node ID 标签
                const nodeId = d.node_id ? String(d.node_id) : "";
                const nodeLabel = nodeId && isNodeEvent
                  ? `Node: ${nodeNameMap?.[nodeId] ?? nodeId.slice(0, 16)}`
                  : "";

                // 事件标签文字（中文，替代原始 event name）
                let eventLabel = evt.event;
                if (isApprovalQuestion) eventLabel = "Agent 提问";
                else if (evt.event === "approval:approved") eventLabel = "用户回复 ✓";
                else if (evt.event === "approval:rejected") eventLabel = "用户回复 ✗";
                else if (evt.event.includes("completed")) eventLabel = "节点完成";
                else if (evt.event.includes("failed")) eventLabel = "节点失败";
                else if (evt.event.includes("started")) eventLabel = "节点启动";

                return (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-muted-foreground hover:bg-surface-hover/40 rounded px-1.5 -mx-1.5 transition-colors">
                    <span className="shrink-0 text-muted-foreground/25 w-14 text-right tabular-nums leading-4">
                      {evt.ts ? new Date(evt.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
                    </span>
                    <span className={cn(
                      "shrink-0 truncate font-medium leading-4",
                      isProgressEvent ? "w-[90px] text-sky-400" :
                      isApprovalQuestion ? "w-[90px] text-purple-400" :
                      isApprovalReply ? "w-[90px] text-emerald-400" :
                      isRiskyEvent ? "w-[90px] text-red-400" :
                      evt.event.includes("failed") || evt.event.includes("error") ? "w-[90px] text-red-400" :
                      "w-[90px] text-foreground/60"
                    )} title={evt.event}>{eventLabel}</span>
                    {nodeLabel && (
                      <span className="shrink-0 truncate text-foreground/60 leading-4" style={{ maxWidth: 120 }} title={nodeLabel}>
                        {nodeLabel}
                      </span>
                    )}
                    {displayText && (
                      <span className={cn(
                        "break-all leading-4 line-clamp-1 flex-1 min-w-0",
                        isApprovalQuestion ? "text-purple-400" :
                        isApprovalReply ? "text-emerald-400" :
                        isProgressEvent ? "text-sky-400" :
                        error ? "text-red-400" :
                        "text-foreground/70"
                      )} title={displayText}>{displayText}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Approvals */}
          {activeTab === "approval" && (
            <div className="space-y-2">
              {approvals.length === 0 && (
                <div className="text-muted-foreground py-6 text-center text-[11px]">
                  <Bell className="mx-auto mb-1.5 h-4 w-4 opacity-40" />暂无审批记录
                </div>
              )}

              {/* 待处理 */}
              {pendingApprovals.length > 0 && (
                <>
                  <div className="text-[10px] font-medium text-amber uppercase tracking-wider mb-1.5">待处理 ({pendingApprovals.length})</div>
                  {pendingApprovals.map(a => (
                    <ApprovalCard key={a.id} approval={a} onResolve={onResolveApproval} />
                  ))}
                </>
              )}

              {/* 已解决 */}
              {approvals.filter(a => a.status !== "pending").length > 0 && (
                <>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 mt-3">
                    已解决 ({approvals.filter(a => a.status !== "pending").length})
                  </div>
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
            <div className="space-y-1.5">
              {snapshots.length === 0 && (
                <div className="text-muted-foreground py-6 text-center text-[11px]">
                  <Camera className="mx-auto mb-1.5 h-4 w-4 opacity-40" />暂无快照
                </div>
              )}
              {snapshots.map(snap => (
                <div key={snap.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-2 text-[11px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-muted-foreground shrink-0">{snap.git_commit_hash.slice(0, 7)}</span>
                    <span className={cn(
                      "rounded px-1 py-0.5 text-[9px] font-medium shrink-0",
                      snap.type === "pre_step" ? "bg-sky-500/10 text-sky-400" : "bg-emerald-500/10 text-emerald-400"
                    )}>{snap.type}</span>
                    <span className="text-muted-foreground truncate">{new Date(snap.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <Button variant="outline" size="sm" className="text-[9px] h-5 ml-2 shrink-0 px-1.5" onClick={() => onRollback(snap.id)} disabled={actionLoading === "rollback"}>
                    {actionLoading === "rollback" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5 mr-0.5" />}回滚
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Paths */}
          {activeTab === "paths" && (
            <div className="space-y-1.5">
              {execPaths.length === 0 && (
                <div className="text-muted-foreground py-6 text-center text-[11px]">
                  <Route className="mx-auto mb-1.5 h-4 w-4 opacity-40" />暂无执行路径
                </div>
              )}
              {execPaths.map(ep => (
                <div key={ep.id} className="rounded-lg border border-border bg-card p-2 text-[11px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "rounded px-1 py-0.5 text-[9px] font-medium",
                      ep.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                    )}>{ep.success ? "成功" : "失败"}</span>
                    {!ep.precipitated_to && (
                      <Button variant="outline" size="sm" className="text-[9px] h-5 px-1.5" onClick={() => onPrecipitate(ep.id)}>
                        <Download className="h-2.5 w-2.5 mr-0.5" />保存
                      </Button>
                    )}
                  </div>
                  <div className="text-muted-foreground">{ep.source} · {(ep.total_duration ?? 0).toFixed(1)}s · {ep.total_approvals} 审批</div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(r => (
                      <Star
                        key={r}
                        className={cn("h-2.5 w-2.5 cursor-pointer transition-colors",
                          ep.user_rating && r <= ep.user_rating ? "text-amber fill-amber" : "text-muted-foreground/20 hover:text-amber/50"
                        )}
                        onClick={() => onRatePath(ep.id, r)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Files */}
          {activeTab === "files" && (
            <div>
              {files.length === 0 && (
                <div className="text-muted-foreground py-6 text-center text-[11px]">
                  <Folder className="mx-auto mb-1.5 h-4 w-4 opacity-40" />
                  暂无文件<span className="block text-[9px] mt-0.5 opacity-60">执行后产生输出文件</span>
                </div>
              )}
              {files.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-1 pb-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                    <span>{files.length} 个文件</span>
                  </div>
                  {files.map((f, i) => {
                    const FI = getFileIcon(f.path);
                    const isPreviewable = /\.(html?|png|jpe?g|gif|webp|svg|bmp|md|markdown|mdx|txt|json|yml|yaml|toml|xml|log|csv|tsv|py|js|ts|tsx|jsx|css|scss|less|go|rs|java|c|cpp|h|rb|php|sql|sh|bash|env|ini|cfg|conf)$/i.test(f.path);
                    return (
                      <div key={i} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover text-[11px] transition-colors group">
                        <FI className="h-3 w-3 shrink-0 text-brand" />
                        <span className="flex-1 font-mono text-foreground/70 truncate min-w-0">{f.path}</span>
                        <span className="text-muted-foreground w-12 text-right shrink-0 tabular-nums text-[10px]">{formatFileSize(f.size)}</span>
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isPreviewable && (
                            <button
                              onClick={() => onPreviewFile(f.path)}
                              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:text-brand hover:bg-brand/10 transition-colors"
                              title="预览"
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                          )}
                          <a
                            href={`/api/tasks/${taskId}/files/${f.path}?download=true`}
                            download
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:text-brand hover:bg-brand/10 transition-colors"
                            title="下载"
                          >
                            <Download className="h-3 w-3" />
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
      )}
    </div>
  );
}
