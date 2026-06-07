"use client";

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
import type { Team } from "@/lib/types";

interface DeleteTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team | null;
  onConfirm: () => void;
  deleting?: boolean;
}

export function DeleteTeamDialog({
  open,
  onOpenChange,
  team,
  onConfirm,
  deleting,
}: DeleteTeamDialogProps) {
  if (!team) return null;

  const workflowCount = team.workflow_ids?.length ?? 0;
  const nodeCount = team.node_definition_ids?.length ?? 0;
  const hasResources = workflowCount > 0 || nodeCount > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="text-xl">{team.icon || "👥"}</span>
            删除 Team
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                确定要删除{" "}
                <span className="font-medium text-foreground">
                  {team.display_name}
                </span>
                <span className="text-muted-foreground font-mono text-xs ml-1">
                  ({team.name})
                </span>{" "}
                吗？此操作不可撤销。
              </p>
              {hasResources && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <p className="font-medium mb-1">该 Team 仍有关联资源：</p>
                  <div className="flex items-center gap-3 text-amber-500/80">
                    {workflowCount > 0 && <span>{workflowCount} 个工作流</span>}
                    {nodeCount > 0 && <span>{nodeCount} 个节点</span>}
                  </div>
                  <p className="mt-1 text-amber-500/60">
                    删除 Team 不会删除关联的工作流和节点
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
          >
            {deleting ? "删除中..." : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
