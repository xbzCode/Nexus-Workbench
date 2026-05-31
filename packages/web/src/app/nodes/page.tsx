"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { APIResponse, NodeDefResponse } from "@/lib/types";
import {
  Code,
  Database,
  FileText,
  GitBranch,
  Globe,
  Hammer,
  MessageSquare,
  Search,
  Shield,
  Terminal,
  TestTube,
  Wrench,
  Plus,
  Upload,
  FileCode,
  Loader2,
  X,
  Package,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

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

type AddMode = "md" | "zip";

const MD_TEMPLATE = `# 节点名称

> 简要描述此节点的能力

## 能力说明

描述此节点可以做什么，接受什么输入，产出什么输出。

## 输入

- \`param1\` (string): 参数1说明
- \`param2\` (object): 参数2说明

## 输出

- \`result\` (string): 输出说明

## 示例

\`\`\`
输入: { "param1": "value" }
输出: { "result": "processed" }
\`\`\`
`;

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeDefResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Add node modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("md");
  const [mdContent, setMdContent] = useState(MD_TEMPLATE);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载节点列表
  const fetchNodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<APIResponse<NodeDefResponse[]>>("/nodes");
      setNodes(res.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

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

  const handleZipSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".zip")) {
        setSubmitError("请选择 .zip 文件");
        return;
      }
      setZipFile(file);
      setSubmitError(null);
    }
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      if (addMode === "md") {
        await api.post<APIResponse<unknown>>("/nodes", {
          type: "markdown",
          content: mdContent,
        });
      } else {
        if (!zipFile) {
          setSubmitError("请选择文件");
          setSubmitting(false);
          return;
        }
        const formData = new FormData();
        formData.append("file", zipFile);
        await api.post<APIResponse<unknown>>("/nodes", formData);
      }
      setSubmitSuccess(true);
      // 刷新列表
      fetchNodes();
      setTimeout(() => {
        setShowAdd(false);
        setSubmitSuccess(false);
      }, 800);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
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
            查看和管理可用的 Agent 节点 · {nodes.length} 个节点
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
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            添加节点
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface">
            <Package className="h-8 w-8" />
          </div>
          <p className="mb-1 text-base font-medium">暂无节点</p>
          <p className="mb-4 text-sm">添加第一个 Agent 节点</p>
          <Button onClick={() => setShowAdd(true)}>添加节点</Button>
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
                      return (
                        <Card
                          key={node.id}
                          className="group cursor-pointer transition-all hover:border-brand/30 hover:shadow-md hover:shadow-brand-muted active:scale-[0.99]"
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
                              <h3 className="text-sm font-medium text-foreground group-hover:text-brand transition-colors truncate">
                                {node.display_name || node.name}
                              </h3>
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
                                  {node.status}
                                </span>
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

      {/* ── Add Node Modal ── */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div
            className="animate-scale-in flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">添加节点</h2>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                onClick={() => setShowAdd(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mode switcher */}
            <div className="flex gap-1 border-b border-border px-6 py-2">
              <button
                onClick={() => { setAddMode("md"); setSubmitError(null); setSubmitSuccess(false); }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
                  addMode === "md"
                    ? "bg-brand-muted text-brand"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                )}
              >
                <FileCode className="h-3.5 w-3.5" />
                Markdown 文本
              </button>
              <button
                onClick={() => { setAddMode("zip"); setSubmitError(null); setSubmitSuccess(false); }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
                  addMode === "zip"
                    ? "bg-brand-muted text-brand"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                上传 ZIP
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {addMode === "md" ? (
                <div className="space-y-2">
                  <Label>节点定义 (Markdown)</Label>
                  <p className="text-[12px] text-muted-foreground">
                    用 Markdown 描述节点的能力、输入、输出。系统会自动解析并注册。
                  </p>
                  <textarea
                    value={mdContent}
                    onChange={(e) => setMdContent(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none resize-none"
                    rows={16}
                    placeholder="用 Markdown 描述节点..."
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <Label>上传节点包 (ZIP)</Label>
                  <p className="text-[12px] text-muted-foreground">
                    上传包含节点定义的 ZIP 包，后端会自动解析注册。
                  </p>
                  {/* Drop zone */}
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 transition-colors cursor-pointer",
                      zipFile
                        ? "border-brand bg-brand-muted"
                        : "border-border hover:border-brand/50 hover:bg-surface-hover"
                    )}
                    onClick={() => fileInputRef.current?.click()}
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
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                        >
                          移除
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">点击选择 .zip 文件</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">或将文件拖拽到此处</p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={handleZipSelect}
                    />
                  </div>
                </div>
              )}

              {/* Feedback */}
              {submitError && (
                <p className="mt-3 text-sm text-destructive">{submitError}</p>
              )}
              {submitSuccess && (
                <p className="mt-3 text-sm text-emerald-400">✓ 节点已提交，正在注册…</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <Button variant="outline" onClick={() => setShowAdd(false)}>取消</Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || (addMode === "md" && !mdContent.trim()) || (addMode === "zip" && !zipFile)}
              >
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {addMode === "md" ? "注册节点" : "上传注册"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
