"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import { useWorkflows } from "@/hooks/useWorkflow";
import type { Workflow } from "@/lib/types";
import { Plus, Workflow as WorkflowIcon, Loader2 } from "lucide-react";

export default function WorkflowList() {
  const { workflows, loading, error } = useWorkflows();

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
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <WorkflowIcon className="h-8 w-8" />
        </div>
        <p className="mb-1 text-base font-medium">暂无工作流</p>
        <p className="mb-4 text-sm">创建你的第一个 AI Agent 工作流</p>
        <Link href="/workflows">
          <Button>
            <Plus className="mr-1.5 h-4 w-4" />
            新建工作流
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {workflows.map((wf: Workflow) => (
        <Link key={wf.id} href={`/workflows/${wf.id}`}>
          <Card className="group transition-all hover:shadow-md hover:border-primary/30 cursor-pointer h-full">
            <CardContent className="p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="font-medium leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-1">
                  {wf.name}
                </h3>
                <StatusBadge status={wf.status} />
              </div>
              {wf.description && (
                <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{wf.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {wf.category && (
                  <span className="rounded bg-muted px-1.5 py-0.5">{wf.category}</span>
                )}
                <span>v{wf.version}</span>
                <span>{wf.dag?.nodes?.length ?? 0} 节点</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
