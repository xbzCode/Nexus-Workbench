/** Approval card — 支持回复类型：confirm / choice / ranking / input（兜底） */

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
  Send,
  ChevronDown,
  ChevronUp,
  Info,
  GripVertical,
  ArrowUpDown,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const URGENCY_STYLE: Record<string, { bg: string; icon: React.ElementType; label: string }> = {
  auto_decidable: { bg: "bg-emerald-500/10 text-emerald-400", icon: Zap, label: "可自动决定" },
  normal: { bg: "bg-brand/10 text-brand", icon: Clock, label: "普通" },
  high: { bg: "bg-amber/10 text-amber", icon: AlertTriangle, label: "紧急" },
  critical: { bg: "bg-red-500/10 text-red-400", icon: AlertTriangle, label: "严重" },
};

/**
 * 审批类型配置
 *
 * 后端 LLM 分类产出 4 种 type：confirm | choice | ranking | input
 * 前端 normalizedType 映射：choice → choice_single，input → input_text
 * choice_multi 保留供未来使用
 * 未识别类型 fallback 到 input_text（文本输入兜底）
 */
const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  confirm: { label: "确认", icon: ShieldCheck, color: "text-violet" },
  choice_single: { label: "单选", icon: ListChecks, color: "text-blue-400" },
  choice_multi: { label: "多选", icon: ListChecks, color: "text-sky-400" },
  ranking: { label: "排序", icon: ArrowUpDown, color: "text-purple-400" },
  input_text: { label: "输入", icon: MessageSquare, color: "text-amber" },
};

interface ApprovalCardProps {
  approval: Approval;
  onResolve?: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  compact?: boolean;
  className?: string;
}

/** 可排序的选项行 */
function SortableRankItem({ id, optIdx, rankIdx, label }: { id: string; optIdx: number; rankIdx: number; label: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-4 py-3 text-sm cursor-grab active:cursor-grabbing transition-colors border-b last:border-b-0 border-border/40",
        isDragging ? "bg-purple-500/10 shadow-lg ring-1 ring-purple-500/20" : "hover:bg-surface-hover"
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/30" />
      <span className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        rankIdx === 0 ? "bg-amber text-white"
          : rankIdx === 1 ? "bg-muted-foreground/20 text-muted-foreground"
          : rankIdx === 2 ? "bg-orange-500/15 text-orange-400"
          : "bg-surface text-muted-foreground/50"
      )}>{rankIdx + 1}</span>
      <span className="font-medium flex-1">{label}</span>
    </div>
  );
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

  // 类型归一化：后端 type → 前端 normalizedType
  // choice → choice_single | input/question → input_text | yes_no → confirm | 其他 → input_text（兜底）
  const normalizedType = approval.type === "choice" ? "choice_single"
    : approval.type === "input" || approval.type === "question" ? "input_text"
    : approval.type === "yes_no" ? "confirm"
    : (TYPE_CONFIG[approval.type] ? approval.type : "input_text");
  const typeConf = TYPE_CONFIG[normalizedType] ?? TYPE_CONFIG.input_text;
  const TypeIcon = typeConf.icon;

  const options = (approval.options as Array<{ label: string; value: string }> | null) ?? [];
  const resolvedResult = approval.result as Record<string, unknown> | null;
  const resolvedChoice = (resolvedResult?.choices ?? resolvedResult?.choice) as string[] | string | undefined;
  const resolvedAnswer = resolvedResult?.answer as string | undefined;
  const resolvedYes = resolvedResult?.yes as boolean | undefined;
  // 排序结果：ranking 类型用 ranked / labels 字段
  const resolvedRanked = (resolvedResult?.ranked ?? resolvedResult?.choices) as string[] | undefined;
  const resolvedLabels = (resolvedResult?.labels) as string[] | undefined;

  // 状态管理
  const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
  const [inputValue, setInputValue] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 排序类型状态
  const [rankedOrder, setRankedOrder] = useState<number[]>(() =>
    options.length > 0 ? options.map((_, i) => i) : []
  );

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRankedOrder(prev => {
      const oldIndex = prev.indexOf(Number(active.id));
      const newIndex = prev.indexOf(Number(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved!);
      return next;
    });
  }, []);

  // 检查描述是否溢出
  useEffect(() => {
    if (descRef.current) {
      setOverflows(descRef.current.scrollHeight > descRef.current.clientHeight);
    }
  }, [approval.description]);

  // textarea 自动高度
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current && inputValue) adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const hasDetails = !!(approval.context_data || approval.validation_result);

  // 处理 resolve
  const handleResolve = (status: "approved" | "rejected") => {
    if (!onResolve) return;
    let result: Record<string, unknown> | undefined;
    if ((normalizedType === "choice_single" || normalizedType === "choice_multi") && status === "approved") {
      const selected = Array.from(selectedOptions).map(i => options[i]).filter(Boolean);
      result = {
        choices: selected.map(o => o?.value),
        labels: selected.map(o => o?.label),
      };
      if (normalizedType === "choice_single") result = { choice: result.choices[0], label: result.labels[0] };
    } else if (normalizedType === "ranking" && status === "approved") {
      const ordered = rankedOrder.map(idx => options[idx]).filter(Boolean);
      result = {
        ranked: ordered.map(o => o!.value),
        labels: ordered.map(o => o!.label),
      };
    } else if (normalizedType === "input_text" && status === "approved") {
      result = { answer: inputValue.trim() || "Confirmed, continue" };
    }
    // confirm 类型无需额外 result，status 即表达了 approve/reject
    onResolve(approval.id, status, result);
  };

  const toggleOption = (i: number) => {
    if (normalizedType === "choice_multi") {
      setSelectedOptions(prev => {
        const nx = new Set(prev);
        if (nx.has(i)) nx.delete(i); else nx.add(i);
        return nx;
      });
    } else {
      setSelectedOptions(new Set([i]));
    }
  };

  // ── Compact 模式 ──
  if (compact) {
    return (
      <motion.div
        className={cn("rounded-lg border p-3 transition-colors bg-card", className)}
        whileHover={{ borderColor: "rgba(var(--border),0.4)" }}
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={approval.status} />
          <span className="flex-1 text-sm font-medium truncate">{approval.title}</span>
          <span className={cn("text-[11px]", typeConf.color)}>{typeConf.label}</span>
          {/* 结果摘要 */}
          {!isPending && resolvedResult && (
            <span className="text-xs text-muted-foreground max-w-[180px] truncate">
              {resolvedYes !== undefined ? (
                <span className={cn(resolvedYes ? "text-emerald-400" : "text-red-400")}>{resolvedYes ? "是" : "否"}</span>
              ) : resolvedRanked && Array.isArray(resolvedRanked) && resolvedRanked.length > 0 ? (
                <span className="text-purple-400">排序: {resolvedLabels?.[0] ?? resolvedRanked[0]} 等 {resolvedRanked.length} 项</span>
              ) : Array.isArray(resolvedChoice) && resolvedChoice.length > 0 ? (
                <span className="text-emerald-400">已选 {resolvedChoice.length} 项</span>
              ) : resolvedChoice ? (
                <span className="text-emerald-400">{String(resolvedChoice)}</span>
              ) : resolvedAnswer ? (
                <span className="text-emerald-400 line-clamp-1">{resolvedAnswer.slice(0, 30)}{resolvedAnswer.length > 30 ? "..." : ""}</span>
              ) : approval.status === "approved" ? (
                <span className="text-emerald-400">已批准</span>
              ) : (
                <span className="text-red-400">已拒绝</span>
              )}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {approval.resolved_at
              ? new Date(approval.resolved_at).toLocaleDateString("zh-CN")
              : new Date(approval.created_at).toLocaleDateString("zh-CN")}
          </span>
        </div>
      </motion.div>
    );
  }

  // ── 完整模式 ──
  return (
    <motion.div
      className={cn(
        "rounded-xl border overflow-hidden transition-colors",
        isPending
          ? "border-amber/20 bg-amber-muted/20"
          : "border-border bg-card",
        className
      )}
      whileHover={isPending ? { borderColor: "rgba(245,166,35,0.35)" } : {}}
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-border/40">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <StatusBadge status={approval.status} />
              <h3 className="text-sm font-semibold text-foreground truncate">{approval.title}</h3>
              {isPending && (
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium", urgency.bg)}>
                  <UrgencyIcon className="h-3 w-3" />{urgency.label}
                </span>
              )}
            </div>

            {/* 描述 */}
            {approval.description && (
              <p
                ref={descRef}
                className={cn(
                  "text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed",
                  !descExpanded && "line-clamp-3"
                )}
              >
                {approval.description}
              </p>
            )}
            {overflows && (
              <button
                className="mt-1 text-xs font-medium text-brand/70 hover:text-brand transition-colors"
                onClick={() => setDescExpanded(!descExpanded)}
              >
                {descExpanded ? "收起" : "展开全部"}
              </button>
            )}

            {/* 元信息 */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><TypeIcon className="h-3 w-3" /><span className={typeConf.color}>{typeConf.label}</span></span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(approval.created_at).toLocaleString("zh-CN")}</span>
              {approval.expires_at && (
                <span className="flex items-center gap-1 text-amber/80">
                  <AlertTriangle className="h-3 w-3" />
                  过期: {new Date(approval.expires_at).toLocaleString("zh-CN")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 已解决的结果展示 */}
      {!isPending && resolvedResult && (
        <div className="px-4 py-3 bg-emerald-500/[0.03] border-b border-border/30">
          <div className="text-xs font-medium text-emerald-400 mb-1">处理结果</div>
          <div className="rounded-lg bg-surface p-3 text-sm">
            {resolvedYes !== undefined ? (
              <span className={cn("font-medium", resolvedYes ? "text-emerald-400" : "text-red-400")}>
                判断结果: {resolvedYes ? "是 (Yes)" : "否 (No)"}
              </span>
            ) : resolvedRanked && Array.isArray(resolvedRanked) && resolvedRanked.length > 0 ? (
              <div>
                <span className="text-muted-foreground text-xs block mb-2">排序结果（按优先级从高到低）：</span>
                <ol className="space-y-1.5">
                  {resolvedRanked.map((c, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                        i === 0 ? "bg-amber" : i === 1 ? "bg-muted-foreground/60" : i === 2 ? "bg-orange-500/70" : "bg-border"
                      )}>{i + 1}</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 text-purple-400 px-2 py-0.5 text-xs font-medium">
                        {resolvedLabels?.[i] ?? c}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : Array.isArray(resolvedChoice) && resolvedChoice.length > 0 ? (
              <div><span className="text-muted-foreground text-xs block mb-1">选择了:</span>{resolvedChoice.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-brand/10 text-brand px-2 py-0.5 text-xs font-medium mr-1 mb-1">
                  <CheckCircle2 className="h-3 w-3" />{c}
                </span>
              ))}</div>
            ) : resolvedChoice ? (
              <span>选择: <span className="font-medium text-foreground">{String(resolvedChoice)}</span></span>
            ) : resolvedAnswer ? (
              <div><span className="text-muted-foreground text-xs block mb-1">回答:</span><pre className="whitespace-pre-wrap text-foreground/80 mt-1">{resolvedAnswer}</pre></div>
            ) : approval.status === "approved" ? (
              <span className="text-emerald-400 font-medium">已批准</span>
            ) : (
              <span className="text-red-400 font-medium">已拒绝</span>
            )}
          </div>
        </div>
      )}

      {/* 详情区域（可折叠） */}
      {hasDetails && (
        <details open={detailExpanded} className="group">
          <summary
            className="flex items-center gap-1 px-4 py-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none border-b border-transparent group-open:border-border/30"
            onClick={(e) => { e.preventDefault(); setDetailExpanded(v => !v); }}
          >
            <Info className="h-3 w-3" />
            详细信息
            {detailExpanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </summary>
          <div className="px-4 pb-3 space-y-2">
            {approval.context_data && (
              <div>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Context Data</span>
                <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all border border-border/40">
                  {JSON.stringify(approval.context_data, null, 2)}
                </pre>
              </div>
            )}
            {approval.validation_result && (
              <div>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Validation Result</span>
                <pre className="mt-1 max-h-24 overflow-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all border border-border/40">
                  {JSON.stringify(approval.validation_result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}

      {/* 操作区域 — 仅 pending 时显示 */}
      {isPending && onResolve && (
        <div className="px-4 py-4 space-y-3 bg-surface-hover/[0.02]">
          {/* 选择题选项 */}
          {(normalizedType === "choice_single" || normalizedType === "choice_multi") && options.length > 0 && (
            <div className={cn(
              "grid gap-2",
              normalizedType === "choice_single" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
            )}>
              {options.map((opt, i) => {
                const isSelected = selectedOptions.has(i);
                const isMulti = normalizedType === "choice_multi";
                return (
                  <button
                    key={i}
                    onClick={() => toggleOption(i)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-left transition-all",
                      isSelected
                        ? "border-brand bg-brand/10 text-brand shadow-sm scale-[1.01]"
                        : "border-border bg-card hover:border-brand/30 hover:bg-surface text-foreground"
                    )}
                  >
                    <span className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isSelected
                        ? isMulti ? "border-brand bg-brand" : "border-brand bg-brand"
                        : isMulti ? "border-muted-foreground/30" : "border-muted-foreground/30"
                    )}>
                      {isSelected && (isMulti ? (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      ))}
                    </span>
                    <span className="font-medium">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 文本输入（input 兜底） */}
          {normalizedType === "input_text" && (
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleResolve("approved"); }}
                placeholder="输入你的回答... (Ctrl+Enter 发送)"
                rows={3}
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 focus:outline-none resize-none transition-all"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{inputValue.length} 字符</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border/40 font-mono">Ctrl+Enter</kbd>
              </div>
            </div>
          )}

          {/* 排序拖拽 */}
          {normalizedType === "ranking" && options.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ArrowUpDown className="h-3.5 w-3.5" />上下拖拽调整优先级顺序（最上方优先级最高）
              </p>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={rankedOrder.map(i => String(i))}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="rounded-lg border border-border bg-card overflow-hidden">
                    {rankedOrder.map((optIdx, rankIdx) => (
                      <SortableRankItem key={optIdx} id={String(optIdx)} optIdx={optIdx} rankIdx={rankIdx} label={options[optIdx]?.label ?? ""} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* 操作按钮 */}
          {normalizedType === "confirm" && (
            <div className="flex gap-3 pt-1">
              <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  className="w-full h-11 border-emerald-400/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-400/50"
                  variant="outline"
                  onClick={() => handleResolve("approved")}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  批准 (Approve)
                </Button>
              </motion.div>
              <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  className="w-full h-11 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                  variant="outline"
                  onClick={() => handleResolve("rejected")}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  拒绝 (Reject)
                </Button>
              </motion.div>
            </div>
          )}

          {/* 选择/输入的提交按钮 */}
          {(normalizedType === "choice_single" || normalizedType === "choice_multi") && (
            <div className="flex gap-3 pt-1">
              <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  className="w-full h-11"
                  onClick={() => handleResolve("approved")}
                  disabled={selectedOptions.size === 0}
                >
                  <Send className="mr-2 h-4 w-4" />
                  确认选择 ({selectedOptions.size})
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => handleResolve("rejected")}
                >
                  拒绝
                </Button>
              </motion.div>
            </div>
          )}

          {normalizedType === "input_text" && (
            <div className="flex gap-3 pt-1">
              <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button size="lg" className="w-full h-11" onClick={() => handleResolve("approved")} disabled={!inputValue.trim()}>
                  <Send className="mr-2 h-4 w-4" />
                  提交 (Submit)
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => handleResolve("rejected")}
                >
                  跳过
                </Button>
              </motion.div>
            </div>
          )}

          {/* 排序提交按钮 */}
          {normalizedType === "ranking" && (
            <div className="flex gap-3 pt-1">
              <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  className="w-full h-11"
                  onClick={() => handleResolve("approved")}
                >
                  <Send className="mr-2 h-4 w-4" />
                  确认排序 ({rankedOrder.length}项)
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => handleResolve("rejected")}
                >
                  跳过
                </Button>
              </motion.div>
            </div>
          )}
        </div>
      )}

      {/* 已解决的底部时间戳 */}
      {!isPending && approval.resolved_at && (
        <div className="px-4 py-2.5 border-t border-border/30 bg-surface/50 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {approval.status === "approved" ? "批准时间" : "拒绝时间"}: {new Date(approval.resolved_at).toLocaleString("zh-CN")}
          </span>
          <span className={cn("text-[11px] font-medium", approval.status === "approved" ? "text-emerald-400" : "text-red-400")}>
            {approval.status === "approved" ? "Approved" : "Rejected"}
          </span>
        </div>
      )}
    </motion.div>
  );
}
