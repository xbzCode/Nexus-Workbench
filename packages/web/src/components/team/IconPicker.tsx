"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "文档",
    emojis: ["📄", "📝", "📋", "📑", "📚", "📖", "✍️", "📰", "📓", "📔"],
  },
  {
    label: "开发",
    emojis: ["💻", "⚙️", "🔧", "🛠️", "🐛", "🚀", "⚡", "🧩", "🔌", "🖥️"],
  },
  {
    label: "设计",
    emojis: ["🎨", "🖌️", "🖼️", "🎯", "✨", "🌟", "💡", "🎭", "🪄", "🌈"],
  },
  {
    label: "数据",
    emojis: ["📊", "📈", "📉", "🔢", "🧮", "💹", "📶", "🔍", "📐", "🎲"],
  },
  {
    label: "通用",
    emojis: ["👥", "🤖", "🧠", "💬", "🔔", "🏆", "🎪", "🌐", "🏗️", "🔮"],
  },
];

interface IconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg border text-xl transition-colors",
          "hover:border-brand/50 hover:bg-brand/5",
          open ? "border-brand bg-brand/5" : "border-border",
        )}
      >
        {value || "👥"}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-popover border border-border rounded-xl shadow-xl p-3">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-0.5">
                {group.label}
              </p>
              <div className="grid grid-cols-10 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onChange(emoji);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded text-sm transition-colors",
                      "hover:bg-brand/10 hover:scale-110",
                      value === emoji && "bg-brand/20 ring-1 ring-brand/40",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
