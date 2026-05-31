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
    <header className="flex h-12 items-center border-b border-topbar-border bg-topbar px-4 shrink-0">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mr-6 group">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-brand-foreground transition-transform group-hover:scale-105">
          <Workflow className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-bold tracking-tight text-topbar-foreground">
          AgentFlow
        </span>
      </Link>

      {/* Navigation */}
      <nav className="flex items-center gap-1">
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
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all",
                active
                  ? "bg-topbar-active-bg text-topbar-active"
                  : "text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
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
          className="flex h-8 w-8 items-center justify-center rounded-md text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover transition-all hover:rotate-12"
          title={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>

        {/* User avatar */}
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted text-brand text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity">
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
        <Link href="/tasks" className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] hover:bg-surface-hover transition-colors">
          <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-soft" />
          <span className="text-muted-foreground">Running</span>
          <span className="font-semibold text-foreground">{running}</span>
        </Link>
      )}
      {pendingApprovals > 0 && (
        <Link href="/approvals" className="flex items-center gap-1.5 rounded-full bg-amber-muted px-2.5 py-1 text-[11px] hover:opacity-80 transition-opacity">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
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
      className="relative flex h-8 w-8 items-center justify-center rounded-md text-topbar-muted hover:text-topbar-foreground hover:bg-surface-hover transition-colors"
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground px-1">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
