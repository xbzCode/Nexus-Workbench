/** 节点配置面板 — 侧边栏：基本字段 + JSON 编辑器
 * 隐藏 Position/Hooks 等技术细节，面向用户友好
 */

"use client";

import { useMemo, useState } from "react";
import { X, Save, Code } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeInstance } from "@/lib/types";

interface NodeConfigPanelProps {
  node: NodeInstance | null;
  displayName?: string;
  configSchema?: Record<string, unknown> | null;
  onSave: (nodeId: string, config: Record<string, unknown>) => void;
  onClose: () => void;
  className?: string;
}

export function NodeConfigPanel({
  node,
  displayName,
  configSchema,
  onSave,
  onClose,
  className,
}: NodeConfigPanelProps) {
  const [showJson, setShowJson] = useState(false);
  const [configJson, setConfigJson] = useState(() => {
    if (!node?.config) return "{}";
    try {
      return JSON.stringify(node.config, null, 2);
    } catch {
      return "{}";
    }
  });
  const [error, setError] = useState<string | null>(null);

  if (!node) return null;

  // 从 config_schema 提取字段定义
  const schemaFields = useMemo(() => {
    if (!configSchema || typeof configSchema !== "object") return [];
    const props = (configSchema as Record<string, unknown>).properties as
      | Record<string, { title?: string; type?: string; description?: string; default?: unknown; enum?: string[] }>
      | undefined;
    if (!props) return [];
    return Object.entries(props).map(([key, val]) => ({
      key,
      title: val.title ?? key,
      type: val.type ?? "string",
      description: val.description ?? "",
      defaultValue: val.default,
      enumValues: val.enum,
    }));
  }, [configSchema]);

  const hasFormFields = schemaFields.length > 0;

  // 构建表单值的临时 state（从 node.config 中读取当前值）
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    if (!node.config || !hasFormFields) return {};
    const vals: Record<string, string> = {};
    for (const f of schemaFields) {
      vals[f.key] = String(node.config[f.key] ?? f.defaultValue ?? "");
    }
    return vals;
  });

  const handleFormChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    try {
      let parsed: Record<string, unknown>;
      if (hasFormFields && !showJson) {
        // 从表单构建，按类型转换
        parsed = {};
        for (const f of schemaFields) {
          const raw = formValues[f.key];
          if (f.type === "boolean") {
            parsed[f.key] = raw === "true";
          } else if (f.type === "number" || f.type === "integer") {
            parsed[f.key] = Number(raw) || 0;
          } else {
            parsed[f.key] = raw;
          }
        }
      } else {
        // 从 JSON 解析
        parsed = JSON.parse(configJson);
      }
      setError(null);
      onSave(node.id, parsed);
    } catch {
      setError("JSON 格式错误");
    }
  };

  return (
    <div
      className={cn(
        "w-72 border-l border-border bg-card flex flex-col h-full",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate">
            {displayName || node.id}
          </h3>
          <p className="text-xs text-muted-foreground truncate">{node.definition_id}</p>
        </div>
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-surface-hover text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-4 overflow-auto">
        {/* 表单模式 vs JSON 切换 */}
        {hasFormFields && !showJson ? (
          // 表单模式
          <div className="space-y-3">
            {schemaFields.map((field) => (
              <div key={field.key}>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  {field.title}
                </label>
                {field.description && (
                  <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
                )}
                {field.type === "boolean" ? (
                  <select
                    value={formValues[field.key] ?? "false"}
                    onChange={(e) => handleFormChange(field.key, e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : field.enumValues && field.enumValues.length > 0 ? (
                  <select
                    value={formValues[field.key] ?? ""}
                    onChange={(e) => handleFormChange(field.key, e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="">请选择</option>
                    {field.enumValues.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={formValues[field.key] ?? ""}
                    onChange={(e) => handleFormChange(field.key, e.target.value)}
                    placeholder={field.title}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
                  />
                )}
              </div>
            ))}
            {/* 切换到 JSON */}
            <button
              onClick={() => setShowJson(true)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              <Code className="h-3 w-3" />
              切换到 JSON 编辑器
            </button>
          </div>
        ) : (
          // JSON 编辑模式
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                节点配置 (JSON)
              </label>
              {hasFormFields && showJson && (
                <button
                  onClick={() => setShowJson(false)}
                  className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
                >
                  返回表单
                </button>
              )}
            </div>
            <textarea
              value={configJson}
              onChange={(e) => {
                setConfigJson(e.target.value);
                setError(null);
              }}
              className={cn(
                "w-full h-48 rounded-lg border bg-slate-900/50 p-3 text-xs font-mono text-slate-300 resize-none focus:outline-none focus:ring-1",
                error
                  ? "border-red-500/50 focus:ring-red-500"
                  : "border-border focus:ring-brand"
              )}
              spellCheck={false}
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 transition-opacity"
        >
          <Save className="h-3.5 w-3.5" />
          保存配置
        </button>
      </div>
    </div>
  );
}
