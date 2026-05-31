/** JSON 查看器组件 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

interface JsonViewerProps {
  data: unknown;
  maxDepth?: number;
  className?: string;
}

export default function JsonViewer({ data, maxDepth = 4, className }: JsonViewerProps) {
  return (
    <div className={cn("rounded-lg bg-surface p-3 font-mono text-xs", className)}>
      <JsonNode data={data} depth={0} maxDepth={maxDepth} name="" isLast />
    </div>
  );
}

function JsonNode({
  data,
  depth,
  maxDepth,
  name,
  isLast,
}: {
  data: unknown;
  depth: number;
  maxDepth: number;
  name: string;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(depth >= maxDepth);

  if (data === null) return <PrimitiveValue name={name} value="null" color="text-violet" isLast={isLast} />;
  if (data === undefined) return <PrimitiveValue name={name} value="undefined" color="text-muted-foreground" isLast={isLast} />;

  if (typeof data === "boolean")
    return <PrimitiveValue name={name} value={String(data)} color="text-brand" isLast={isLast} />;
  if (typeof data === "number")
    return <PrimitiveValue name={name} value={String(data)} color="text-amber" isLast={isLast} />;
  if (typeof data === "string")
    return <PrimitiveValue name={name} value={`"${data.length > 80 ? data.slice(0, 80) + "…" : data}"`} color="text-emerald-400" isLast={isLast} />;

  const isObject = typeof data === "object" && !Array.isArray(data);
  const entries: [string, unknown][] = isObject
    ? Object.entries(data as Record<string, unknown>)
    : (data as unknown[]).map((v, i) => [String(i), v]);
  const bracket = isObject ? ["{", "}"] : ["[", "]"];

  if (collapsed) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={() => setCollapsed(false)} className="text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-3 w-3" />
        </button>
        {name && <span className="text-brand">{name}</span>}
        {name && <span className="text-muted-foreground">: </span>}
        <span className="text-muted-foreground">{bracket[0]}</span>
        <span className="text-muted-foreground/60">{entries.length} items</span>
        <span className="text-muted-foreground">{bracket[1]}</span>
        {!isLast && <span className="text-muted-foreground">,</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-3 w-3" />
        </button>
        {name && <span className="text-brand">{name}</span>}
        {name && <span className="text-muted-foreground">: </span>}
        <span className="text-muted-foreground">{bracket[0]}</span>
      </div>
      <div className="ml-4">
        {entries.map(([key, value], i) => (
          <JsonNode
            key={key}
            data={value as Record<string, unknown>}
            depth={depth + 1}
            maxDepth={maxDepth}
            name={isObject ? key : ""}
            isLast={i === entries.length - 1}
          />
        ))}
      </div>
      <div className="text-muted-foreground">
        {bracket[1]}
        {!isLast && ","}
      </div>
    </div>
  );
}

function PrimitiveValue({
  name,
  value,
  color,
  isLast,
}: {
  name: string;
  value: string;
  color: string;
  isLast: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {name && <span className="text-brand">{name}</span>}
      {name && <span className="text-muted-foreground">: </span>}
      <span className={color}>{value}</span>
      {!isLast && <span className="text-muted-foreground">,</span>}
    </div>
  );
}

// ── 独立的可复制 JSON 块 ──

export function JsonBlock({ data, className }: { data: unknown; className?: string }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn("relative rounded-lg bg-surface p-3", className)}>
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
        title="复制"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="max-h-64 overflow-auto font-mono text-xs text-foreground/80 pr-8">
        {json}
      </pre>
    </div>
  );
}
