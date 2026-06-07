"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { APIResponse, Team } from "@/lib/types";
import { Users, Loader2, ChevronDown } from "lucide-react";

interface TeamSelectorProps {
  value: string | null;
  onChange: (teamId: string | null) => void;
}

export function TeamSelector({ value, onChange }: TeamSelectorProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<APIResponse<Team[]>>("/teams?status=active")
      .then(res => {
        if (!cancelled && res.success && res.data) {
          setTeams(res.data);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selectedTeam = teams.find(t => t.id === value);

  const handleSelect = useCallback((teamId: string | null) => {
    onChange(teamId);
    setOpen(false);
  }, [onChange]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors",
          "hover:border-brand/50 hover:bg-brand/5",
          value ? "border-brand/40 bg-brand/5 text-brand" : "border-border text-muted-foreground",
        )}
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Users className="w-3 h-3" />
        )}
        <span>{selectedTeam ? selectedTeam.display_name : "Auto (推荐)"}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 w-56 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
            <div className="py-1">
              <button
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                  "hover:bg-muted",
                  !value && "bg-brand/10 text-brand font-medium",
                )}
                onClick={() => handleSelect(null)}
              >
                <Users className="w-3.5 h-3.5" />
                <div className="text-left">
                  <div className="font-medium">自动匹配（推荐）</div>
                  <div className="text-[10px] text-muted-foreground">AI 智能选择最合适的 Team</div>
                </div>
              </button>

              {teams.map(team => (
                <button
                  key={team.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                    "hover:bg-muted",
                    value === team.id && "bg-brand/10 text-brand font-medium",
                  )}
                  onClick={() => handleSelect(team.id)}
                >
                  <span className="text-sm">{team.icon || "👥"}</span>
                  <div className="text-left">
                    <div className="font-medium truncate">{team.display_name}</div>
                    {team.description && (
                      <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">
                        {team.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}

              {teams.length === 0 && !loading && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  暂无活跃 Team
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
