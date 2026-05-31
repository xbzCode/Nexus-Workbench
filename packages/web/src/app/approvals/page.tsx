"use client";

import { useRouter } from "next/navigation";
import ApprovalCard from "@/components/approval/ApprovalCard";
import { useApprovals } from "@/hooks/useApproval";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Clock, CheckCircle2, Loader2, ExternalLink } from "lucide-react";

export default function ApprovalsPage() {
  const { pending, resolved, loading, error, resolve } = useApprovals();
  const router = useRouter();

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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">待办审批</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          审批或拒绝任务执行中的关键步骤
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Pending */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber" />
              <CardTitle className="text-base">待处理 ({pending.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                暂无待处理审批
              </p>
            ) : (
              <div className="space-y-3">
                {pending.map((a) => (
                  <div key={a.id} className="relative">
                    <ApprovalCard
                      approval={a}
                      onResolve={resolve}
                    />
                    {/* 跳转到任务详情 */}
                    <button
                      className="absolute right-4 top-4 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-brand hover:bg-brand/10 transition-colors"
                      onClick={() => router.push(`/tasks/${a.task_id}`)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      查看任务
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resolved */}
        {resolved.length > 0 && (
          <>
            <Separator />
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <CardTitle className="text-base">
                    已处理 ({resolved.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {resolved.map((a) => (
                    <div key={a.id} className="relative">
                      <ApprovalCard approval={a} compact />
                      <button
                        className="absolute right-4 top-3 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-brand hover:bg-brand/10 transition-colors"
                        onClick={() => router.push(`/tasks/${a.task_id}`)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        任务
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
