"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useTeams } from "@/hooks/useTeams";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { IconPicker } from "@/components/team/IconPicker";
import { ResourcePicker } from "@/components/team/ResourcePicker";
import { DeleteTeamDialog } from "@/components/team/DeleteTeamDialog";
import TeamTreeView from "@/components/team/TeamTreeView";
import type { Team, TeamCreate, TeamUpdate, APIResponse, Workflow, NodeDefResponse } from "@/lib/types";
import {
  Plus, Loader2, Pencil, Trash2, Users,
  FileText, Workflow as WfIcon, Shield, Network, List,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type ViewMode = "tree" | "list";

const PROMPT_PLACEHOLDER = `你属于【文档工程】团队。请遵循以下标准：
- 所有文档使用 Markdown 格式，结构清晰
- 代码块必须标注语言类型
- 专业术语首次出现需添加英文注释
- 输出需包含清晰的目录结构
- 注重可读性和信息密度`;

const DESC_PLACEHOLDER = "该团队擅长的领域描述，如：需求文档、技术方案、API 文档等文档类任务";

// ── Sortable Team Card ──

function SortableTeamCard({
  team,
  onEdit,
  onDelete,
}: {
  team: Team;
  onEdit: (team: Team) => void;
  onDelete: (team: Team) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: team.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "hover:border-brand/40 transition-colors",
        team.status === "archived" && "opacity-50",
        isDragging && "shadow-lg border-brand/40",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            {/* Drag handle */}
            <button
              type="button"
              className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-4 h-4" />
            </button>
            <span className="text-2xl">{team.icon || "👥"}</span>
            <div>
              <CardTitle className="text-base">{team.display_name}</CardTitle>
              <CardDescription className="text-xs font-mono">{team.name}</CardDescription>
            </div>
            {team.status === "archived" && (
              <Badge variant="outline" className="text-xs">已归档</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(team)}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-400 hover:text-red-300"
              onClick={() => onDelete(team)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {team.description && (
          <p className="text-sm text-muted-foreground">{team.description}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <WfIcon className="w-3 h-3" />
            {team.workflow_ids.length} 工作流
          </span>
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {team.node_definition_ids.length} 节点
          </span>
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {team.default_adapter_type}
          </span>
        </div>
        {team.team_prompt && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mt-2 max-h-20 overflow-y-auto">
            <code className="text-[11px] whitespace-pre-wrap">{team.team_prompt}</code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──

export default function TeamsPage() {
  const { teams, loading, error, createTeam, updateTeam, deleteTeam } = useTeams();

  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Resource data for picker
  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>([]);
  const [allNodes, setAllNodes] = useState<NodeDefResponse[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  // Sortable team order
  const [sortedTeamIds, setSortedTeamIds] = useState<string[]>([]);

  const [form, setForm] = useState<TeamCreate>({
    name: "",
    display_name: "",
    description: "",
    icon: "👥",
    team_prompt: "",
    workflow_ids: [],
    node_definition_ids: [],
  });

  // Sync sorted IDs with teams
  useEffect(() => {
    setSortedTeamIds((prev) => {
      const currentIds = new Set(teams.map((t) => t.id));
      const kept = prev.filter((id) => currentIds.has(id));
      const added = teams.map((t) => t.id).filter((id) => !prev.includes(id));
      return [...kept, ...added];
    });
  }, [teams]);

  const orderedTeams = useMemo(() => {
    const orderMap = new Map(sortedTeamIds.map((id, i) => [id, i]));
    return [...teams].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  }, [teams, sortedTeamIds]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSortedTeamIds((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // Load resources when dialog opens
  const loadResources = useCallback(async () => {
    setResourcesLoading(true);
    try {
      const [wfRes, nodeRes] = await Promise.all([
        api.get<APIResponse<Workflow[]>>("/workflows"),
        api.get<APIResponse<NodeDefResponse[]>>("/nodes"),
      ]);
      setAllWorkflows(wfRes.data || []);
      setAllNodes(nodeRes.data || []);
    } catch {
      // Silently fail — picker shows empty state
    } finally {
      setResourcesLoading(false);
    }
  }, []);

  const resetForm = useCallback(() => {
    setForm({
      name: "",
      display_name: "",
      description: "",
      icon: "👥",
      team_prompt: "",
      workflow_ids: [],
      node_definition_ids: [],
    });
    setFormError(null);
  }, []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    resetForm();
    loadResources();
    setDialogOpen(true);
  }, [resetForm, loadResources]);

  const openEdit = useCallback(
    (team: Team) => {
      setEditingId(team.id);
      setForm({
        name: team.name,
        display_name: team.display_name,
        description: team.description || "",
        icon: team.icon || "👥",
        team_prompt: team.team_prompt || "",
        workflow_ids: team.workflow_ids || [],
        node_definition_ids: team.node_definition_ids || [],
      });
      loadResources();
      setDialogOpen(true);
    },
    [loadResources],
  );

  const handleSave = useCallback(async () => {
    if (!form.name || !form.display_name) {
      setFormError("名称和展示名称为必填项");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        const updateData: TeamUpdate = {
          display_name: form.display_name,
          description: form.description || null,
          icon: form.icon,
          team_prompt: form.team_prompt || null,
          workflow_ids: form.workflow_ids,
          node_definition_ids: form.node_definition_ids,
        };
        await updateTeam(editingId, updateData);
      } else {
        await createTeam(form);
      }
      setDialogOpen(false);
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSaving(false);
    }
  }, [form, editingId, createTeam, updateTeam, resetForm]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTeam(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      // Show error inline — avoid alert()
      console.error("Delete failed:", err);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleteTeam]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI 能力团队 — 将工作流和节点按领域分组，匹配时智能路由
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5 mr-2">
            <button
              onClick={() => setViewMode("tree")}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                viewMode === "tree" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Network className="w-3.5 h-3.5" />
              树形
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="w-3.5 h-3.5" />
              列表
            </button>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1.5" />
            创建 Team
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="py-3 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* ── Content ── */}
      {teams.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm font-medium">还没有创建任何 Team</p>
            <p className="text-xs mt-1 opacity-60">创建 Team 来按领域组织你的工作流和节点</p>
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5 mr-1" /> 创建第一个 Team
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === "tree" ? (
        <TeamTreeView
          teams={orderedTeams}
          onEditTeam={openEdit}
          onDeleteTeam={(id, name) => {
            const team = teams.find((t) => t.id === id);
            if (team) setDeleteTarget(team);
          }}
        />
      ) : (
        /* ── List View with drag-and-drop ── */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedTeamIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-4">
              {orderedTeams.map((team) => (
                <SortableTeamCard
                  key={team.id}
                  team={team}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      <DeleteTeamDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        team={deleteTarget}
        onConfirm={handleDeleteConfirm}
        deleting={deleting}
      />

      {/* ── Create / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑 Team" : "创建 Team"}</DialogTitle>
            <DialogDescription>
              {editingId ? "修改 Team 的基本信息和关联资源" : "创建新的 AI 能力团队"}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{formError}</p>
          )}

          <div className="space-y-5">
            {/* Name & Display Name */}
            <div className="grid grid-cols-[auto_1fr] gap-4">
              <div className="space-y-1.5 pt-6">
                <Label className="text-xs">图标</Label>
                <IconPicker
                  value={form.icon || "👥"}
                  onChange={(emoji) => setForm((f) => ({ ...f, icon: emoji }))}
                />
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="team-name">Name <span className="text-muted-foreground">(唯一标识)</span></Label>
                  <Input
                    id="team-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="document-engineering"
                    disabled={!!editingId}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="team-display">展示名称</Label>
                  <Input
                    id="team-display"
                    value={form.display_name}
                    onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                    placeholder="文档工程"
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="team-desc">描述</Label>
              <Input
                id="team-desc"
                value={form.description || ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={DESC_PLACEHOLDER}
              />
            </div>

            {/* Team Prompt */}
            <div className="space-y-1.5">
              <Label htmlFor="team-prompt">
                Team Prompt <span className="text-muted-foreground font-normal">(领域知识注入)</span>
              </Label>
              <Textarea
                id="team-prompt"
                value={form.team_prompt || ""}
                onChange={(e) => setForm((f) => ({ ...f, team_prompt: e.target.value }))}
                placeholder={PROMPT_PLACEHOLDER}
                rows={4}
                className="text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                执行任务时自动注入到 Agent prompt 前方，定义该 Team 的质量标准和行为规范
              </p>
            </div>

            <Separator />

            {/* Workflow Selection */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <WfIcon className="w-3.5 h-3.5" />
                关联工作流
              </Label>
              <ResourcePicker
                type="workflow"
                items={allWorkflows.map((w) => ({
                  id: w.id,
                  name: w.name,
                  display_name: w.name,
                  description: w.description,
                  category: w.category,
                  status: w.status,
                }))}
                selectedIds={form.workflow_ids || []}
                onChange={(ids) => setForm((f) => ({ ...f, workflow_ids: ids }))}
                loading={resourcesLoading}
              />
            </div>

            {/* Node Selection */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                关联节点
              </Label>
              <ResourcePicker
                type="node"
                items={allNodes.map((n) => ({
                  id: n.id,
                  name: n.name,
                  display_name: n.display_name,
                  description: n.description,
                  category: n.category,
                  status: n.status,
                }))}
                selectedIds={form.node_definition_ids || []}
                onChange={(ids) => setForm((f) => ({ ...f, node_definition_ids: ids }))}
                loading={resourcesLoading}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {editingId ? "保存修改" : "创建 Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
