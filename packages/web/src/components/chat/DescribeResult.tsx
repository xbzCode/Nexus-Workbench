/** Describe results — SKILL.md preview or DAG workflow draft */

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { DescribeNodeResponse, DescribeWorkflowResponse, DAGDefinition } from "@/lib/types";
import { Sparkles, FileText, Workflow, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";

interface DescribeNodeResultProps {
  result: DescribeNodeResponse;
  onConfirm: (skillMd: string, overrides?: Record<string, string>) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DescribeNodeResult({ result, onConfirm, onCancel, loading }: DescribeNodeResultProps) {
  const [editName, setEditName] = useState(result.suggested.name || "");
  const [editDisplayName, setEditDisplayName] = useState(result.suggested.display_name || "");

  return (
    <motion.div
      className="rounded-2xl border border-violet/20 bg-violet/5 p-5 space-y-4 overflow-hidden shadow-lg"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet/20">
          <Sparkles className="h-4 w-4 text-violet" />
        </div>
        <div>
          <span className="text-sm font-semibold text-violet-300">AI Generated Node</span>
          <p className="text-[11px] text-muted-foreground">Review and confirm</p>
        </div>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Node Name</label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-violet/50 focus:outline-none transition-colors"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Display Name</label>
          <input
            value={editDisplayName}
            onChange={(e) => setEditDisplayName(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-violet/50 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* SKILL.md preview */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">SKILL.md Preview</span>
        </div>
        <pre className="rounded-xl bg-surface border border-border p-3.5 text-xs text-foreground/70 max-h-48 overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
          {result.skill_md}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          disabled={loading}
        >
          Cancel
        </button>
        <motion.button
          onClick={() => onConfirm(result.skill_md, { name: editName, display_name: editDisplayName })}
          className="flex items-center gap-1.5 rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white hover:bg-violet/90 transition-colors disabled:opacity-50"
          disabled={loading}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {loading ? "Registering..." : "Confirm Register"}
        </motion.button>
      </div>
    </motion.div>
  );
}

interface DescribeWorkflowResultProps {
  result: DescribeWorkflowResponse;
  onConfirm: (name: string, dag: DAGDefinition) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DescribeWorkflowResult({ result, onConfirm, onCancel, loading }: DescribeWorkflowResultProps) {
  return (
    <motion.div
      className="rounded-2xl border border-amber/20 bg-amber/5 p-5 space-y-4 overflow-hidden shadow-lg"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber/20">
          <Workflow className="h-4 w-4 text-amber" />
        </div>
        <div>
          <span className="text-sm font-semibold text-amber-300">AI Generated Workflow</span>
          <p className="text-[11px] text-muted-foreground">Review and confirm</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground font-medium">Name</p>
          <p className="text-foreground text-sm mt-0.5 font-medium">{result.name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Display</p>
          <p className="text-foreground text-sm mt-0.5">{result.display_name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Category</p>
          <p className="text-foreground text-sm mt-0.5">{result.category || "-"}</p>
        </div>
      </div>

      {result.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{result.description}</p>
      )}

      {/* DAG overview */}
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-1.5">
          DAG Nodes ({result.dag.nodes.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {result.dag.nodes.map((n) => (
            <span key={n.id} className="px-2.5 py-1 rounded-lg bg-amber/10 border border-amber/20 text-xs text-amber-300 font-medium">
              {n.definition_id}
            </span>
          ))}
        </div>
      </div>

      {result.dag.edges.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1.5">
            Edges ({result.dag.edges.length})
          </p>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {result.dag.edges.map((e, i) => (
              <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface border border-border">
                <span className="text-foreground/70 font-mono">{e.source_id}</span>
                <ArrowRight className="h-3 w-3 text-brand/60" />
                <span className="text-foreground/70 font-mono">{e.target_id}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          disabled={loading}
        >
          Cancel
        </button>
        <motion.button
          onClick={() => onConfirm(result.name, result.dag)}
          className="flex items-center gap-1.5 rounded-lg bg-amber/20 border border-amber/30 text-amber-300 px-4 py-2 text-sm font-medium hover:bg-amber/30 transition-colors disabled:opacity-50"
          disabled={loading}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {loading ? "Saving..." : "Confirm Save"}
        </motion.button>
      </div>
    </motion.div>
  );
}
