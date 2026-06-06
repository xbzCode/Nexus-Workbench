"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import ApprovalCard from "@/components/approval/ApprovalCard";
import { useApprovals } from "@/hooks/useApproval";
import { Clock, CheckCircle2, Loader2, ExternalLink, Bell } from "lucide-react";

export default function ApprovalsPage() {
  const { pending, resolved, loading, error, resolve } = useApprovals();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading...
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
      <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Approvals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Approve or reject critical steps during task execution
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-3xl mx-auto w-full">
        {/* Pending */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber/10">
              <Clock className="h-4 w-4 text-amber" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Pending ({pending.length})</h2>
              <p className="text-[11px] text-muted-foreground">Awaiting your response</p>
            </div>
          </div>

          {pending.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No pending approvals</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((a) => (
                <div key={a.id} className="relative">
                  <ApprovalCard approval={a} onResolve={resolve} />
                  <button
                    className="absolute right-4 top-4 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-brand hover:bg-brand/10 transition-colors"
                    onClick={() => router.push(`/tasks/${a.task_id}`)}
                  >
                    <ExternalLink className="h-3 w-3" />View Task
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Resolved */}
        {resolved.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Resolved ({resolved.length})</h2>
                <p className="text-[11px] text-muted-foreground">Previously handled</p>
              </div>
            </div>

            <div className="space-y-2">
              {resolved.map((a) => (
                <div key={a.id} className="relative">
                  <ApprovalCard approval={a} compact />
                  <button
                    className="absolute right-4 top-3 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-brand hover:bg-brand/10 transition-colors"
                    onClick={() => router.push(`/tasks/${a.task_id}`)}
                  >
                    <ExternalLink className="h-3 w-3" />Task
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
