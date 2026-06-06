/** Approval card — confirm/choice/input/question with spring interaction */

"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { Approval } from "@/lib/types";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Clock,
  ListChecks,
  MessageSquare,
  HelpCircle,
  Send,
} from "lucide-react";
import { useState } from "react";

const URGENCY_STYLE: Record<string, { bg: string; icon: React.ElementType }> = {
  auto_decidable: { bg: "bg-emerald-500/10 text-emerald-400", icon: Zap },
  normal: { bg: "bg-brand/10 text-brand", icon: Clock },
  high: { bg: "bg-amber/10 text-amber", icon: AlertTriangle },
  critical: { bg: "bg-red-500/10 text-red-400", icon: AlertTriangle },
};

const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  confirm: { label: "Confirm", icon: ShieldCheck, color: "text-violet" },
  choice: { label: "Choice", icon: ListChecks, color: "text-blue-400" },
  input: { label: "Input", icon: MessageSquare, color: "text-amber" },
  question: { label: "Question", icon: HelpCircle, color: "text-amber" },
};

interface ApprovalCardProps {
  approval: Approval;
  onResolve?: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  compact?: boolean;
  className?: string;
}

export default function ApprovalCard({
  approval,
  onResolve,
  compact = false,
  className,
}: ApprovalCardProps) {
  const isPending = approval.status === "pending";
  const urgency = URGENCY_STYLE[approval.urgency] ?? URGENCY_STYLE.normal;
  const UrgencyIcon = urgency.icon;
  const typeKey = approval.type || "confirm";
  const typeConf = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.confirm;
  const TypeIcon = typeConf.icon;

  const [selectedOption, setSelectedOption] = useState<number>(0);
  const [inputValue, setInputValue] = useState("");

  const options = (approval.options as Array<{ label: string; value: string }> | null) ?? [];
  const resolvedResult = approval.result as Record<string, unknown> | null;
  const resolvedChoice = resolvedResult?.choice as string | undefined;
  const resolvedAnswer = resolvedResult?.answer as string | undefined;

  const handleResolve = (status: "approved" | "rejected") => {
    if (!onResolve) return;
    let result: Record<string, unknown> | undefined;
    if (typeKey === "choice" && status === "approved") {
      const opt = options[selectedOption];
      result = { choice: opt?.value ?? opt?.label, label: opt?.label };
    } else if ((typeKey === "input" || typeKey === "question") && status === "approved") {
      result = { answer: inputValue || "Confirmed, continue" };
    }
    onResolve(approval.id, status, result);
  };

  return (
    <motion.div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        isPending
          ? "border-amber/20 bg-amber-muted/30"
          : "border-border bg-card",
        className
      )}
      whileHover={isPending ? { borderColor: "rgba(245,166,35,0.3)" } : {}}
    >
      <div className={cn("flex items-start justify-between gap-4", compact && "items-center")}>
        {/* Left info */}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <StatusBadge status={approval.status} />
            <span className="text-sm font-medium text-foreground truncate">
              {approval.title}
            </span>
          </div>

          {!compact && approval.description && (
            <p className="mb-3 text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap leading-relaxed">
              {approval.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            <span className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium", urgency.bg)}>
              <UrgencyIcon className="h-3 w-3" />
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <TypeIcon className="h-3 w-3" />
              {typeConf.label}
            </span>
          </div>

          {/* Resolved result */}
          {!isPending && !compact && resolvedResult && (
            <div className="mt-2 rounded-lg bg-surface p-2 text-xs text-muted-foreground">
              {resolvedChoice && <span>Chose: <span className="text-foreground font-medium">{resolvedChoice}</span></span>}
              {resolvedAnswer && <span>Answered: <span className="text-foreground font-medium">{resolvedAnswer}</span></span>}
              {!resolvedChoice && !resolvedAnswer && approval.status === "approved" && <span className="text-emerald-400">Approved</span>}
              {approval.status === "rejected" && <span className="text-red-400">Rejected</span>}
            </div>
          )}
        </div>

        {/* Right actions */}
        {isPending && onResolve && (
          <div className="flex shrink-0 flex-col gap-2 min-w-[180px]">
            {/* Choice options */}
            {typeKey === "choice" && options.length > 0 && (
              <div className="flex flex-col gap-1">
                {options.map((opt, i) => (
                  <label
                    key={i}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors",
                      selectedOption === i
                        ? "border-brand bg-brand/10 text-brand font-medium"
                        : "border-border hover:border-brand/30 text-foreground"
                    )}
                  >
                    <input
                      type="radio"
                      name={`choice-${approval.id}`}
                      checked={selectedOption === i}
                      onChange={() => setSelectedOption(i)}
                      className="accent-brand shrink-0"
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Input/Question textarea */}
            {(typeKey === "input" || typeKey === "question") && (
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type your response..."
                rows={3}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/50 focus:outline-none resize-none transition-colors"
              />
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              {(typeKey === "input" || typeKey === "question") && (
                <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                  <Button size="sm" className="w-full" onClick={() => handleResolve("approved")}>
                    <Send className="mr-1 h-3.5 w-3.5" />Submit
                  </Button>
                </motion.div>
              )}
              {typeKey === "choice" && options.length > 0 && (
                <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                  <Button size="sm" className="w-full" onClick={() => handleResolve("approved")}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Confirm
                  </Button>
                </motion.div>
              )}
              {typeKey === "confirm" && (
                <>
                  <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-emerald-400/30 text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => handleResolve("approved")}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve
                    </Button>
                  </motion.div>
                  <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => handleResolve("rejected")}
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                    </Button>
                  </motion.div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Resolved time */}
        {!isPending && approval.resolved_at && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(approval.resolved_at).toLocaleString("zh-CN")}
          </span>
        )}
      </div>
    </motion.div>
  );
}
