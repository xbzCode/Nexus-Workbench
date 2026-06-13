import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import AppShell from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nexus Workbench",
  description: "AI Agent Orchestration — Design, Execute, Observe",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* next-themes flash prevention - must run before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('agentflow-theme') || 'dark';
                  if (t === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch(e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              classNames: {
                toast: "!bg-card !text-foreground !border-border/60 !rounded-xl !shadow-lg !shadow-black/20 !backdrop-blur-md",
                title: "!font-medium !text-[13px]",
                description: "!text-muted-foreground !text-xs mt-1",
                actionButton: "!bg-brand hover:!bg-brand/90 !text-brand-foreground !rounded-md !text-xs font-medium",
                cancelButton: "!bg-muted hover:!bg-muted/80 !text-muted-foreground !rounded-md !text-xs",
                closeButton: "!text-muted-foreground hover:!text-foreground !opacity-50 hover:!opacity-100",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
