"use client";

import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import ApprovalCard from "@/components/approval/ApprovalCard";
import StatusBadge from "@/components/shared/StatusBadge";
import { useApprovals, type ApprovalFilters } from "@/hooks/useApproval";
import type { Approval, ApprovalType, ApprovalSource, ApprovalUrgency, ApprovalStatus } from "@/lib/types";
import {
  Clock, CheckCircle2, Loader2, ExternalLink, Bell, Search,
  ShieldCheck, ListChecks, MessageSquare, ArrowUpDown, Zap,
  Filter, X, Inbox, ChevronDown,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";

// ── 类型/来源/紧急度的筛选配置 ──

const TYPE_OPTIONS: { value: ApprovalType | "all"; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "全部", icon: ShieldCheck },
  { value: "confirm", label: "确认", icon: ShieldCheck },
  { value: "choice", label: "单选", icon: ListChecks },
  { value: "multi_choice", label: "多选", icon: ListChecks },
  { value: "input", label: "输入", icon: MessageSquare },
  { value: "ranking", label: "排序", icon: ArrowUpDown },
  { value: "form", label: "表单", icon: ListChecks },
];

const SOURCE_OPTIONS: { value: ApprovalSource | "all"; label: string }[] = [
  { value: "all", label: "全部来源" },
  { value: "agent", label: "Agent" },
  { value: "workflow", label: "Workflow" },
];

const URGENCY_OPTIONS: { value: ApprovalUrgency | "all"; label: string }[] = [
  { value: "all", label: "全部紧急度" },
  { value: "critical", label: "严重" },
  { value: "high", label: "紧急" },
  { value: "normal", label: "普通" },
  { value: "auto_decidable", label: "可自动决定" },
];

type StatusTab = "all" | ApprovalStatus;

const STATUS_TABS: { value: StatusTab; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "全部", icon: Bell },
  { value: "pending", label: "待处理", icon: Clock },
  { value: "approved", label: "已批准", icon: CheckCircle2 },
  { value: "rejected", label: "已拒绝", icon: X },
  { value: "expired", label: "已过期", icon: Clock },
];

// ── 按时间分组 ──

function groupByTime(approvals: { created_at: string }[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: { key: string; label: string; items: typeof approvals }[] = [];
  const todayItems = approvals.filter(a => new Date(a.created_at) >= today);
  const yesterdayItems = approvals.filter(a => {
    const d = new Date(a.created_at);
    return d >= yesterday && d < today;
  });
  const olderItems = approvals.filter(a => new Date(a.created_at) < yesterday);

  if (todayItems.length > 0) groups.push({ key: "today", label: "今天", items: todayItems });
  if (yesterdayItems.length > 0) groups.push({ key: "yesterday", label: "昨天", items: yesterdayItems });
  if (olderItems.length > 0) groups.push({ key: "older", label: "更早", items: olderItems });

  return groups;
}

// ── 按 urgency 排序 pending ──

const URGENCY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, auto_decidable: 3 };

function sortByUrgency(approvals: { urgency?: string }[]) {
  return [...approvals].sort(
    (a, b) => (URGENCY_ORDER[a.urgency ?? "normal"] ?? 99) - (URGENCY_ORDER[b.urgency ?? "normal"] ?? 99)
  );
}

// ── 可折叠分组 ──

const DEFAULT_VISIBLE = 3; // 默认展示条数

function CollapsibleGroup({
  icon,
  iconBg,
  title,
  titleClass,
  subtitle,
  items,
  defaultVisible = DEFAULT_VISIBLE,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  titleClass?: string;
  subtitle?: string;
  items: unknown[];
  defaultVisible?: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(items.length <= defaultVisible);
  const hasMore = items.length > defaultVisible;

  return (
    <section>
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex items-center gap-2 mb-3 group w-full text-left"
      >
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg shrink-0", iconBg)}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className={cn("text-sm font-semibold", titleClass ?? "text-foreground")}>{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground/50 transition-transform duration-200 shrink-0", collapsed && "-rotate-90")} />
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3">
              {children}
            </div>
            {hasMore && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border/40 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover/50 transition-colors w-full justify-center"
              >
                <ChevronDown className="h-3 w-3" />
                展开更多（还有 {items.length - defaultVisible} 条）
              </button>
            )}
            {hasMore && showAll && (
              <button
                onClick={() => setShowAll(false)}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border/40 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover/50 transition-colors w-full justify-center"
              >
                <ChevronDown className="h-3 w-3 rotate-180" />
                收起
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ── Compact 行：卡片 + 跳转按钮在同一 flex 行 ──

const COMPACT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  confirm: { label: "确认", color: "text-violet" },
  choice: { label: "单选", color: "text-blue-400" },
  multi_choice: { label: "多选", color: "text-sky-400" },
  ranking: { label: "排序", color: "text-purple-400" },
  input: { label: "输入", color: "text-amber" },
  form: { label: "表单", color: "text-teal-400" },
};

function CompactApprovalRow({ approval, onGoTask }: { approval: Approval; onGoTask: () => void }) {
  const isExpired = approval.status === "expired";
  const isPending = approval.status === "pending";

  const typeConf = COMPACT_TYPE_CONFIG[approval.type] ?? COMPACT_TYPE_CONFIG.confirm;

  const resolvedResult = approval.result as Record<string, unknown> | null;
  const resolvedChoice = (resolvedResult?.choices ?? resolvedResult?.choice) as string[] | string | undefined;
  const resolvedAnswer = resolvedResult?.answer as string | undefined;
  const resolvedYes = resolvedResult?.yes as boolean | undefined;
  const resolvedRanked = (resolvedResult?.ranked ?? resolvedResult?.choices) as string[] | undefined;
  const resolvedLabels = (resolvedResult?.labels) as string[] | undefined;

  return (
    <motion.div
      className={cn("rounded-lg border p-3 transition-colors bg-card flex items-center gap-3", isExpired && "border-dashed opacity-60")}
      whileHover={{ borderColor: "rgba(var(--border),0.4)" }}
    >
      <StatusBadge status={approval.status} />
      <span className="flex-1 text-sm font-medium truncate min-w-0">{approval.title}</span>
      <span className={cn("text-[11px] shrink-0", typeConf.color)}>{typeConf.label}</span>
      {!isPending && resolvedResult && (
        <span className="text-xs text-muted-foreground max-w-[180px] truncate shrink-0">
          {resolvedYes !== undefined ? (
            <span className={cn(resolvedYes ? "text-emerald-400" : "text-red-400")}>{resolvedYes ? "是" : "否"}</span>
          ) : resolvedRanked && Array.isArray(resolvedRanked) && resolvedRanked.length > 0 ? (
            <span className="text-purple-400">{resolvedLabels?.[0] ?? resolvedRanked[0]} 等</span>
          ) : Array.isArray(resolvedChoice) && resolvedChoice.length > 0 ? (
            <span className="text-emerald-400">已选 {resolvedChoice.length} 项</span>
          ) : resolvedChoice ? (
            <span className="text-emerald-400">{String(resolvedChoice)}</span>
          ) : resolvedAnswer ? (
            <span className="text-emerald-400 truncate">{resolvedAnswer.slice(0, 20)}{resolvedAnswer.length > 20 ? "..." : ""}</span>
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
      <button
        onClick={onGoTask}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-brand hover:bg-brand/10 transition-colors shrink-0"
      >
        <ExternalLink className="h-3 w-3" />详情
      </button>
    </motion.div>
  );
}

// ── 主页面 ──

export default function ApprovalsPage() {
  const { approvals, pending, total, statusCounts, loading, error, resolve, filters, updateFilters, hasMore, loadMore } = useApprovals();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [showFilters, setShowFilters] = useState(false);

  const pendingCount = pending.length;

  const handleStatusTabChange = useCallback((tab: StatusTab) => {
    const newFilters: ApprovalFilters = { ...filters };
    if (tab === "all") {
      delete newFilters.status;
    } else {
      newFilters.status = tab;
    }
    updateFilters(newFilters);
  }, [filters, updateFilters]);

  const handleSearch = useCallback(() => {
    updateFilters({ ...filters, search: searchInput || undefined });
  }, [filters, searchInput, updateFilters]);

  const handleFilterChange = useCallback(<K extends keyof ApprovalFilters>(key: K, value: ApprovalFilters[K]) => {
    const newFilters = { ...filters, [key]: value === "all" ? undefined : value };
    if (key !== "search") delete (newFilters as Record<string, unknown>)[key];
    if (value !== "all") newFilters[key] = value as never;
    else delete newFilters[key];
    updateFilters(newFilters);
  }, [filters, updateFilters]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    updateFilters({ status: "all" });
  }, [updateFilters]);

  const activeStatusTab: StatusTab = (filters.status as StatusTab) ?? "all";
  const hasActiveFilters = filters.type || filters.source || filters.urgency || filters.search;

  // pending 按 urgency 分组
  const pendingSorted = useMemo(() => sortByUrgency(pending), [pending]);
  const criticalPending = pendingSorted.filter(a => a.urgency === "critical");
  const highPending = pendingSorted.filter(a => a.urgency === "high");
  const normalPending = pendingSorted.filter(a => a.urgency !== "critical" && a.urgency !== "high");

  // 已解决按时间分组
  const resolvedItems = approvals.filter(a => a.status !== "pending");
  const resolvedGroups = useMemo(() => groupByTime(resolvedItems), [resolvedItems]);

  if (loading && approvals.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-6 mt-6 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Approvals</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              审批管理 · 共 {total} 条{pendingCount > 0 && ` · ${pendingCount} 条待处理`}
            </p>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <X className="h-3 w-3" />清除筛选
            </button>
          )}
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1">
          {STATUS_TABS.map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeStatusTab === tab.value;
            const count = tab.value === "all" ? statusCounts.all
              : tab.value === "pending" ? statusCounts.pending
              : tab.value === "approved" ? statusCounts.approved
              : tab.value === "rejected" ? statusCounts.rejected
              : tab.value === "expired" ? statusCounts.expired
              : 0;
            return (
              <button
                key={tab.value}
                onClick={() => handleStatusTabChange(tab.value)}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200",
                  isActive
                    ? "bg-brand/10 text-brand"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover/50"
                )}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {tab.label}
                {count > 0 && (
                  <span className={cn(
                    "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                    tab.value === "pending" ? "bg-amber" : "bg-muted-foreground/40"
                  )}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + Filter Bar */}
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              placeholder="搜索标题或描述..."
              className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-brand/40 focus:ring-2 focus:ring-brand/10 focus:outline-none transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
              showFilters || hasActiveFilters
                ? "border-brand/30 bg-brand/5 text-brand"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-surface-hover"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            筛选
          </button>
        </div>

        {/* Expandable Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-3 pt-3">
                {/* Type filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">类型:</span>
                  {TYPE_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => handleFilterChange("type", opt.value)}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                          (filters.type ?? "all") === opt.value
                            ? "bg-brand/10 text-brand"
                            : "bg-surface text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3 w-3" />{opt.label}
                      </button>
                    );
                  })}
                </div>

                <div className="w-px h-5 bg-border/50" />

                {/* Source filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">来源:</span>
                  {SOURCE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleFilterChange("source", opt.value)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                        (filters.source ?? "all") === opt.value
                          ? "bg-brand/10 text-brand"
                          : "bg-surface text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="w-px h-5 bg-border/50" />

                {/* Urgency filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">紧急度:</span>
                  {URGENCY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleFilterChange("urgency", opt.value)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                        (filters.urgency ?? "all") === opt.value
                          ? "bg-brand/10 text-brand"
                          : "bg-surface text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-3xl mx-auto w-full">

        {/* ── Critical Pending ── */}
        {criticalPending.length > 0 && (
          <CollapsibleGroup
            icon={<Zap className="h-4 w-4 text-red-400" />}
            iconBg="bg-red-500/10"
            title={`严重紧急 (${criticalPending.length})`}
            titleClass="text-red-400"
            subtitle="需要立即处理"
            items={criticalPending}
            defaultVisible={5}
          >
            {criticalPending.map(a => (
              <ApprovalCard key={a.id} approval={a} onResolve={resolve} />
            ))}
          </CollapsibleGroup>
        )}

        {/* ── High Pending ── */}
        {highPending.length > 0 && (
          <CollapsibleGroup
            icon={<Clock className="h-4 w-4 text-amber" />}
            iconBg="bg-amber/10"
            title={`紧急 (${highPending.length})`}
            titleClass="text-amber"
            subtitle="尽快处理"
            items={highPending}
            defaultVisible={5}
          >
            {highPending.map(a => (
              <ApprovalCard key={a.id} approval={a} onResolve={resolve} />
            ))}
          </CollapsibleGroup>
        )}

        {/* ── Normal Pending ── */}
        {normalPending.length > 0 && (
          <CollapsibleGroup
            icon={<Bell className="h-4 w-4 text-brand" />}
            iconBg="bg-brand/10"
            title={`待处理 (${normalPending.length})`}
            subtitle="等待您的操作"
            items={normalPending}
          >
            {normalPending.map(a => (
              <ApprovalCard key={a.id} approval={a} onResolve={resolve} />
            ))}
          </CollapsibleGroup>
        )}

        {/* ── No Pending ── */}
        {pendingCount === 0 && (activeStatusTab === "all" || activeStatusTab === "pending") && (
          <div className="rounded-xl border border-dashed border-border/40 bg-surface/20 p-8 text-center">
            <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">无待处理审批</p>
            <p className="text-[11px] text-muted-foreground/50 mt-1">所有审批已处理完毕</p>
          </div>
        )}

        {/* ── Resolved by Time ── */}
        {resolvedGroups.map(group => (
          <CollapsibleGroup
            key={group.key}
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            iconBg="bg-emerald-500/10"
            title={`${group.label} (${group.items.length})`}
            items={group.items}
            defaultVisible={5}
          >
            {group.items.map(a => (
              <CompactApprovalRow key={a.id} approval={a} onGoTask={() => router.push(`/tasks/${a.task_id}`)} />
            ))}
          </CollapsibleGroup>
        ))}

        {/* ── Load More ── */}
        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              onClick={loadMore}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <Loader2 className={cn("h-4 w-4", loading && "animate-spin")} />
              加载更多
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
