/** Approval card — 支持回复类型：confirm / choice / ranking / input / form
 *
 * 优化点：
 * - confirm 类型标题行直接露出操作按钮（减少点击层级）
 * - choice ≤3 选项直接在标题行展示
 * - 操作按钮增加 loading 状态
 * - 支持 expired 状态展示
 */

"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { Approval, ApprovalType, ApprovalUrgency, ApprovalStatus } from "@/lib/types";
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
  Loader2,
  Timer,
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
 */
const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  confirm: { label: "确认", icon: ShieldCheck, color: "text-violet" },
  choice_single: { label: "单选", icon: ListChecks, color: "text-blue-400" },
  choice_multi: { label: "多选", icon: ListChecks, color: "text-sky-400" },
  ranking: { label: "排序", icon: ArrowUpDown, color: "text-purple-400" },
  input_text: { label: "输入", icon: MessageSquare, color: "text-amber" },
  form: { label: "表单", icon: ListChecks, color: "text-teal-400" },
};

interface ApprovalCardProps {
  approval: Approval;
  onResolve?: (id: string, status: "approved" | "rejected", result?: Record<string, unknown>) => void;
  compact?: boolean;
  className?: string;
}

/**
 * 审批上下文数据结构化渲染
 */
function ContextDataRenderer({ data }: { data: Record<string, unknown> }) {
  if (!data || typeof data !== "object") return null;

  const agentProgress = typeof data.agent_progress === "string" ? data.agent_progress : "";
  const question = typeof data.question === "string" ? data.question : "";
  const toolName = typeof data.tool_name === "string" ? data.tool_name : "";
  const toolInput = data.tool_input;
  const riskReasoning = typeof data.risk_reasoning === "string" ? data.risk_reasoning : "";
  const analysis = data.analysis;
  const nodeId = typeof data.node_id === "string" ? data.node_id : "";

  const handledKeys = new Set(["agent_progress", "question", "tool_name", "tool_input", "risk_reasoning", "node_id", "analysis"]);
  const otherKeys = Object.keys(data).filter(k => !handledKeys.has(k));
  const hasOthers = otherKeys.length > 0;

  return (
    <div className="space-y-2">
      {agentProgress && (
        <div>
          <span className="text-[11px] font-medium text-emerald-400/80 uppercase tracking-wider">Agent 输出</span>
          <div className="mt-1 rounded-lg bg-emerald-500/5 border border-emerald-400/10 p-2.5 text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
            {agentProgress}
          </div>
        </div>
      )}
      {question && question !== String(data.question) && (
        <div>
          <span className="text-[11px] font-medium text-purple-400/80 uppercase tracking-wider">问题详情</span>
          <p className="mt-1 text-xs text-foreground/70 whitespace-pre-wrap">{question}</p>
        </div>
      )}
      {toolName && (
        <div>
          <span className="text-[11px] font-medium text-brand/70 uppercase tracking-wider">工具调用</span>
          <div className="mt-1 rounded-lg bg-surface p-2.5 space-y-1 border border-border/40">
            <div className="text-xs"><span className="text-muted-foreground">工具:</span> <span className="font-mono text-foreground/60">{toolName}</span></div>
            {toolInput && (
              <pre className="text-[11px] font-mono text-foreground/40 whitespace-pre-wrap break-all max-h-24 overflow-auto">{typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
      {riskReasoning && (
        <div>
          <span className="text-[11px] font-medium text-red-400/70 uppercase tracking-wider">风险评估</span>
          <p className="mt-1 text-xs text-foreground/60">{riskReasoning}</p>
        </div>
      )}
      {analysis && typeof analysis === "object" && (
        <details>
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">LLM 分析结果</summary>
          <pre className="mt-1 max-h-24 overflow-auto rounded-lg bg-surface p-2 font-mono text-[11px] text-foreground/40 whitespace-pre-wrap break-all border border-border/40">{JSON.stringify(analysis, null, 2)}</pre>
        </details>
      )}
      {nodeId && (
        <div className="text-[10px] text-muted-foreground/40">节点: <span className="font-mono">{nodeId}</span></div>
      )}
      {hasOthers && (
        <details>
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors">更多上下文</summary>
          <pre className="mt-1 max-h-24 overflow-auto rounded-lg bg-surface p-2 font-mono text-[11px] text-foreground/40 whitespace-pre-wrap break-all border border-border/40">{JSON.stringify(Object.fromEntries(otherKeys.map(k => [k, data[k]])), null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/** 可排序的选项行 */
function SortableRankItem({ id, optIdx, rankIdx, label }: { id: string; optIdx: number; rankIdx: number; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };
  return (
    <div ref={setNodeRef} style={style} className={cn("flex items-center gap-3 px-4 py-3 text-sm cursor-grab active:cursor-grabbing transition-colors border-b last:border-b-0 border-border/40", isDragging ? "bg-purple-500/10 shadow-lg ring-1 ring-purple-500/20" : "hover:bg-surface-hover")} {...attributes} {...listeners}>
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/30" />
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", rankIdx === 0 ? "bg-amber text-white" : rankIdx === 1 ? "bg-muted-foreground/20 text-muted-foreground" : rankIdx === 2 ? "bg-orange-500/15 text-orange-400" : "bg-surface text-muted-foreground/50")}>{rankIdx + 1}</span>
      <span className="font-medium flex-1">{label}</span>
    </div>
  );
}

export default function ApprovalCard({ approval, onResolve, compact = false, className }: ApprovalCardProps) {
  const isPending = approval.status === "pending";
  const isExpired = approval.status === "expired";
  const urgency = URGENCY_STYLE[approval.urgency] ?? URGENCY_STYLE.normal;
  const UrgencyIcon = urgency.icon;

  // 提前解析选项（类型归一化和抽象检测都需要）
  const rawOptions = (approval.options as Array<{ label: string; value: string }> | null) ?? [];

  // 类型归一化
  let normalizedType = approval.type === "form" ? "form"
    : approval.type === "multi_choice" ? "choice_multi"
    : approval.type === "choice" ? "choice_single"
    : approval.type === "input" || approval.type === "question" ? "input_text"
    : approval.type === "yes_no" ? "confirm"
    : (TYPE_CONFIG[approval.type] ? approval.type : "input_text");

  // 前端兜底：choice 类型选项全部无效时降级为 input
  // 注：抽象选项检测已由后端 LLM 分类处理，此处仅做轻量兜底
  if ((normalizedType === "choice_single" || normalizedType === "choice_multi") && rawOptions.length > 0) {
    const validCount = rawOptions.filter(opt => {
      const value = opt.value ?? "";
      return value && value !== "unknown" && value !== "未指定" && value !== "不明确";
    }).length;
    if (validCount < 2) {
      normalizedType = "input_text";
    }
  }

  const typeConf = TYPE_CONFIG[normalizedType] ?? TYPE_CONFIG.input_text;
  const TypeIcon = typeConf.icon;

  const options = rawOptions;
  const formQuestions = normalizedType === "form"
    ? (approval.options as Array<{ id: string; type: string; question: string; options?: Array<{ label: string; value: string }> }> | null) ?? []
    : [];

  const resolvedResult = approval.result as Record<string, unknown> | null;
  const resolvedChoice = (resolvedResult?.choices ?? resolvedResult?.choice) as string[] | string | undefined;
  const resolvedAnswer = resolvedResult?.answer as string | undefined;
  const resolvedYes = resolvedResult?.yes as boolean | undefined;
  const resolvedRanked = (resolvedResult?.ranked ?? resolvedResult?.choices) as string[] | undefined;
  const resolvedLabels = (resolvedResult?.labels) as string[] | undefined;
  const resolvedFormAnswers = resolvedResult?.answers as Record<string, Record<string, unknown>> | undefined;

  // 状态管理
  const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
  const [otherText, setOtherText] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [resolving, setResolving] = useState<"approved" | "rejected" | null>(null);
  const descRef = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, unknown>>>(() => {
    const init: Record<string, Record<string, unknown>> = {};
    for (const q of formQuestions) init[q.id] = {};
    return init;
  });

  const [rankedOrder, setRankedOrder] = useState<number[]>(() =>
    options.length > 0 ? options.map((_, i) => i) : []
  );

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

  useEffect(() => {
    if (descRef.current) setOverflows(descRef.current.scrollHeight > descRef.current.clientHeight);
  }, [approval.description]);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  }, []);

  useEffect(() => {
    if (textareaRef.current && inputValue) adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const hasDetails = !!(approval.context_data || approval.validation_result);

  // 处理 resolve（带 loading）
  const handleResolve = async (status: "approved" | "rejected") => {
    if (!onResolve || resolving) return;
    let result: Record<string, unknown> | undefined;
    if (normalizedType === "form" && status === "approved") {
      // 处理 form 中 "other" 选项的自定义文本
      const processed: Record<string, Record<string, unknown>> = {};
      for (const q of formQuestions) {
        const ans = { ...formAnswers[q.id] };
        // choice: 如果选了 other，用 otherText 替换 value
        if (ans.choice === "other" && ans.otherText) {
          ans.choice = String(ans.otherText).trim();
        }
        // multi_choice: 如果包含 other，替换为自定义文本
        if (Array.isArray(ans.choices)) {
          const otherText = typeof ans.otherText === "string" ? ans.otherText.trim() : "";
          ans.choices = (ans.choices as string[]).map(v => v === "other" && otherText ? otherText : v);
        }
        processed[q.id] = ans;
      }
      result = { answers: processed };
    } else if ((normalizedType === "choice_single" || normalizedType === "choice_multi") && status === "approved") {
      const selected = Array.from(selectedOptions).map(i => options[i]).filter(Boolean);
      // 处理 "other" 选项：用用户输入的文本替换 value
      const finalSelected = selected.map(o => {
        if (o?.value === "other" && otherText.trim()) {
          return { label: otherText.trim(), value: otherText.trim() };
        }
        return o;
      });
      result = { choices: finalSelected.map(o => o?.value), labels: finalSelected.map(o => o?.label) };
      if (normalizedType === "choice_single") result = { choice: result.choices[0], label: result.labels[0] };
    } else if (normalizedType === "ranking" && status === "approved") {
      const ordered = rankedOrder.map(idx => options[idx]).filter(Boolean);
      result = { ranked: ordered.map(o => o!.value), labels: ordered.map(o => o!.label) };
    } else if (normalizedType === "input_text" && status === "approved") {
      result = { answer: inputValue.trim() || "Confirmed, continue" };
    }
    setResolving(status);
    try {
      await onResolve(approval.id, status, result);
    } catch {
      // 错误已在 useApproval.resolve 中 toast 提示并刷新列表
    } finally {
      setResolving(null);
    }
  };

  const toggleOption = (i: number) => {
    if (normalizedType === "choice_multi") {
      setSelectedOptions(prev => { const nx = new Set(prev); if (nx.has(i)) nx.delete(i); else nx.add(i); return nx; });
    } else {
      setSelectedOptions(new Set([i]));
    }
  };

  /** 判断某个选项索引是否为 "other" */
  const isOtherOption = (optIdx: number) => options[optIdx]?.value === "other";

  // ── Compact 模式 ──
  if (compact) {
    return (
      <motion.div className={cn("rounded-lg border p-3 transition-colors bg-card", isExpired && "border-dashed opacity-60", className)} whileHover={{ borderColor: "rgba(var(--border),0.4)" }}>
        <div className="flex items-center gap-3">
          <StatusBadge status={approval.status} />
          <span className="flex-1 text-sm font-medium truncate">{approval.title}</span>
          <span className={cn("text-[11px]", typeConf.color)}>{typeConf.label}</span>
          {!isPending && resolvedResult && (
            <span className="text-xs text-muted-foreground max-w-[180px] truncate">
              {normalizedType === "form" && resolvedFormAnswers ? (
                <span className="text-teal-400">已回复 {Object.keys(resolvedFormAnswers).length} 项</span>
              ) : resolvedYes !== undefined ? (
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
              ) : isExpired ? (
                <span className="text-muted-foreground/50">已过期</span>
              ) : (
                <span className="text-red-400">已拒绝</span>
              )}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {approval.resolved_at ? new Date(approval.resolved_at).toLocaleDateString("zh-CN") : new Date(approval.created_at).toLocaleDateString("zh-CN")}
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
        isPending ? "border-amber/20 bg-amber-muted/20" : isExpired ? "border-border/40 bg-card opacity-70 border-dashed" : "border-border bg-card",
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
              {isExpired && (
                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-muted-foreground/10 text-muted-foreground">
                  <Timer className="h-3 w-3" />已过期
                </span>
              )}
            </div>

            {/* 描述 */}
            {approval.description && (
              <>
                <p ref={descRef} className={cn("text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed", !descExpanded && "line-clamp-3")}>{approval.description}</p>
                {overflows && (
                  <button className="mt-1 text-xs font-medium text-brand/70 hover:text-brand transition-colors" onClick={() => setDescExpanded(!descExpanded)}>
                    {descExpanded ? "收起" : "展开全部"}
                  </button>
                )}
              </>
            )}

            {/* 元信息 */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><TypeIcon className="h-3 w-3" /><span className={typeConf.color}>{typeConf.label}</span></span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(approval.created_at).toLocaleString("zh-CN")}</span>
              {approval.expires_at && (
                <span className="flex items-center gap-1 text-amber/80"><AlertTriangle className="h-3 w-3" />过期: {new Date(approval.expires_at).toLocaleString("zh-CN")}</span>
              )}
            </div>
          </div>

          {/* ── 快捷操作：confirm 类型标题行直接露出 ── */}
          {isPending && onResolve && normalizedType === "confirm" && (
            <div className="flex items-center gap-1.5 shrink-0">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 border-emerald-400/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-400/50"
                  variant="outline"
                  disabled={resolving !== null}
                  onClick={() => handleResolve("approved")}
                >
                  {resolving === "approved" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  批准
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                  variant="outline"
                  disabled={resolving !== null}
                  onClick={() => handleResolve("rejected")}
                >
                  {resolving === "rejected" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  拒绝
                </Button>
              </motion.div>
            </div>
          )}

          {/* ── 快捷操作：choice ≤3 选项标题行直接露出 ── */}
          {isPending && onResolve && normalizedType === "choice_single" && options.length > 0 && options.length <= 3 && selectedOptions.size === 0 && (
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {options.map((opt, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-brand/40 hover:bg-brand/5 transition-colors"
                  onClick={() => { toggleOption(i); }}
                >
                  {opt.label}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 已解决的结果展示 */}
      {!isPending && resolvedResult && (
        <div className="px-4 py-3 bg-emerald-500/[0.03] border-b border-border/30">
          <div className="text-xs font-medium text-emerald-400 mb-1">处理结果</div>
          <div className="rounded-lg bg-surface p-3 text-sm">
            {normalizedType === "form" && resolvedFormAnswers ? (
              <div className="space-y-2">
                {formQuestions.map((q, qIdx) => {
                  const ans = resolvedFormAnswers[q.id] ?? {};
                  return (
                    <div key={q.id} className="flex items-start gap-2">
                      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white", qIdx === 0 ? "bg-teal-500" : "bg-muted-foreground/40")}>{qIdx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground">{q.question}</span>
                        <div className="mt-0.5 text-foreground">
                          {ans.choice ? (<span className="inline-flex items-center gap-1 rounded-md bg-brand/10 text-brand px-2 py-0.5 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />{String(ans.choice)}</span>)
                          : ans.choices && Array.isArray(ans.choices) ? (<div className="flex flex-wrap gap-1">{(ans.choices as string[]).map((c: string, i: number) => (<span key={i} className="inline-flex items-center gap-1 rounded-md bg-brand/10 text-brand px-2 py-0.5 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />{c}</span>))}</div>)
                          : ans.answer ? (<span className="text-foreground/80 whitespace-pre-wrap">{String(ans.answer)}</span>)
                          : ans.yes !== undefined ? (<span className={cn("font-medium", ans.yes ? "text-emerald-400" : "text-red-400")}>{ans.yes ? "是" : "否"}</span>)
                          : (<span className="text-muted-foreground">（未填写）</span>)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : resolvedYes !== undefined ? (
              <div><span className="text-muted-foreground text-xs block mb-2">排序结果（按优先级从高到低）：</span><ol className="space-y-1.5">{resolvedRanked?.map((c, i) => (<li key={i} className="flex items-center gap-2"><span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white", i === 0 ? "bg-amber" : i === 1 ? "bg-muted-foreground/60" : i === 2 ? "bg-orange-500/70" : "bg-border")}>{i + 1}</span><span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 text-purple-400 px-2 py-0.5 text-xs font-medium">{resolvedLabels?.[i] ?? c}</span></li>))}</ol></div>
            ) : Array.isArray(resolvedChoice) && resolvedChoice.length > 0 ? (
              <div><span className="text-muted-foreground text-xs block mb-1">选择了:</span>{resolvedChoice.map((c, i) => (<span key={i} className="inline-flex items-center gap-1 rounded-md bg-brand/10 text-brand px-2 py-0.5 text-xs font-medium mr-1 mb-1"><CheckCircle2 className="h-3 w-3" />{c}</span>))}</div>
            ) : resolvedChoice ? (
              <span>选择: <span className="font-medium text-foreground">{String(resolvedChoice)}</span></span>
            ) : resolvedAnswer ? (
              <div><span className="text-muted-foreground text-xs block mb-1">回答:</span><pre className="whitespace-pre-wrap text-foreground/80 mt-1">{resolvedAnswer}</pre></div>
            ) : approval.status === "approved" ? (
              <span className="text-emerald-400 font-medium">已批准</span>
            ) : isExpired ? (
              <span className="text-muted-foreground/50">审批已过期</span>
            ) : (
              <span className="text-red-400 font-medium">已拒绝</span>
            )}
          </div>
        </div>
      )}

      {/* 详情区域（可折叠） */}
      {hasDetails && (
        <details open={detailExpanded} className="group">
          <summary className="flex items-center gap-1 px-4 py-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none border-b border-transparent group-open:border-border/30" onClick={(e) => { e.preventDefault(); setDetailExpanded(v => !v); }}>
            <Info className="h-3 w-3" />详细信息{detailExpanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </summary>
          <div className="px-4 pb-3 space-y-2">
            {approval.context_data && <ContextDataRenderer data={approval.context_data as Record<string, unknown>} />}
            {approval.validation_result && (
              <div>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Validation Result</span>
                <pre className="mt-1 max-h-24 overflow-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all border border-border/40">{JSON.stringify(approval.validation_result, null, 2)}</pre>
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
            <div className={cn("grid gap-2", normalizedType === "choice_single" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
              {options.map((opt, i) => {
                const isSelected = selectedOptions.has(i);
                const isMulti = normalizedType === "choice_multi";
                const isOther = isOtherOption(i);
                const showOtherInput = isOther && isSelected;
                return (
                  <div key={i} className={showOtherInput ? "col-span-1 sm:col-span-2" : ""}>
                    <button onClick={() => toggleOption(i)} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-left transition-all w-full", isSelected ? "border-brand bg-brand/10 text-brand shadow-sm scale-[1.01]" : "border-border bg-card hover:border-brand/30 hover:bg-surface text-foreground")}>
                      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors", isSelected ? "border-brand bg-brand" : "border-muted-foreground/30")}>
                        {isSelected && (isMulti ? (<svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>) : (<span className="h-1.5 w-1.5 rounded-full bg-white" />))}
                      </span>
                      <span className="font-medium">{opt.label}</span>
                    </button>
                    {showOtherInput && (
                      <textarea
                        value={otherText}
                        onChange={(e) => setOtherText(e.target.value)}
                        placeholder="请输入..."
                        rows={2}
                        className="mt-2 w-full rounded-lg border border-brand/30 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 focus:outline-none resize-none transition-all"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 文本输入 */}
          {normalizedType === "input_text" && (
            <div className="space-y-2">
              <textarea ref={textareaRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleResolve("approved"); }} placeholder="输入你的回答... (Ctrl+Enter 发送)" rows={3} className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 focus:outline-none resize-none transition-all" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{inputValue.length} 字符</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border/40 font-mono">Ctrl+Enter</kbd>
              </div>
            </div>
          )}

          {/* 排序拖拽 */}
          {normalizedType === "ranking" && options.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpDown className="h-3.5 w-3.5" />上下拖拽调整优先级顺序（最上方优先级最高）</p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={rankedOrder.map(i => String(i))} strategy={verticalListSortingStrategy}>
                  <div className="rounded-lg border border-border bg-card overflow-hidden">
                    {rankedOrder.map((optIdx, rankIdx) => (<SortableRankItem key={optIdx} id={String(optIdx)} optIdx={optIdx} rankIdx={rankIdx} label={options[optIdx]?.label ?? ""} />))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Form 多问题表单 */}
          {normalizedType === "form" && formQuestions.length > 0 && (
            <div className="space-y-5">
              {formQuestions.map((q, qIdx) => {
                const qOpts = q.options ?? [];
                const qAnswer = formAnswers[q.id] ?? {};
                const qType = q.type;
                return (
                  <div key={q.id} className="space-y-2">
                    <label className="text-sm font-medium text-foreground flex items-start gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-teal-400 text-[10px] font-bold mt-0.5">{qIdx + 1}</span>
                      <span>{q.question}</span>
                    </label>
                    {qType === "choice" && qOpts.length > 0 && (
                      <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 pl-7">
                        {qOpts.map((opt, oi) => {
                          const selected = qAnswer.choice === opt.value || (qAnswer.choices as string[])?.includes(opt.value);
                          const isOther = opt.value === "other";
                          const showOtherInput = isOther && selected;
                          return (
                            <div key={oi} className={showOtherInput ? "col-span-1 sm:col-span-2" : ""}>
                              <button onClick={() => { setFormAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], choice: opt.value } })); }} className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-left transition-all w-full", selected ? "border-brand bg-brand/10 text-brand shadow-sm" : "border-border bg-card hover:border-brand/30 hover:bg-surface text-foreground")}>
                                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors", selected ? "border-brand bg-brand" : "border-muted-foreground/30")}>{selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
                                <span>{opt.label}</span>
                              </button>
                              {showOtherInput && (
                                <textarea
                                  value={(qAnswer.otherText as string) ?? ""}
                                  onChange={(e) => { setFormAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], otherText: e.target.value } })); }}
                                  placeholder="请输入..."
                                  rows={2}
                                  className="mt-2 w-full rounded-lg border border-brand/30 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 focus:outline-none resize-none transition-all"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {qType === "multi_choice" && qOpts.length > 0 && (
                      <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 pl-7">
                        {qOpts.map((opt, oi) => {
                          const currentChoices = (qAnswer.choices as string[]) ?? [];
                          const selected = currentChoices.includes(opt.value);
                          const isOther = opt.value === "other";
                          const showOtherInput = isOther && selected;
                          return (
                            <div key={oi} className={showOtherInput ? "col-span-1 sm:col-span-2" : ""}>
                              <button onClick={() => { setFormAnswers(prev => {
                                const cur = (prev[q.id]?.choices as string[]) ?? [];
                                const next = selected ? cur.filter(v => v !== opt.value) : [...cur, opt.value];
                                return { ...prev, [q.id]: { ...prev[q.id], choices: next } };
                              }); }} className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-left transition-all w-full", selected ? "border-brand bg-brand/10 text-brand shadow-sm" : "border-border bg-card hover:border-brand/30 hover:bg-surface text-foreground")}>
                                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors", selected ? "border-brand bg-brand" : "border-muted-foreground/30")}>{selected && (<svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>)}</span>
                                <span>{opt.label}</span>
                              </button>
                              {showOtherInput && (
                                <textarea
                                  value={(qAnswer.otherText as string) ?? ""}
                                  onChange={(e) => { setFormAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], otherText: e.target.value } })); }}
                                  placeholder="请输入..."
                                  rows={2}
                                  className="mt-2 w-full rounded-lg border border-brand/30 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 focus:outline-none resize-none transition-all"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {qType === "input" && (
                      <div className="pl-7">
                        <textarea value={(qAnswer.answer as string) ?? ""} onChange={(e) => { setFormAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], answer: e.target.value } })); }} placeholder="请输入..." rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 focus:outline-none resize-none transition-all" />
                      </div>
                    )}
                    {qType === "confirm" && (
                      <div className="pl-7 flex gap-2">
                        <button onClick={() => { setFormAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], yes: true } })); }} className={cn("flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all", qAnswer.yes === true ? "border-emerald-400 bg-emerald-500/10 text-emerald-400" : "border-border bg-card hover:border-emerald-400/30 text-foreground")}>
                          <CheckCircle2 className="h-4 w-4" /> 是
                        </button>
                        <button onClick={() => { setFormAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], yes: false } })); }} className={cn("flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all", qAnswer.yes === false ? "border-red-400 bg-red-500/10 text-red-400" : "border-border bg-card hover:border-red-400/30 text-foreground")}>
                          <XCircle className="h-4 w-4" /> 否
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 操作按钮（非 confirm 类型 — confirm 已在标题行展示） ── */}
          {normalizedType !== "confirm" && (
            <>
              {(normalizedType === "choice_single" || normalizedType === "choice_multi") && (
                <div className="flex gap-3 pt-1">
                  <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" className="w-full h-11" onClick={() => handleResolve("approved")} disabled={selectedOptions.size === 0 || resolving !== null || (Array.from(selectedOptions).some(i => isOtherOption(i)) && !otherText.trim())}>
                      {resolving === "approved" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      确认选择 ({selectedOptions.size})
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" variant="outline" className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleResolve("rejected")} disabled={resolving !== null}>
                      {resolving === "rejected" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                      拒绝
                    </Button>
                  </motion.div>
                </div>
              )}
              {normalizedType === "input_text" && (
                <div className="flex gap-3 pt-1">
                  <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" className="w-full h-11" onClick={() => handleResolve("approved")} disabled={!inputValue.trim() || resolving !== null}>
                      {resolving === "approved" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      提交
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" variant="outline" className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleResolve("rejected")} disabled={resolving !== null}>
                      跳过
                    </Button>
                  </motion.div>
                </div>
              )}
              {normalizedType === "ranking" && (
                <div className="flex gap-3 pt-1">
                  <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" className="w-full h-11" onClick={() => handleResolve("approved")} disabled={resolving !== null}>
                      {resolving === "approved" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      确认排序 ({rankedOrder.length}项)
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" variant="outline" className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleResolve("rejected")} disabled={resolving !== null}>
                      跳过
                    </Button>
                  </motion.div>
                </div>
              )}
              {normalizedType === "form" && (
                <div className="flex gap-3 pt-1">
                  <motion.div className="flex-1" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" className="w-full h-11" onClick={() => handleResolve("approved")} disabled={resolving !== null || (() => {
                      // 检查 form 中是否有选了 "other" 但没填文本的情况
                      for (const q of formQuestions) {
                        const ans = formAnswers[q.id] ?? {};
                        if (ans.choice === "other" && !String(ans.otherText ?? "").trim()) return true;
                        const choices = ans.choices as string[] | undefined;
                        if (choices?.includes("other") && !String(ans.otherText ?? "").trim()) return true;
                      }
                      return false;
                    })()}>
                      {resolving === "approved" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      提交回复 ({formQuestions.length}项)
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                    <Button size="lg" variant="outline" className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleResolve("rejected")} disabled={resolving !== null}>
                      跳过
                    </Button>
                  </motion.div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 已解决的底部时间戳 */}
      {!isPending && approval.resolved_at && (
        <div className="px-4 py-2.5 border-t border-border/30 bg-surface/50 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {isExpired ? "过期时间" : approval.status === "approved" ? "批准时间" : "拒绝时间"}: {new Date(approval.resolved_at).toLocaleString("zh-CN")}
          </span>
          <span className={cn("text-[11px] font-medium", isExpired ? "text-muted-foreground/50" : approval.status === "approved" ? "text-emerald-400" : "text-red-400")}>
            {isExpired ? "Expired" : approval.status === "approved" ? "Approved" : "Rejected"}
          </span>
        </div>
      )}
    </motion.div>
  );
}
