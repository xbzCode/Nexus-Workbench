"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { APIResponse, NodeDefResponse } from "@/lib/types";
import {
  Code,
  Database,
  FileText,
  GitBranch,
  Globe,
  Loader2,
  MessageSquare,
  Package,
  Search,
  TestTube,
  Upload,
  X,
  FileCode,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  PowerOff,
  Power,
  ArrowRight,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { toast } from "sonner";

// 分类图标映射
const CATEGORY_ICONS: Record<string, typeof Code> = {
  dev: Code,
  development: Code,
  test: TestTube,
  testing: TestTube,
  ops: Globe,
  devops: Globe,
  analysis: Database,
  analytics: Database,
  communication: MessageSquare,
  vcs: GitBranch,
  "version-control": GitBranch,
};

const CATEGORY_COLORS: Record<string, { text: string; bg: string }> = {
  dev: { text: "text-brand", bg: "bg-brand-muted" },
  development: { text: "text-brand", bg: "bg-brand-muted" },
  test: { text: "text-emerald-400", bg: "bg-emerald-500/10" },
  testing: { text: "text-emerald-400", bg: "bg-emerald-500/10" },
  ops: { text: "text-amber", bg: "bg-amber-muted" },
  devops: { text: "text-amber", bg: "bg-amber-muted" },
  analysis: { text: "text-sky-400", bg: "bg-sky-500/10" },
  analytics: { text: "text-sky-400", bg: "bg-sky-500/10" },
  communication: { text: "text-pink-400", bg: "bg-pink-500/10" },
  vcs: { text: "text-orange-400", bg: "bg-orange-500/10" },
  "version-control": { text: "text-orange-400", bg: "bg-orange-500/10" },
};

const DEFAULT_CATEGORY = { text: "text-muted-foreground", bg: "bg-muted" };

type StatusTab = "published" | "deprecated" | "all";

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeDefResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [statusTab, setStatusTab] = useState<StatusTab>("published");

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 拖拽状态
  const [dragging, setDragging] = useState(false);

  // 节点详情抽屉
  const [detailNode, setDetailNode] = useState<NodeDefResponse | null>(null);

  // 操作菜单
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 删除确认弹窗
  const [deleteConfirm, setDeleteConfirm] = useState<{
    nodeId: string;
    nodeName: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 加载节点列表
  const fetchNodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusTab !== "all") params.status = statusTab;
      const res = await api.get<APIResponse<NodeDefResponse[]>>("/nodes", params);
      setNodes(res.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [statusTab]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpenId]);

  // 搜索过滤
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.display_name.toLowerCase().includes(q) ||
        (n.description ?? "").toLowerCase().includes(q) ||
        (n.category ?? "").toLowerCase().includes(q)
    );
  }, [nodes, search]);

  // 按分类分组
  const grouped = useMemo(() => {
    const map = new Map<string, NodeDefResponse[]>();
    for (const n of filtered) {
      const cat = n.category || "其他";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(n);
    }
    return map;
  }, [filtered]);

  // 展开/收起分类
  const toggleCat = useCallback((cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // 初始化时展开所有分类
  useEffect(() => {
    setExpandedCats(new Set(grouped.keys()));
  }, [grouped.size]);

  // ── Status tab counts ──
  const [allNodes, setAllNodes] = useState<NodeDefResponse[]>([]);
  useEffect(() => {
    api.get<APIResponse<NodeDefResponse[]>>("/nodes").then((res) => {
      setAllNodes(res.data ?? []);
    }).catch(() => {});
  }, [nodes]); // 列表变化时重新获取计数

  const tabCounts = useMemo(() => {
    const published = allNodes.filter((n) => n.status === "published").length;
    const deprecated = allNodes.filter((n) => n.status === "deprecated").length;
    return { published, deprecated, all: allNodes.length };
  }, [allNodes]);

  // ── Upload handlers ──

  const resetUploadState = useCallback(() => {
    setZipFile(null);
    setSubmitError(null);
    setSubmitSuccess(false);
    setSubmitting(false);
    setDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".zip")) {
      setSubmitError("请选择 .zip 文件");
      return;
    }
    setZipFile(file);
    setSubmitError(null);
    setSubmitSuccess(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleSubmit = async () => {
    if (!zipFile) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const formData = new FormData();
      formData.append("file", zipFile);
      await api.upload<APIResponse<NodeDefResponse>>("/nodes/upload", formData, 60_000);
      setSubmitSuccess(true);
      toast.success("节点导入成功");
      fetchNodes();
      setTimeout(() => {
        setShowUpload(false);
        resetUploadState();
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "导入失败";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = useCallback(() => {
    setShowUpload(false);
    resetUploadState();
  }, [resetUploadState]);

  // ── Soft delete / Restore ──

  const handleDeprecate = async (nodeId: string) => {
    setActionLoading(nodeId);
    setMenuOpenId(null);
    try {
      await api.post<APIResponse<NodeDefResponse>>(`/nodes/${nodeId}/deprecate`);
      toast.success("节点已停用");
      fetchNodes();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "操作失败";
      setDeleteError(msg);
      setDeleteConfirm({ nodeId, nodeName: "" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestore = async (nodeId: string) => {
    setActionLoading(nodeId);
    setMenuOpenId(null);
    try {
      await api.post<APIResponse<NodeDefResponse>>(`/nodes/${nodeId}/restore`);
      toast.success("节点已恢复");
      fetchNodes();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "操作失败";
      setDeleteError(msg);
      setDeleteConfirm({ nodeId, nodeName: "" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = (nodeId: string, nodeName: string) => {
    setMenuOpenId(null);
    setDeleteError(null);
    setDeleteConfirm({ nodeId, nodeName });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.delete<APIResponse<null>>(`/nodes/${deleteConfirm.nodeId}`);
      setDeleteConfirm(null);
      toast.success("节点已删除");
      fetchNodes();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "删除失败";
      setDeleteError(msg);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-6 mt-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">节点注册中心</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            查看和管理可用的 Agent 节点
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索节点…"
              className="h-8 w-52 rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
            />
          </div>
          <Button size="sm" onClick={() => setShowUpload(true)}>
            <Upload className="mr-1.5 h-4 w-4" />
            导入节点
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="mb-5 flex items-center gap-1 border-b border-border">
        {([
          { key: "published" as StatusTab, label: "已发布", icon: CheckCircle2 },
          { key: "deprecated" as StatusTab, label: "已停用", icon: PowerOff },
          { key: "all" as StatusTab, label: "全部", icon: Package },
        ]).map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            onClick={() => setStatusTab(key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              statusTab === key
                ? "border-brand text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <TabIcon className="h-3.5 w-3.5" />
            {label}
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              statusTab === key
                ? "bg-brand-muted text-brand"
                : "bg-muted text-muted-foreground"
            )}>
              {tabCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface">
            <Package className="h-8 w-8" />
          </div>
          <p className="mb-1 text-base font-medium">
            {statusTab === "deprecated" ? "暂无停用节点" : "暂无节点"}
          </p>
          {statusTab === "published" && (
            <>
              <p className="mb-4 text-sm">上传 ZIP 包导入第一个 Agent 节点</p>
              <Button onClick={() => setShowUpload(true)}>
                <Upload className="mr-1.5 h-4 w-4" />
                导入节点
              </Button>
            </>
          )}
        </div>
      )}

      {/* Grouped nodes */}
      {nodes.length > 0 && (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([cat, items]) => {
            const expanded = expandedCats.has(cat);
            const catStyle = CATEGORY_COLORS[cat.toLowerCase()] ?? DEFAULT_CATEGORY;
            const CatIcon = CATEGORY_ICONS[cat.toLowerCase()] ?? Package;

            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCat(cat)}
                  className="flex w-full items-center gap-2 py-2 group"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform" />
                  )}
                  <CatIcon className={cn("h-4 w-4", catStyle.text)} />
                  <span className={cn("text-sm font-semibold", catStyle.text)}>
                    {cat}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {items.length} 节点
                  </span>
                </button>

                {expanded && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pl-6">
                    {items.map((node) => {
                      const nodeStyle = CATEGORY_COLORS[node.category?.toLowerCase() ?? ""] ?? DEFAULT_CATEGORY;
                      const isDeprecated = node.status === "deprecated";
                      const isActionLoading = actionLoading === node.id;

                      return (
                        <Card
                          key={node.id}
                          className={cn(
                            "group relative transition-[box-shadow,border-color,opacity] hover:shadow-md",
                            menuOpenId === node.id && "z-30",
                            isDeprecated
                              ? "opacity-60 hover:opacity-80 border-border hover:border-border"
                              : "cursor-pointer hover:border-brand/30 hover:shadow-brand-muted"
                          )}
                          onClick={() => !isDeprecated && setDetailNode(node)}
                        >
                          <CardContent className="flex items-start gap-3 p-4">
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                nodeStyle.bg,
                                nodeStyle.text
                              )}
                            >
                              <Package className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-1">
                                <h3 className={cn(
                                  "text-sm font-medium truncate",
                                  isDeprecated
                                    ? "text-muted-foreground"
                                    : "text-foreground group-hover:text-brand transition-colors"
                                )}>
                                  {node.display_name || node.name}
                                </h3>
                                {/* Action menu */}
                                <div
                                  className="relative"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-surface-hover transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenuOpenId(menuOpenId === node.id ? null : node.id);
                                    }}
                                    disabled={isActionLoading}
                                  >
                                    {isActionLoading ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <MoreHorizontal className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  {menuOpenId === node.id && (
                                    <div
                                      className="absolute right-0 top-7 z-50 min-w-[120px] rounded-lg border border-border bg-card py-1 shadow-lg"
                                    >
                                      {isDeprecated ? (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleRestore(node.id); }}
                                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover transition-colors"
                                        >
                                          <Power className="h-3.5 w-3.5 text-emerald-500" />
                                          恢复节点
                                        </button>
                                      ) : (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDeprecate(node.id); }}
                                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover transition-colors"
                                        >
                                          <PowerOff className="h-3.5 w-3.5 text-amber" />
                                          停用节点
                                        </button>
                                      )}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMenuOpenId(null);
                                          setDetailNode(node);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover transition-colors"
                                      >
                                        <ArrowRight className="h-3.5 w-3.5" />
                                        查看详情
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(node.id, node.display_name || node.name); }}
                                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5 transition-colors"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        永久删除
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                                {node.description || "无描述"}
                              </p>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                  {node.name}
                                </span>
                                <span className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  node.status === "published"
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : node.status === "deprecated"
                                    ? "bg-red-500/10 text-red-400"
                                    : "bg-muted text-muted-foreground"
                                )}>
                                  {node.status === "published" ? "已发布" : node.status === "deprecated" ? "已停用" : node.status}
                                </span>
                                {node.version && (
                                  <span className="text-[10px] text-muted-foreground/60">
                                    v{node.version}
                                  </span>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Upload Modal ── */}
      {showUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div
            className="animate-scale-in flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">导入节点</h2>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="text-[13px] text-muted-foreground mb-4">
                上传包含 <code className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-mono text-foreground">SKILL.md</code> 的 ZIP 包，系统会自动解析并注册节点。
              </p>

              {/* Drop zone */}
              <div
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 transition-colors cursor-pointer",
                  dragging
                    ? "border-brand bg-brand-muted"
                    : zipFile
                    ? "border-brand/50 bg-brand-muted/50"
                    : "border-border hover:border-brand/50 hover:bg-surface-hover"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                {zipFile ? (
                  <>
                    <FileCode className="mb-2 h-8 w-8 text-brand" />
                    <p className="text-sm font-medium text-foreground">{zipFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(zipFile.size / 1024).toFixed(1)} KB
                    </p>
                    <button
                      className="mt-2 text-xs text-destructive hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setZipFile(null);
                        setSubmitError(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      移除
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className={cn("mb-2 h-8 w-8", dragging ? "text-brand" : "text-muted-foreground")} />
                    <p className="text-sm text-muted-foreground">
                      {dragging ? "松开以上传" : "点击选择或拖拽 .zip 文件到此处"}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      ZIP 包需包含 SKILL.md 文件
                    </p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleInputChange}
                />
              </div>

              {/* Feedback */}
              {submitError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{submitError}</p>
                </div>
              )}
              {submitSuccess && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <p className="text-sm text-emerald-500">节点导入成功！</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <Button variant="outline" onClick={handleClose}>取消</Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !zipFile}
              >
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                导入
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Drawer ── */}
      {detailNode && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-foreground/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setDetailNode(null); }}
        >
          <div
            className="animate-slide-in-right flex w-full max-w-lg flex-col border-l border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg",
                  (CATEGORY_COLORS[detailNode.category?.toLowerCase() ?? ""] ?? DEFAULT_CATEGORY).bg,
                  (CATEGORY_COLORS[detailNode.category?.toLowerCase() ?? ""] ?? DEFAULT_CATEGORY).text,
                )}>
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {detailNode.display_name || detailNode.name}
                  </h2>
                  <p className="text-xs text-muted-foreground font-mono">{detailNode.name}</p>
                </div>
              </div>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                onClick={() => setDetailNode(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Status & Meta */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className={cn(
                  "rounded px-2 py-1 text-xs font-medium",
                  detailNode.status === "published"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : detailNode.status === "deprecated"
                    ? "bg-red-500/10 text-red-400"
                    : "bg-muted text-muted-foreground"
                )}>
                  {detailNode.status === "published" ? "已发布" : detailNode.status === "deprecated" ? "已停用" : detailNode.status}
                </span>
                <span className="text-xs text-muted-foreground">v{detailNode.version}</span>
                {detailNode.category && (
                  <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {detailNode.category}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {detailNode.adapter_type}
                </span>
              </div>

              {/* Description */}
              {detailNode.description && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">描述</h4>
                  <p className="text-sm text-foreground leading-relaxed">{detailNode.description}</p>
                </div>
              )}

              {/* Resources */}
              {detailNode.resources && Object.keys(detailNode.resources).length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">资源</h4>
                  <div className="space-y-1">
                    {Object.entries(detailNode.resources).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Source dir */}
              {detailNode.source_dir && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">源码目录</h4>
                  <code className="text-xs bg-muted rounded px-2 py-1 font-mono text-foreground">
                    extensions/nodes/{detailNode.source_dir}
                  </code>
                </div>
              )}

              {/* SKILL.md preview */}
              {detailNode.skill_md && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">SKILL.md</h4>
                  <div className="rounded-lg border border-border bg-background p-4 prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {detailNode.skill_md}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Time info */}
              <div className="border-t border-border pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">
                  创建于 {new Date(detailNode.created_at).toLocaleString("zh-CN")}
                </p>
                <p className="text-xs text-muted-foreground">
                  更新于 {new Date(detailNode.updated_at).toLocaleString("zh-CN")}
                </p>
              </div>
            </div>

            {/* Drawer footer */}
            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/5 border-destructive/30"
                onClick={() => {
                  handleDelete(detailNode!.id, detailNode!.display_name || detailNode!.name);
                  setDetailNode(null);
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                永久删除
              </Button>
              <div className="flex gap-2">
                {detailNode.status === "deprecated" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleRestore(detailNode!.id);
                      setDetailNode(null);
                    }}
                  >
                    <Power className="mr-1.5 h-4 w-4 text-emerald-500" />
                    恢复节点
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleDeprecate(detailNode!.id);
                      setDetailNode(null);
                    }}
                  >
                    <PowerOff className="mr-1.5 h-4 w-4 text-amber" />
                    停用节点
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDetailNode(null)}>
                  关闭
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialog ── */}
      <ConfirmDialog
        open={deleteConfirm !== null}
        title="永久删除节点"
        message={
          deleteError
            ? deleteError
            : `确定永久删除节点「${deleteConfirm?.nodeName}」？此操作不可恢复。`
        }
        variant={deleteError ? "warning" : "danger"}
        confirmLabel={deleteError ? "我知道了" : "永久删除"}
        cancelLabel={deleteError ? undefined : "取消"}
        onConfirm={deleteError ? () => setDeleteConfirm(null) : handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
