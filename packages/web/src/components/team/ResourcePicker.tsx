"use client";

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, X, Workflow, FileText } from "lucide-react";

interface ResourceItem {
  id: string;
  name: string;
  display_name?: string;
  description?: string | null;
  category?: string | null;
  status?: string;
}

interface ResourcePickerProps {
  type: "workflow" | "node";
  items: ResourceItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
}

export function ResourcePicker({
  type,
  items,
  selectedIds,
  onChange,
  loading,
}: ResourcePickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.display_name && item.display_name.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  }, [items, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.id)),
    [items, selectedSet],
  );

  const toggle = useCallback(
    (id: string) => {
      if (selectedSet.has(id)) {
        onChange(selectedIds.filter((i) => i !== id));
      } else {
        onChange([...selectedIds, id]);
      }
    },
    [selectedIds, selectedSet, onChange],
  );

  const removeSelected = useCallback(
    (id: string) => {
      onChange(selectedIds.filter((i) => i !== id));
    },
    [selectedIds, onChange],
  );

  const Icon = type === "workflow" ? Workflow : FileText;
  const label = type === "workflow" ? "工作流" : "节点";

  return (
    <div className="space-y-2">
      {/* Selected tags */}
      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedItems.map((item) => (
            <Badge
              key={item.id}
              variant="secondary"
              className="gap-1 pr-1 text-xs"
            >
              <Icon className="w-3 h-3" />
              {item.display_name || item.name}
              <button
                type="button"
                onClick={() => removeSelected(item.id)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`搜索${label}...`}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* List */}
      <ScrollArea className="h-[160px] rounded-md border">
        <div className="p-1">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              {search ? "无匹配结果" : `暂无可用${label}`}
            </div>
          ) : (
            filtered.map((item) => {
              const isSelected = selectedSet.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={cn(
                    "w-full flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                    "hover:bg-muted/60",
                    isSelected && "bg-brand/5",
                  )}
                >
                  {/* Checkbox indicator */}
                  <div
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-brand border-brand text-brand-foreground"
                        : "border-input",
                    )}
                  >
                    {isSelected && (
                      <svg
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="h-3 w-3"
                      >
                        <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {item.display_name || item.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {item.name}
                      {item.category && ` · ${item.category}`}
                    </div>
                  </div>
                  {item.status && item.status !== "active" && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 shrink-0"
                    >
                      {item.status}
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <p className="text-[10px] text-muted-foreground">
        已选择 {selectedIds.length} / {items.length} 个{label}
      </p>
    </div>
  );
}
