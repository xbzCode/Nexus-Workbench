/** DAG 编辑器 — React Flow 可编辑 + 只读双模式 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type NodeMouseHandler,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { APIResponse, DAGDefinition, NodeDefResponse, NodeInstance, EdgeDef } from "@/lib/types";
import { DagNodeComponent } from "@/components/workflow/DagNode";
import type { DagNodeData } from "@/components/workflow/DagNode";
import { DagEdgeComponent } from "@/components/workflow/DagEdge";
import { NodeConfigPanel } from "@/components/workflow/NodeConfigPanel";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, X, Loader2, Search, Package } from "lucide-react";

const nodeTypes: NodeTypes = {
  dagNode: DagNodeComponent,
};

const edgeTypes: EdgeTypes = {
  dagEdge: DagEdgeComponent,
};

// ── 节点选择面板 ──

interface NodePickerPanelProps {
  onAdd: (nodeDef: NodeDefResponse) => void;
  onClose: () => void;
  existingIds: string[];
}

function NodePickerPanel({ onAdd, onClose, existingIds }: NodePickerPanelProps) {
  const [nodes, setNodes] = useState<NodeDefResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get<APIResponse<NodeDefResponse[]>>("/nodes")
      .then((res) => setNodes(res.data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return nodes.filter(
      (n) =>
        !existingIds.includes(n.id) &&
        (n.name.toLowerCase().includes(q) ||
          n.display_name.toLowerCase().includes(q) ||
          (n.category ?? "").toLowerCase().includes(q))
    );
  }, [nodes, search, existingIds]);

  const grouped = useMemo(() => {
    const map = new Map<string, NodeDefResponse[]>();
    for (const n of filtered) {
      const cat = n.category || "其他";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(n);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">添加节点</h3>
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-surface-hover text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点…"
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-center text-sm text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Package className="mb-2 h-8 w-8 opacity-40" />
            <p className="text-xs">{nodes.length === 0 ? "暂无可用节点" : "无匹配节点"}</p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([cat, items]) => (
            <div key={cat}>
              <div className="sticky top-0 bg-card/90 backdrop-blur-sm px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              {items.map((node) => (
                <button
                  key={node.id}
                  onClick={() => onAdd(node)}
                  className="w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {node.display_name || node.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {node.description || node.name}
                    </div>
                    <div className="mt-0.5 text-[10px] font-mono text-muted-foreground/60">
                      {node.adapter_type}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── DAG Editor ──

interface DagEditorProps {
  dag: DAGDefinition | null | undefined;
  nodeStatuses?: Record<string, string>;
  editable?: boolean;
  onChange?: (dag: DAGDefinition) => void;
  className?: string;
}

export default function DagEditor({
  dag,
  nodeStatuses,
  editable = false,
  onChange,
  className = "",
}: DagEditorProps) {
  const [internalNodes, setInternalNodes] = useState<Node[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showNodePicker, setShowNodePicker] = useState(false);

  // 从 DAG prop 初始化 nodes
  const initialNodes: Node[] = useMemo(() => {
    if (!dag?.nodes) return [];
    return dag.nodes.map((n) => ({
      id: n.id,
      type: "dagNode",
      position: n.position ?? { x: 0, y: 0 },
      data: {
        label: n.id,
        definition_id: n.definition_id,
        status: nodeStatuses?.[n.id],
        config: n.config,
        onConfigClick: editable
          ? (nodeId: string) => setSelectedNodeId(nodeId)
          : undefined,
      } satisfies DagNodeData,
    }));
  }, [dag, nodeStatuses, editable]);

  const edges: Edge[] = useMemo(() => {
    if (!dag?.edges) return [];
    return dag.edges.map((e, i) => ({
      id: `e-${i}`,
      type: "dagEdge",
      source: e.source_id,
      target: e.target_id,
      data: {
        condition: e.condition,
      },
      animated: true,
    }));
  }, [dag]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !dag?.nodes) return null;
    return dag.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, dag]);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    setTimeout(() => instance.fitView(), 50);
  }, []);

  // 编辑模式：节点拖拽
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (!editable || !onChange || !dag) return;
      const updated = applyNodeChanges(changes, internalNodes.length > 0 ? internalNodes : initialNodes);
      setInternalNodes(updated);

      const hasPositionChange = changes.some(
        (c) => c.type === "position" && c.dragging === false
      );
      if (hasPositionChange) {
        const newNodes: NodeInstance[] = updated.map((n) => ({
          id: n.id,
          definition_id: (n.data as DagNodeData)?.definition_id ?? n.id,
          position: n.position,
          config:
            ((n.data as DagNodeData)?.config as Record<string, unknown>) ?? {},
          hooks: [],
        }));
        onChange({ nodes: newNodes, edges: dag.edges });
      }
    },
    [editable, onChange, dag, initialNodes, internalNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      if (!editable || !onChange || !dag) return;
      const updated = applyEdgeChanges(changes, edges);

      const hasRemove = changes.some((c) => c.type === "remove");
      if (hasRemove) {
        const newEdges: EdgeDef[] = updated.map((e) => ({
          source_id: e.source,
          target_id: e.target,
          condition: (e.data as { condition?: string })?.condition ?? null,
        }));
        onChange({ nodes: dag.nodes, edges: newEdges });
      }
    },
    [editable, onChange, dag, edges]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!editable || !onChange || !dag) return;
      const newEdges: EdgeDef[] = [
        ...dag.edges,
        { source_id: connection.source!, target_id: connection.target! },
      ];
      onChange({ nodes: dag.nodes, edges: newEdges });
    },
    [editable, onChange, dag]
  );

  const handleNodeConfigSave = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      if (!editable || !onChange || !dag) return;
      const newNodes = dag.nodes.map((n) =>
        n.id === nodeId ? { ...n, config } : n
      );
      onChange({ nodes: newNodes, edges: dag.edges });
      setSelectedNodeId(null);
    },
    [editable, onChange, dag]
  );

  // 添加节点
  const handleAddNode = useCallback(
    (nodeDef: NodeDefResponse) => {
      if (!editable || !onChange || !dag) return;
      // 生成唯一 id：用 name 加序号
      const base = nodeDef.name || nodeDef.display_name || nodeDef.id;
      const existingIds = new Set(dag.nodes.map((n) => n.id));
      let newId = base;
      let seq = 1;
      while (existingIds.has(newId)) {
        newId = `${base}_${seq++}`;
      }

      // 计算放置位置：在已有节点右侧偏移
      const maxX = dag.nodes.reduce((m, n) => Math.max(m, n.position?.x ?? 0), 0);
      const newNode: NodeInstance = {
        id: newId,
        definition_id: nodeDef.name || nodeDef.id,
        position: { x: maxX + 250, y: 100 },
        config: nodeDef.default_config ?? {},
        hooks: [],
      };

      onChange({ nodes: [...dag.nodes, newNode], edges: dag.edges });
      setShowNodePicker(false);
    },
    [editable, onChange, dag]
  );

  // 删除选中节点
  const handleDeleteNode = useCallback(() => {
    if (!editable || !onChange || !dag || !selectedNodeId) return;
    const newNodes = dag.nodes.filter((n) => n.id !== selectedNodeId);
    const newEdges = dag.edges.filter(
      (e) => e.source_id !== selectedNodeId && e.target_id !== selectedNodeId
    );
    onChange({ nodes: newNodes, edges: newEdges });
    setSelectedNodeId(null);
  }, [editable, onChange, dag, selectedNodeId]);

  // 点击画布空白处取消选中
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // 点击节点选中
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  // 使用内部节点（编辑模式拖拽后）或初始节点
  const displayNodes =
    editable && internalNodes.length > 0 ? internalNodes : initialNodes;

  // 空状态（编辑模式下也要展示，方便添加节点）
  if (!dag || dag.nodes.length === 0) {
    if (!editable) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          暂无 DAG 定义
        </div>
      );
    }
    // 编辑模式空状态：显示添加按钮
    return (
      <div className={cn("flex h-full w-full", className)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Package className="h-10 w-10 opacity-30" />
          <p className="text-sm">暂无节点，添加第一个节点开始构建工作流</p>
          <Button size="sm" onClick={() => setShowNodePicker(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            添加节点
          </Button>
        </div>
        {showNodePicker && (
          <NodePickerPanel
            onAdd={handleAddNode}
            onClose={() => setShowNodePicker(false)}
            existingIds={[]}
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full", className)}>
      <div className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={onInit}
          fitView
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable={editable}
          onNodesChange={editable ? onNodesChange : undefined}
          onEdgesChange={editable ? onEdgesChange : undefined}
          onConnect={editable ? onConnect : undefined}
          onPaneClick={editable ? onPaneClick : undefined}
          onNodeClick={editable ? onNodeClick : undefined}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-border)" gap={20} size={1} />
          <Controls className="!rounded-xl !border-border !bg-card !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-hover" />
          {editable && (
            <MiniMap
              className="!rounded-xl !border-border !bg-card"
              nodeColor="var(--color-brand)"
              maskColor="var(--color-foreground)"
              style={{ opacity: 0.7 }}
            />
          )}
        </ReactFlow>

        {/* 编辑模式工具栏 */}
        {editable && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-lg bg-card/90 backdrop-blur-sm shadow-sm"
              onClick={() => setShowNodePicker(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              添加节点
            </Button>
            {selectedNodeId && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-lg bg-card/90 backdrop-blur-sm shadow-sm text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDeleteNode}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除节点
              </Button>
            )}
          </div>
        )}
      </div>

      {/* NodePickerPanel — 编辑模式下点击"添加节点"按钮弹出 */}
      {editable && showNodePicker && (
        <NodePickerPanel
          onAdd={handleAddNode}
          onClose={() => setShowNodePicker(false)}
          existingIds={dag?.nodes?.map((n) => n.id) ?? []}
        />
      )}

      {/* NodeConfigPanel — 编辑模式下点击节点配置按钮弹出 */}
      {editable && selectedNode && !showNodePicker && (
        <NodeConfigPanel
          node={selectedNode}
          onSave={handleNodeConfigSave}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

// ── 工具函数：从 React Flow nodes/edges 导出 DAG ──

export function flowToDag(nodes: Node[], edges: Edge[]): DAGDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      definition_id: (n.data as DagNodeData)?.definition_id ?? n.id,
      position: n.position,
      config: ((n.data as DagNodeData)?.config as Record<string, unknown>) ?? {},
      hooks: [],
    })),
    edges: edges.map((e) => ({
      source_id: e.source,
      target_id: e.target,
    })),
  };
}
