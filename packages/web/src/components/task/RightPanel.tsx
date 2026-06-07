/** RightPanel — 右侧面板：行动中心（自适应填充）+ 底部快速输入（固定） */

"use client";

import { useState, useRef, useCallback } from "react";
import ActionCenter from "./ActionCenter";
import type { Approval } from "@/lib/types";
import {
  Send,
} from "lucide-react";

interface RightPanelProps {
  // 行动中心数据
  pendingApprovals: Approval[];
  onResolveApproval: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;

  // 快速输入
  onQuickSend?: (message: string) => void;
}

export default function RightPanel({
  pendingApprovals, onResolveApproval,
  onQuickSend,
}: RightPanelProps) {
  const [quickInput, setQuickInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const msg = quickInput.trim();
    if (!msg || !onQuickSend) return;
    onQuickSend(msg);
    setQuickInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
  };

  // 输入框最大高度拉高
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  }, []);

  return (
    <div className="flex-1 border-l border-border bg-background flex flex-col overflow-hidden min-w-0">
      {/* 上部：行动中心 — 自适应填充剩余空间 */}
      <div className="flex-1 min-h-0 px-4 py-5 overflow-y-auto">
        <ActionCenter pendingApprovals={pendingApprovals} onResolveApproval={onResolveApproval} />
      </div>

      {/* 下部：快速输入栏 — 固定底部 */}
      {onQuickSend && (
        <div className="shrink-0 px-3 py-3 border-t border-border/40 bg-background/80 backdrop-blur-sm">
          <div className="relative rounded-xl border border-border bg-card overflow-hidden focus-within:border-brand/30 transition-colors">
            <textarea
              ref={textareaRef}
              value={quickInput}
              onChange={(e) => { setQuickInput(e.target.value); adjustHeight(); }}
              onKeyDown={handleKeyDown}
              placeholder="输入消息或补充指令... (Ctrl+Enter)"
              rows={2}
              className="w-full px-3 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none bg-transparent"
              style={{ maxHeight: 200 }}
            />
            {/* 内嵌发送按钮 */}
            <button
              onClick={handleSend}
              disabled={!quickInput.trim()}
              className="absolute right-2 bottom-2 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-brand hover:bg-brand/8 disabled:opacity-30 disabled:hover:text-muted-foreground/40 disabled:hover:bg-transparent transition-colors"
              title="发送 (Ctrl+Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
