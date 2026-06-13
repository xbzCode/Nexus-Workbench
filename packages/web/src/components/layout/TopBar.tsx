"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { APIResponse, Task, Approval, ApprovalListData } from "@/lib/types";
import {
  MessageSquare,
  Play,
  Workflow,
  Blocks,
  Users,
  Sun,
  Moon,
  Bell,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const NAV_ITEMS = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/tasks", label: "Tasks", icon: Play },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/nodes", label: "Nodes", icon: Blocks },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
];

export default function TopBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="relative z-50 flex h-12 items-center border-b border-topbar-border bg-topbar/90 backdrop-blur-md px-4 shrink-0">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mr-8 group">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-brand-foreground transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_12px_color-mix(in_srgb,var(--color-brand)_40%,transparent)]">
          <Workflow className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-topbar-foreground">
          Nexus
        </span>
      </Link>

      {/* Navigation */}
      <nav className="flex items-center gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/" || pathname.startsWith("/chat")
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200",
                active
                  ? "bg-topbar-active-bg text-topbar-active"
                  : "text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover/50"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
              {active && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-5 rounded-full bg-brand" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Task status capsule */}
        <TaskCapsule />

        {/* Notifications */}
        <NotificationBell />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover/50 transition-all duration-200"
          title={mounted ? (theme === "dark" ? "切换亮色模式" : "切换暗色模式") : "切换主题"}
          suppressHydrationWarning
        >
          {mounted ? (
            theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>

        {/* User avatar */}
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand/20 to-brand-muted text-brand text-xs font-semibold cursor-pointer hover:from-brand/30 transition-colors ring-1 ring-brand/20">
          U
        </div>
      </div>
    </header>
  );
}

/** Mini task status capsules in the topbar */
function TaskCapsule() {
  const [running, setRunning] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const fetchCounts = useCallback(async () => {
    try {
      const [taskRes, approvalRes] = await Promise.all([
        api.get<APIResponse<Task[]>>("/tasks"),
        api.get<APIResponse<ApprovalListData>>("/approvals", { status: "pending", limit: "1" }),
      ]);
      const tasks = taskRes.data ?? [];
      setRunning(tasks.filter((t) => t.status === "running").length);
      setPendingApprovals(approvalRes.data?.total ?? 0);
    } catch {
      // silently fail — topbar should never block
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    const timer = setInterval(fetchCounts, 30_000);
    return () => clearInterval(timer);
  }, [fetchCounts]);

  if (running === 0 && pendingApprovals === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {running > 0 && (
        <Link href="/tasks" className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] border border-border/50 hover:bg-surface-hover transition-all duration-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_color-mix(in_srgb,var(--color-brand)_50%,transparent)]" />
          <span className="text-muted-foreground">Running</span>
          <span className="font-semibold text-foreground">{running}</span>
        </Link>
      )}
      {pendingApprovals > 0 && (
        <Link href="/approvals" className="flex items-center gap-1.5 rounded-full bg-amber-muted/50 px-2.5 py-1 text-[11px] border border-amber/20 hover:bg-amber-muted transition-all duration-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_6px_color-mix(in_srgb,var(--color-amber)_40%,transparent)]" />
          <span className="text-muted-foreground">Approvals</span>
          <span className="font-semibold text-amber">{pendingApprovals}</span>
        </Link>
      )}
    </div>
  );
}

/** 通知铃铛 — 带下拉预览 */
function NotificationBell() {
  const [pendingList, setPendingList] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await api.get<APIResponse<ApprovalListData>>("/approvals", { status: "pending", limit: "5" });
      setPendingList(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchPending();
    const timer = setInterval(fetchPending, 30_000);
    return () => clearInterval(timer);
  }, [fetchPending]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleQuickResolve = async (id: string, status: "approved" | "rejected") => {
    setResolving(id + status);
    try {
      await api.post<APIResponse<Approval>>(`/approvals/${id}/resolve`, { status });
      await fetchPending();
      toast.success(status === "approved" ? "已批准" : "已拒绝");
    } catch (e: unknown) {
      await fetchPending();
      const msg = e instanceof Error ? e.message : "操作失败";
      toast.error(msg);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover/50 transition-all duration-200"
      >
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1 shadow-[0_0_6px_rgba(239,68,68,0.4)]">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {/* 下拉面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-surface-hover/30">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-amber" />
                <span className="text-sm font-semibold text-foreground">待处理审批</span>
                {total > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber px-1 text-[9px] font-bold text-white">{total}</span>
                )}
              </div>
              <Link href="/approvals" onClick={() => setOpen(false)} className="text-[11px] font-medium text-brand hover:text-brand/80 transition-colors">
                查看全部
              </Link>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {pendingList.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <Bell className="mx-auto mb-2 h-6 w-6 opacity-30" />
                  无待处理审批
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {pendingList.map(a => (
                    <div key={a.id} className="px-4 py-3 hover:bg-surface-hover/30 transition-colors">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={cn("text-[10px] font-medium rounded px-1 py-0.5", a.urgency === "critical" ? "bg-red-500/10 text-red-400" : a.urgency === "high" ? "bg-amber/10 text-amber" : "bg-brand/10 text-brand")}>
                              {a.urgency === "critical" ? "严重" : a.urgency === "high" ? "紧急" : "普通"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{a.type}</span>
                          </div>
                          <p className="text-xs font-medium text-foreground truncate">{a.title}</p>
                          {a.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{a.description}</p>
                          )}
                        </div>
                      </div>
                      {/* 快捷操作：confirm 类型直接批准/拒绝 */}
                      {a.type === "confirm" ? (
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleQuickResolve(a.id, "approved")}
                            disabled={resolving !== null}
                            className="flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-400/50 transition-colors disabled:opacity-50"
                          >
                            {resolving === a.id + "approved" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            批准
                          </button>
                          <button
                            onClick={() => handleQuickResolve(a.id, "rejected")}
                            disabled={resolving !== null}
                            className="flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 hover:border-destructive/50 transition-colors disabled:opacity-50"
                          >
                            {resolving === a.id + "rejected" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                            拒绝
                          </button>
                          <Link
                            href="/approvals"
                            onClick={() => setOpen(false)}
                            className="ml-auto text-[11px] text-brand hover:text-brand/80 transition-colors"
                          >
                            详情
                          </Link>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-2">
                          <Link
                            href="/approvals"
                            onClick={() => setOpen(false)}
                            className="text-[11px] font-medium text-brand hover:text-brand/80 transition-colors"
                          >
                            前往处理 →
                          </Link>
                          <span className="text-[10px] text-muted-foreground/40 ml-auto">{new Date(a.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
