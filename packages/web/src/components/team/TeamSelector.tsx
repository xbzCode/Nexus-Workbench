"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { APIResponse, Team } from "@/lib/types";
import { Loader2, Sparkles } from "lucide-react";

interface TeamSelectorProps {
  value: string | null;
  onChange: (teamId: string | null) => void;
}

export function TeamSelector({ value, onChange }: TeamSelectorProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<APIResponse<Team[]>>("/teams?status=active")
      .then(res => {
        if (!cancelled && res.success && res.data) {
          // Filter out teams with no workflows and no nodes
          setTeams(res.data.filter(t => t.workflow_ids.length > 0 || t.node_definition_ids.length > 0));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Loading teams...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
      {/* Auto option */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full border transition-all duration-200 whitespace-nowrap shrink-0",
          "hover:border-brand/40 hover:bg-brand/5",
          value === null
            ? "border-brand/50 bg-brand/10 text-brand font-medium shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-brand)_20%,transparent)]"
            : "border-border/60 text-muted-foreground bg-transparent",
        )}
      >
        <Sparkles className="w-3 h-3" />
        <span>Auto</span>
      </button>

      {/* Team pills */}
      {teams.map(team => (
        <button
          key={team.id}
          type="button"
          onClick={() => onChange(value === team.id ? null : team.id)}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full border transition-all duration-200 whitespace-nowrap shrink-0",
            "hover:border-brand/40 hover:bg-brand/5",
            value === team.id
              ? "border-brand/50 bg-brand/10 text-brand font-medium shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-brand)_20%,transparent)]"
              : "border-border/60 text-muted-foreground bg-transparent",
          )}
          title={team.description || team.display_name}
        >
          <span className="text-xs">{team.icon || "👥"}</span>
          <span>{team.display_name}</span>
        </button>
      ))}

      {teams.length === 0 && !loading && (
        <span className="text-[11px] text-muted-foreground/50">暂无 Team</span>
      )}
    </div>
  );
}
