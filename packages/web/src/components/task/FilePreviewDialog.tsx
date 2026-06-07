/** FilePreviewDialog — 文件预览弹框（支持 HTML/图片/Markdown 预览 + 下载） */

"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  X, Download, Loader2, FileText, Image as ImageIcon,
  Code, FileWarning,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type FileCategory = "image" | "html" | "markdown" | "text" | "binary";

function categorizeFile(path: string): FileCategory {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
  if (["html", "htm"].includes(ext)) return "html";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (["txt", "json", "yml", "yaml", "toml", "xml", "log", "csv", "tsv", "ini", "cfg", "conf", "sh", "bash", "zsh", "py", "js", "ts", "tsx", "jsx", "css", "scss", "less", "go", "rs", "java", "c", "cpp", "h", "rb", "php", "sql", "env", "gitignore", "dockerfile", "makefile"].includes(ext)) return "text";
  return "binary";
}

interface FilePreviewDialogProps {
  open: boolean;
  filePath: string;
  taskId: string;
  onClose: () => void;
}

export default function FilePreviewDialog({
  open,
  filePath,
  taskId,
  onClose,
}: FilePreviewDialogProps) {
  const category = categorizeFile(filePath);
  const fileName = filePath.split("/").pop() ?? filePath;
  const fileUrl = `/api/tasks/${taskId}/files/${filePath}`;
  const downloadUrl = `/api/tasks/${taskId}/files/${filePath}?download=true`;

  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTextContent(null);
      setError(null);
      return;
    }
    // 文本类和 Markdown 需要获取内容
    if (category === "text" || category === "markdown") {
      setLoading(true);
      setError(null);
      fetch(fileUrl)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then(text => setTextContent(text))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [open, category, fileUrl]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={cn(
          "animate-scale-in flex flex-col bg-card border border-border shadow-2xl rounded-2xl overflow-hidden",
          "w-[90vw] max-w-4xl",
          category === "image" ? "max-h-[85vh]" : "max-h-[80vh]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-surface-hover/20 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <CategoryIcon category={category} />
            <span className="text-sm font-semibold text-foreground truncate" title={fileName}>
              {fileName}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">
              {category === "binary" ? "二进制文件" : category === "image" ? "图片" : category === "html" ? "HTML" : category === "markdown" ? "Markdown" : "文本"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="text-xs h-7" asChild>
              <a href={downloadUrl} download={fileName}>
                <Download className="h-3 w-3 mr-1" />下载
              </a>
            </Button>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-0">
          {/* 图片预览 */}
          {category === "image" && (
            <div className="flex items-center justify-center p-6 min-h-[300px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fileUrl}
                alt={fileName}
                className="max-w-full max-h-[65vh] object-contain rounded-lg"
              />
            </div>
          )}

          {/* HTML 预览 */}
          {category === "html" && (
            <iframe
              src={fileUrl}
              title={fileName}
              className="w-full border-0"
              style={{ height: "65vh" }}
              sandbox="allow-scripts allow-same-origin"
            />
          )}

          {/* Markdown 预览 */}
          {category === "markdown" && (
            <div className="p-6">
              {loading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />加载中...
                </div>
              )}
              {error && (
                <div className="text-sm text-destructive text-center py-8">
                  加载失败: {error}
                </div>
              )}
              {!loading && !error && textContent && (
                <article className="prose prose-sm prose-invert max-w-none text-foreground/90
                  prose-headings:text-foreground prose-a:text-brand prose-code:text-brand/80
                  prose-pre:bg-surface prose-pre:border prose-pre:border-border/40">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {textContent}
                  </ReactMarkdown>
                </article>
              )}
            </div>
          )}

          {/* 文本预览 */}
          {category === "text" && (
            <div className="p-4">
              {loading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />加载中...
                </div>
              )}
              {error && (
                <div className="text-sm text-destructive text-center py-8">
                  加载失败: {error}
                </div>
              )}
              {!loading && !error && textContent && (
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all bg-surface rounded-lg border border-border/40 p-4 max-h-[65vh] overflow-auto">
                  {textContent}
                </pre>
              )}
            </div>
          )}

          {/* 二进制文件 — 仅下载提示 */}
          {category === "binary" && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileWarning className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm mb-3">此文件格式不支持在线预览</p>
              <Button variant="outline" size="sm" asChild>
                <a href={downloadUrl} download={fileName}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />下载文件
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryIcon({ category }: { category: FileCategory }) {
  const Icon = category === "image" ? ImageIcon
    : category === "html" ? Code
    : category === "markdown" ? FileText
    : FileText;
  return <Icon className="h-4 w-4 text-brand shrink-0" />;
}
