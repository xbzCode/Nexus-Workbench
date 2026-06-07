/** ActionCenter — 行动中心：聚合所有待办审批，提供一站式操作 */

"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import ApprovalCard from "@/components/approval/ApprovalCard";
import type { Approval } from "@/lib/types";
import {
  Bell, Inbox, CheckCircle2, Sparkles,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { useState } from "react";

interface ActionCenterProps {
  pendingApprovals: Approval[];
  onResolveApproval: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
}

export default function ActionCenter({ pendingApprovals, onResolveApproval }: ActionCenterProps) {
  const [collapsed, setCollapsed] = useState(false);

  // 无待办时显示空状态 — 撑满剩余高度
  if (pendingApprovals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-surface/20 p-4 h-full min-h-[120px] flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground/50">
            <Inbox className="h-5 w-5" />
            <span>无待处理事项</span>
          </div>
          <p className="text-[11px] text-muted-foreground/35">所有审批已处理完毕</p>
        </div>
      </div>
    );
  }

  // 按 urgency 排序: critical > high > normal > auto_decidable
  const URGENCY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, auto_decidable: 3 };
  const sorted = [...pendingApprovals].sort(
    (a, b) => (URGENCY_ORDER[a.urgency ?? "normal"] ?? 99) - (URGENCY_ORDER[b.urgency ?? "normal"] ?? 99)
  );

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all duration-300",
      "border-amber/25 bg-amber-muted/[0.08]",
      // 微妙动画提示有待办
      "shadow-[0_0_20px_-5px_rgba(245,166,35,0.1)]"
    )}>
      {/* 标题栏 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-amber/5 hover:bg-amber/[0.08] transition-colors"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          >
            <Bell className="h-4 w-4 text-amber" />
          </motion.div>
          <span className="text-sm font-semibold text-amber">行动中心</span>
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber px-1.5 text-[10px] font-bold text-white">
            {sorted.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">需要您的操作</span>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      {/* 审批列表 */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-3 pb-3 pt-1">
              {sorted.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onResolve={onResolveApproval}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
