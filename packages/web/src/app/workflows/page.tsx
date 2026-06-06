"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { useWorkflows, useWorkflowActions } from "@/hooks/useWorkflow";
import type { WorkflowCreate } from "@/lib/types";
import { Workflow as WorkflowIcon, Loader2, Plus, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] as const } },
};

export default function WorkflowsPage() {
  const router = useRouter();
  const { workflows, loading, error } = useWorkflows();
  const { create } = useWorkflowActions();

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
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-6 mt-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Workflows</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Manage your AI Agent workflows</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)} className="shadow-sm">
            <Plus className="mr-1.5 h-4 w-4" />New Workflow
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Empty */}
        {workflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface border border-border/60">
              <WorkflowIcon className="h-8 w-8" />
            </div>
            <p className="mb-1 text-base font-medium">No workflows yet</p>
            <p className="mb-4 text-sm">Create your first AI Agent workflow</p>
            <Button onClick={() => setShowCreate(true)}>New Workflow</Button>
          </div>
        )}

        {/* Grid */}
        {workflows.length > 0 && (
          <motion.div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {workflows.map((wf) => (
              <motion.div key={wf.id} variants={cardVariants}>
                <Link href={`/workflows/${wf.id}`}>
                  <div className="group rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/20 hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--color-brand)_8%,transparent)] active:scale-[0.99]">
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {wf.category && (
                          <span className="rounded-md bg-surface px-1.5 py-0.5 border border-border/50">{wf.category}</span>
                        )}
                        <span className="font-mono">v{wf.version}</span>
                        <span>{wf.dag?.nodes?.length ?? 0} nodes</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-brand group-hover:translate-x-0.5 transition-all opacity-0 group-hover:opacity-100" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
          >
            <motion.div
              className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-5 text-base font-semibold text-foreground">New Workflow</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wf-name">Name *</Label>
                  <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Code Review Pipeline" autoFocus required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wf-desc">Description</Label>
                  <Textarea id="wf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this workflow does" rows={3} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wf-cat">Category</Label>
                  <Input id="wf-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. devops" />
                </div>
                {createError && <p className="text-sm text-destructive">{createError}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button type="submit" disabled={submitting || !name.trim()}>
                    {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
