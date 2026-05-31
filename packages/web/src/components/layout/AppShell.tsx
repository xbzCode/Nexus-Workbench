"use client";

import TopBar from "./TopBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
