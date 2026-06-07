"use client";

import { useState, useCallback } from "react";
import { useTeams } from "@/hooks/useTeams";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Team, TeamCreate, TeamUpdate } from "@/lib/types";
import {
  Plus, X, Loader2, Pencil, Trash2, Users,
  FileText, Workflow, Shield,
} from "lucide-react";

export default function TeamsPage() {
  const { teams, loading, error, refetch, createTeam, updateTeam, deleteTeam } = useTeams();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 创建/编辑表单
  const [form, setForm] = useState<TeamCreate>({
    name: "",
    display_name: "",
    description: "",
    icon: "",
    team_prompt: "",
    workflow_ids: [],
    node_definition_ids: [],
  });

  const resetForm = useCallback(() => {
    setForm({
      name: "",
      display_name: "",
      description: "",
      icon: "",
      team_prompt: "",
      workflow_ids: [],
      node_definition_ids: [],
    });
    setFormError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!form.name || !form.display_name) {
      setFormError("Name and display name are required");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createTeam(form);
      setShowCreate(false);
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setSaving(false);
    }
  }, [form, createTeam, resetForm]);

  const handleUpdate = useCallback(async (id: string) => {
    if (!form.display_name) {
      setFormError("Display name is required");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const updateData: TeamUpdate = {
        display_name: form.display_name,
        description: form.description,
        icon: form.icon,
        team_prompt: form.team_prompt,
      };
      await updateTeam(id, updateData);
      setEditingId(null);
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update team");
    } finally {
      setSaving(false);
    }
  }, [form, updateTeam, resetForm]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete team "${name}"? This will remove the team but not its workflows/nodes.`)) return;
    try {
      await deleteTeam(id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete team");
    }
  }, [deleteTeam]);

  const startEdit = useCallback((team: Team) => {
    setEditingId(team.id);
    setForm({
      name: team.name,
      display_name: team.display_name,
      description: team.description || "",
      icon: team.icon || "",
      team_prompt: team.team_prompt || "",
      workflow_ids: team.workflow_ids || [],
      node_definition_ids: team.node_definition_ids || [],
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">👥 Teams</h1>
          <p className="text-muted-foreground mt-1">
            AI 能力团队 — 将工作流和节点按领域分组，匹配时智能路由
          </p>
        </div>
        <Button onClick={() => { setShowCreate(true); setEditingId(null); resetForm(); }}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create Team
        </Button>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="py-3 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* 创建/编辑表单 */}
      {(showCreate || editingId) && (
        <Card className="border-brand/30 bg-brand/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId ? "Edit Team" : "Create Team"}
            </CardTitle>
            <CardDescription>
              {editingId ? "修改 Team 配置和领域知识" : "创建一个新的 AI 能力团队"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formError && (
              <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded">{formError}</p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Name (唯一标识)</Label>
                <Input
                  id="team-name"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="document-engineering"
                  disabled={!!editingId}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-display">Display Name</Label>
                <Input
                  id="team-display"
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="📄 文档工程"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="team-icon">Icon (emoji)</Label>
                <Input
                  id="team-icon"
                  value={form.icon || ""}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                  placeholder="📄"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-desc">Description</Label>
                <Input
                  id="team-desc"
                  value={form.description || ""}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="该团队擅长..."
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="team-prompt">Team Prompt (领域知识注入)</Label>
              <Textarea
                id="team-prompt"
                value={form.team_prompt || ""}
                onChange={e => setForm(f => ({ ...f, team_prompt: e.target.value }))}
                placeholder="注入到每次执行的 system prompt..."
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                此内容会在任务执行时自动注入到 Agent 的 prompt 前面
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => { setShowCreate(false); setEditingId(null); resetForm(); }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
                disabled={saving}
              >
                {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {editingId ? "Save Changes" : "Create Team"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team 列表 */}
      {teams.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">还没有创建任何 Team</p>
            <p className="text-xs mt-1 opacity-60">创建 Team 来按领域组织你的工作流和节点</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {teams.map(team => (
            <Card
              key={team.id}
              className={cn(
                "hover:border-brand/40 transition-colors",
                team.status === "archived" && "opacity-50"
              )}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">{team.icon || "👥"}</span>
                    <div>
                      <CardTitle className="text-base">{team.display_name}</CardTitle>
                      <CardDescription className="text-xs font-mono">{team.name}</CardDescription>
                    </div>
                    {team.status === "archived" && (
                      <Badge variant="outline" className="text-xs">Archived</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => startEdit(team)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-400 hover:text-red-300"
                      onClick={() => handleDelete(team.id, team.display_name)}
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
                    <Workflow className="w-3 h-3" />
                    {team.workflow_ids.length} workflows
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {team.node_definition_ids.length} nodes
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
          ))}
        </div>
      )}
    </div>
  );
}
