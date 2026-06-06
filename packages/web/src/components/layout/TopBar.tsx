"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { APIResponse, Task, Approval } from "@/lib/types";
import {
  MessageSquare,
  Play,
  Workflow,
  Blocks,
  Sun,
  Moon,
  Bell,
  ShieldCheck,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: Play },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/nodes", label: "Nodes", icon: Blocks },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
];

export default function TopBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="flex h-12 items-center border-b border-topbar-border bg-topbar/90 backdrop-blur-md px-4 shrink-0">
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
          title={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
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

/** Mini task status capsules in the topbar — 动态数据 */
function TaskCapsule() {
  const [running, setRunning] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const fetchCounts = useCallback(async () => {
    try {
      const [taskRes, approvalRes] = await Promise.all([
        api.get<APIResponse<Task[]>>("/tasks"),
        api.get<APIResponse<Approval[]>>("/approvals", { status: "pending" }),
      ]);
      const tasks = taskRes.data ?? [];
      const approvals = approvalRes.data ?? [];
      setRunning(tasks.filter((t) => t.status === "running").length);
      setPendingApprovals(approvals.filter((a) => a.status === "pending").length);
    } catch {
      // silently fail — topbar should never block
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    // 轮询 30s 更新
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

/** 通知铃铛 — 动态 pending 审批计数 */
function NotificationBell() {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await api.get<APIResponse<Approval[]>>("/approvals", { status: "pending" });
      setCount((res.data ?? []).filter((a) => a.status === "pending").length);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const timer = setInterval(fetchCount, 30_000);
    return () => clearInterval(timer);
  }, [fetchCount]);

  return (
    <Link
      href="/approvals"
      className="relative flex h-8 w-8 items-center justify-center rounded-lg text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover/50 transition-all duration-200"
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1 shadow-[0_0_6px_rgba(239,68,68,0.4)]">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
