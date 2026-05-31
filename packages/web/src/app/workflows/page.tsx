"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { useWorkflows, useWorkflowActions } from "@/hooks/useWorkflow";
import type { WorkflowCreate } from "@/lib/types";
import { Workflow as WorkflowIcon, Loader2, Plus } from "lucide-react";

export default function WorkflowsPage() {
  const router = useRouter();
  const { workflows, loading, error, refetch } = useWorkflows();
  const { create } = useWorkflowActions();

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const body: WorkflowCreate = {
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
      };
      const wf = await create(body);
      setShowCreate(false);
      setName("");
      setDescription("");
      setCategory("");
      router.push(`/workflows/${wf.id}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
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
          <h1 className="text-lg font-semibold text-foreground">工作流</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">管理和监控你的 AI Agent 工作流</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          新建工作流
        </Button>
      </div>

      {/* Empty state */}
      {workflows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface">
            <WorkflowIcon className="h-8 w-8" />
          </div>
          <p className="mb-1 text-base font-medium">暂无工作流</p>
          <p className="mb-4 text-sm">创建你的第一个 AI Agent 工作流</p>
          <Button onClick={() => setShowCreate(true)}>新建工作流</Button>
        </div>
      )}

      {/* Workflow grid */}
      {workflows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf) => (
            <Link key={wf.id} href={`/workflows/${wf.id}`}>
              <Card className="group h-full cursor-pointer transition-all hover:border-brand/30 hover:shadow-md hover:shadow-brand-muted active:scale-[0.99]">
                <CardContent className="p-5">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 font-medium leading-snug text-foreground transition-colors group-hover:text-brand">
                      {wf.name}
                    </h3>
                    <StatusBadge status={wf.status} />
                  </div>
                  {wf.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                      {wf.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {wf.category && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5">
                        {wf.category}
                      </span>
                    )}
                    <span>v{wf.version}</span>
                    <span>{wf.dag?.nodes?.length ?? 0} 节点</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* ── Create Workflow Modal ── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div
            className="animate-scale-in w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-5 text-base font-semibold text-foreground">新建工作流</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wf-name">名称 *</Label>
                <Input
                  id="wf-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：代码审查流水线"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wf-desc">描述</Label>
                <Textarea
                  id="wf-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="工作流用途说明"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wf-cat">分类</Label>
                <Input
                  id="wf-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="例：devops"
                />
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
                <Button type="submit" disabled={submitting || !name.trim()}>
                  {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  创建
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
