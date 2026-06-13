"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { useWorkflow, useWorkflowActions } from "@/hooks/useWorkflow";
import DagEditor from "@/components/workflow/DagEditor";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DAGDefinition, WorkflowUpdate } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trash2,
  Loader2,
  ArrowLeft,
  Pencil,
  Save,
  X,
  CheckCircle2,
  Rocket,
  RotateCcw,
} from "lucide-react";

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDag, setEditDag] = useState<DAGDefinition | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { workflow, loading, error, refetch } = useWorkflow(id);
  const { update, remove } = useWorkflowActions();

  const startEditing = useCallback(() => {
    if (!workflow) return;
    setEditName(workflow.name);
    setEditDesc(workflow.description ?? "");
    setEditDag((workflow.dag ?? { nodes: [], edges: [] }) as DAGDefinition);
    setEditing(true);
    setSaveSuccess(false);
  }, [workflow]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditDag(null);
    setSaveSuccess(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      const body: WorkflowUpdate = {
        name: editName || undefined,
        description: editDesc || undefined,
        dag: editDag ?? undefined,
      };
      await update(id, body);
      setEditing(false);
      setSaveSuccess(true);
      refetch();
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      // error handling
    } finally {
      setSaving(false);
    }
  }, [workflow, id, editName, editDesc, editDag, update]);

  const handleDelete = async () => {
    await remove(id);
    router.push("/workflows");
  };

  const handleDagChange = useCallback((newDag: DAGDefinition) => {
    setEditDag(newDag);
  }, []);

  // 简化状态切换：发布 / 取消发布
  const handleTogglePublish = useCallback(async () => {
    if (!workflow) return;
    setTransitioning(true);
    try {
      const nextStatus = workflow.status === "published" ? "draft" : "published";
      await update(id, { status: nextStatus });
      refetch();
    } catch {
      // error handling
    } finally {
      setTransitioning(false);
    }
  }, [workflow, id, update]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载中…
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="m-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {error ?? "工作流不存在"}
      </div>
    );
  }

  const dag = editing
    ? editDag
    : ((workflow.dag ?? null) as DAGDefinition | null);

  const isPublished = workflow.status === "published";

  return (
    <div className="flex h-full flex-col">
      {/* 编辑模式提示条 */}
      {editing && (
        <div className="shrink-0 bg-brand-muted border-b border-brand/20 px-6 py-1.5 flex items-center gap-2 text-xs text-brand">
          <Pencil className="h-3 w-3" />
          编辑模式 — 修改后点击保存生效
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="mb-1 flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 h-8 w-8 shrink-0"
                onClick={() => router.push("/workflows")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              {editing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 max-w-xs text-lg font-semibold"
                  autoFocus
                />
              ) : (
                <h2 className="text-xl font-semibold tracking-tight truncate">
                  {workflow.name}
                </h2>
              )}

              <StatusBadge status={workflow.status} />

              {saveSuccess && (
                <span className="flex items-center gap-1 text-xs text-emerald-500 animate-scale-in">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 已保存
                </span>
              )}
            </div>

            {editing ? (
              <div className="ml-9 mt-1">
                <Textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="描述（可选）"
                  rows={1}
                  className="max-w-md text-sm resize-none"
                />
              </div>
            ) : (
              workflow.description && (
                <p className="ml-9 text-sm text-muted-foreground">
                  {workflow.description}
                </p>
              )
            )}

            <div className="ml-9 mt-2 flex gap-4 text-xs text-muted-foreground">
              <span>v{workflow.version}</span>
              {workflow.category && (
                <span className="rounded-md bg-muted px-1.5 py-0.5">
                  {workflow.category}
                </span>
              )}
              <span>{dag?.nodes?.length ?? 0} 节点</span>
              <span>{dag?.edges?.length ?? 0} 连线</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelEditing}
                  disabled={saving}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  取消
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  保存
                </Button>
              </>
            ) : (
              <>
                {/* 发布/取消发布 Toggle */}
                <Button
                  variant={isPublished ? "outline" : "default"}
                  size="sm"
                  onClick={handleTogglePublish}
                  disabled={transitioning}
                >
                  {transitioning ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : isPublished ? (
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isPublished ? "取消发布" : "发布"}
                </Button>
                <Button size="sm" onClick={startEditing}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 删除确认弹框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除工作流</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除{" "}
              <span className="font-medium text-foreground">{workflow.name}</span>{" "}
              吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DAG visualization */}
      <div className="flex-1 p-6">
        <Card className="h-full overflow-hidden">
          <CardContent className="h-full p-0">
            <DagEditor
              dag={dag}
              editable={editing}
              onChange={editing ? handleDagChange : undefined}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
