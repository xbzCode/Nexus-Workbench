/** DAG 编辑器 — React Flow 受控模式 + 性能优化
 *
 * 核心改进：
 * - 使用 React Flow 受控模式 (applyNodeChanges/applyEdgeChanges)
 * - 拖拽中只更新 RF 内部状态，dragEnd 才同步回 dag prop
 * - memo 包裹节点/边组件，避免不必要的重渲染
 * - Delete 键快捷删除 + 节点上删除按钮
 * - 左侧面板可折叠
 * - 去掉不必要的 MiniMap / animated
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type NodeMouseHandler,
  type ReactFlowInstance,
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
import {
  Trash2, Loader2, Search, Package, LayoutGrid, Undo2, Redo2,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import dagre from "@dagrejs/dagre";

const nodeTypes: NodeTypes = { dagNode: DagNodeComponent };
const edgeTypes: EdgeTypes = { dagEdge: DagEdgeComponent };

const MAX_HISTORY = 50;

// ── 自动布局 ──
function layoutDag(dag: DAGDefinition): DAGDefinition {
  if (dag.nodes.length === 0) return dag;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 150 });
  for (const n of dag.nodes) g.setNode(n.id, { width: 180, height: 60 });
  for (const e of dag.edges) g.setEdge(e.source_id, e.target_id);
  dagre.layout(g);
  return {
    ...dag,
    nodes: dag.nodes.map((n) => {
      const pos = g.node(n.id);
      return { ...n, position: { x: pos.x - 90, y: pos.y - 30 } };
    }),
  };
}

// ── 节点类型图标 ──
interface NodeVisual {
  icon: string;
  color: string;
}

const NODE_VISUAL_MAP: Record<string, NodeVisual> = {
  "architecture-diagram": { icon: "🏗️", color: "#22d3ee" },
  "refine-requirements": { icon: "📋", color: "#a78bfa" },
};

function getNodeVisual(name: string): NodeVisual {
  return NODE_VISUAL_MAP[name] ?? { icon: "⚙️", color: "#94a3b8" };
}

// ── DAG → React Flow Nodes 转换 ──
function dagToRfNodes(
  dag: DAGDefinition,
  defMap: Map<string, NodeDefResponse>,
  editable: boolean,
  onConfigClick: (nodeId: string) => void,
  onDeleteClick: (nodeId: string) => void,
  nodeStatuses?: Record<string, string>,
): Node[] {
  if (!dag.nodes) return [];
  return dag.nodes.map((n) => {
    const def = defMap.get(n.definition_id);
    const visual = def ? getNodeVisual(def.name) : getNodeVisual("");
    return {
      id: n.id,
      type: "dagNode",
      position: n.position ?? { x: 0, y: 0 },
      data: {
        label: n.id,
        definition_id: n.definition_id,
        displayName: def?.display_name ?? def?.name ?? n.id,
        icon: visual.icon,
        accentColor: visual.color,
        status: nodeStatuses?.[n.id],
        config: n.config,
        onConfigClick: editable ? onConfigClick : undefined,
        onDeleteClick: editable ? onDeleteClick : undefined,
      } satisfies DagNodeData,
    };
  });
}

function dagToRfEdges(dag: DAGDefinition): Edge[] {
  if (!dag.edges) return [];
  return dag.edges.map((e, i) => ({
    id: `e-${i}`,
    type: "dagEdge",
    source: e.source_id,
    target: e.target_id,
    data: { condition: e.condition },
  }));
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDefs, setNodeDefs] = useState<NodeDefResponse[]>([]);
  const [search, setSearch] = useState("");
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // React Flow 受控节点/边状态
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  // 拖拽中的位置暂存（仅 dragEnd 时同步回 dag）
  const pendingPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // 撤销/重做历史
  const historyRef = useRef<DAGDefinition[]>([{ nodes: [], edges: [] }]);
  const historyIdxRef = useRef(0);

  // 稳定引用：删除节点函数（避免 useEffect 闭包问题）
  const onDeleteNodeRef = useRef<(nodeId: string) => void>(() => {});


  // 节点定义 ID → 详情映射
  const defMap = useMemo(() => {
    const map = new Map<string, NodeDefResponse>();
    for (const d of nodeDefs) map.set(d.id, d);
    return map;
  }, [nodeDefs]);

  // 已添加节点 ID 集合
  const existingNodeIds = useMemo(() => {
    const effectiveDag = dag ?? { nodes: [], edges: [] };
    return new Set(effectiveDag.nodes.map((n) => n.id));
  }, [dag]);

  // 过滤后的可用节点（排除已添加的）
  const filteredNodeDefs = useMemo(() => {
    const q = search.toLowerCase();
    return nodeDefs.filter(
      (n) =>
        !existingNodeIds.has(n.id) &&
        (n.name.toLowerCase().includes(q) ||
          n.display_name.toLowerCase().includes(q) ||
          (n.category ?? "").toLowerCase().includes(q))
    );
  }, [nodeDefs, search, existingNodeIds]);

  // 加载节点定义
  useEffect(() => {
    if (!editable) return;
    api
      .get<APIResponse<NodeDefResponse[]>>("/nodes")
      .then((res) => setNodeDefs(res.data ?? []))
      .catch(() => {});
  }, [editable]);

  // dag prop 变化时同步到 RF 状态
  useEffect(() => {
    const effectiveDag = dag ?? { nodes: [], edges: [] };
    const onConfig = (nodeId: string) => setSelectedNodeId(nodeId);
    const onDelete = (nodeId: string) => onDeleteNodeRef.current(nodeId);
    setRfNodes(dagToRfNodes(effectiveDag, defMap, editable, onConfig, onDelete, nodeStatuses));
    setRfEdges(dagToRfEdges(effectiveDag));
  }, [dag, nodeStatuses, editable, defMap]);

  // 当前选中的 DAG 节点
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !dag?.nodes) return null;
    return dag.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, dag]);

  // ── 历史管理 ──

  const pushHistory = useCallback((newDag: DAGDefinition) => {
    historyIdxRef.current += 1;
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current);
    historyRef.current.push(newDag);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
      historyIdxRef.current -= 1;
    }
  }, []);

  const safeOnChange = useCallback(
    (newDag: DAGDefinition) => {
      if (!editable || !onChange) return;
      pushHistory(newDag);
      onChange(newDag);
    },
    [editable, onChange, pushHistory]
  );

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  const handleUndo = useCallback(() => {
    if (!onChange || !canUndo) return;
    historyIdxRef.current -= 1;
    onChange(historyRef.current[historyIdxRef.current]);
  }, [onChange, canUndo]);

  const handleRedo = useCallback(() => {
    if (!onChange || !canRedo) return;
    historyIdxRef.current += 1;
    onChange(historyRef.current[historyIdxRef.current]);
  }, [onChange, canRedo]);

  // ── 删除节点（可被按钮和键盘共用）──
  const handleDeleteNodeById = useCallback(
    (nodeId: string) => {
      if (!editable || !onChange || !dag) return;
      safeOnChange({
        nodes: dag.nodes.filter((n) => n.id !== nodeId),
        edges: dag.edges.filter((e) => e.source_id !== nodeId && e.target_id !== nodeId),
      });
      setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
    },
    [editable, onChange, dag, safeOnChange]
  );

  // 保持 ref 同步
  onDeleteNodeRef.current = handleDeleteNodeById;

  // ── 键盘快捷键 ──
  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 撤销/重做
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      // Delete/Backspace 删除选中节点（不在 input/textarea 中时）
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        handleDeleteNodeById(selectedNodeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, handleUndo, handleRedo, selectedNodeId, handleDeleteNodeById]);

  // ── React Flow 事件（受控模式）──

  const onInit = useCallback((instance: ReactFlowInstance) => {
    setReactFlowInstance(instance);
    setTimeout(() => instance.fitView(), 50);
  }, []);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // 应用 changes 到 RF 内部状态（保证选中、尺寸、拖拽位置等正确更新）
      setRfNodes((nds) => applyNodeChanges(changes, nds));

      // 处理拖拽位置暂存
      const positionChanges = changes.filter(
        (c) => c.type === "position" && c.position
      );
      if (positionChanges.length > 0) {
        for (const c of positionChanges) {
          if (c.id && c.position) {
            pendingPositionsRef.current[c.id] = c.position;
          }
        }

        // 拖拽结束时同步回 dag
        const hasDragEnd = positionChanges.some((c) => c.dragging === false);
        if (hasDragEnd && editable && onChange && dag) {
          const newNodes: NodeInstance[] = dag.nodes.map((n) => ({
            ...n,
            position: pendingPositionsRef.current[n.id] ?? n.position,
          }));
          safeOnChange({ nodes: newNodes, edges: dag.edges });
          pendingPositionsRef.current = {};
        }
      }
    },
    [editable, onChange, dag, safeOnChange]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setRfEdges((eds) => applyEdgeChanges(changes, eds));

      if (!editable || !onChange || !dag) return;
      const removedIds = new Set(
        changes.filter((c) => c.type === "remove").map((c) => c.id)
      );
      if (removedIds.size > 0) {
        const newEdges = dag.edges.filter((_, i) => !removedIds.has(`e-${i}`));
        safeOnChange({ nodes: dag.nodes, edges: newEdges });
      }
    },
    [editable, onChange, dag, safeOnChange]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!editable || !onChange || !dag) return;
      safeOnChange({
        nodes: dag.nodes,
        edges: [...dag.edges, { source_id: connection.source!, target_id: connection.target! }],
      });
    },
    [editable, onChange, dag, safeOnChange]
  );

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_event, node) => {
      // 位置已在 onNodesChange 中同步，这里无需重复处理
    },
    []
  );

  const handleNodeConfigSave = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      if (!editable || !onChange || !dag) return;
      const newNodes = dag.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n));
      safeOnChange({ nodes: newNodes, edges: dag.edges });
      setSelectedNodeId(null);
    },
    [editable, onChange, dag, safeOnChange]
  );

  // ── 添加节点 ──
  const handleAddNode = useCallback(
    (nodeDef: NodeDefResponse, dropPosition?: { x: number; y: number }) => {
      if (!editable || !onChange) return;
      const currentDag = dag ?? { nodes: [], edges: [] };
      const base = nodeDef.name || nodeDef.display_name || nodeDef.id;
      const existingIds = new Set(currentDag.nodes.map((n) => n.id));
      let newId = base;
      let seq = 1;
      while (existingIds.has(newId)) newId = `${base}_${seq++}`;

      const maxX = currentDag.nodes.reduce((m, n) => Math.max(m, n.position?.x ?? 0), 0);
      const position = dropPosition ?? { x: maxX + 250, y: 100 };

      const newNode: NodeInstance = {
        id: newId,
        definition_id: nodeDef.id,
        position,
        config: nodeDef.default_config ?? {},
        hooks: [],
      };

      safeOnChange({ nodes: [...currentDag.nodes, newNode], edges: currentDag.edges });
    },
    [editable, onChange, dag, safeOnChange]
  );

  // ── 拖拽放置 ──
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const defId = e.dataTransfer.getData("text/plain");
      if (!defId || !reactFlowInstance) return;
      const def = defMap.get(defId);
      if (!def) return;
      const pos = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      handleAddNode(def, pos);
    },
    [reactFlowInstance, defMap, handleAddNode]
  );

  // ── 自动布局 ──
  const handleAutoLayout = useCallback(() => {
    if (!editable || !onChange || !dag) return;
    safeOnChange(layoutDag(dag));
  }, [editable, onChange, dag, safeOnChange]);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => setSelectedNodeId(node.id), []);

  // ── 渲染 ──
  const effectiveDag = dag ?? { nodes: [], edges: [] };
  const hasNodes = effectiveDag.nodes.length > 0;

  // ── 只读空状态 ──
  if (!hasNodes && !editable) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无 DAG 定义
      </div>
    );
  }

  // ── 编辑模式：左侧节点面板 + 右侧画布 ──
  if (editable) {
    return (
      <div className={cn("flex h-full w-full", className)}>
        {/* 左侧节点面板 — 可折叠 */}
        {!panelCollapsed && (
          <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
            {/* 面板标题 + 折叠按钮 */}
            <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">节点</h3>
              <button
                onClick={() => setPanelCollapsed(true)}
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-surface-hover text-muted-foreground"
                title="收起面板"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 搜索 */}
            <div className="px-3 py-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索节点…"
                  className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            {/* 可用节点列表 */}
            <div className="flex-1 overflow-y-auto">
              {nodeDefs.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
                </div>
              ) : filteredNodeDefs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Package className="mb-2 h-6 w-6 opacity-30" />
                  <p className="text-xs">{existingNodeIds.size > 0 ? "所有节点已添加" : "暂无可用节点"}</p>
                </div>
              ) : (
                filteredNodeDefs.map((def) => {
                  const visual = getNodeVisual(def.name);
                  return (
                    <button
                      key={def.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", def.id);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => handleAddNode(def)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover border-b border-border/50 last:border-0"
                    >
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm"
                        style={{ backgroundColor: visual.color + "15" }}
                      >
                        <span>{visual.icon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground truncate">
                          {def.display_name || def.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {def.description || def.name}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* 工具栏 */}
            <div className="border-t border-border px-2 py-1.5 flex items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={handleAutoLayout}
                disabled={!hasNodes}
                title="自动排列"
              >
                <LayoutGrid className="h-3.5 w-3.5 mr-1" />
                排列
              </Button>
              <div className="w-px h-4 bg-border" />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={handleUndo}
                disabled={!canUndo}
                title="撤销 (Ctrl+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={handleRedo}
                disabled={!canRedo}
                title="重做 (Ctrl+Shift+Z)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
              {selectedNodeId && (
                <>
                  <div className="w-px h-4 bg-border" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteNodeById(selectedNodeId)}
                    title="删除选中节点 (Delete)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 右侧画布区域 */}
        <div className="flex-1 relative">
          {/* 面板折叠时的展开按钮 */}
          {panelCollapsed && (
            <button
              onClick={() => setPanelCollapsed(false)}
              className="absolute top-3 left-3 z-10 h-7 w-7 flex items-center justify-center rounded-md border border-border bg-card shadow-sm hover:bg-surface-hover text-muted-foreground"
              title="展开节点面板"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
          )}

          {hasNodes ? (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={onInit}
              fitView
              nodesDraggable
              nodesConnectable
              elementsSelectable
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onPaneClick={onPaneClick}
              onNodeClick={onNodeClick}
              onNodeDragStop={onNodeDragStop}
              onDragOver={onDragOver}
              onDrop={onDrop}
              proOptions={{ hideAttribution: true }}
              deleteKeyCode={null}
            >
              <Background color="var(--color-border)" gap={20} size={1} />
              <Controls className="!rounded-xl !border-border !bg-card !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-hover" />
            </ReactFlow>
          ) : (
            /* 空画布提示 */
            <div
              className="flex h-full items-center justify-center text-sm text-muted-foreground"
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <div className="flex flex-col items-center gap-2">
                <Package className="h-8 w-8 opacity-20" />
                <p>点击左侧节点添加到画布</p>
                <p className="text-xs text-muted-foreground/60">或将节点拖拽到此处</p>
              </div>
            </div>
          )}
        </div>

        {/* NodeConfigPanel — 选中节点时右侧弹出 */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            displayName={defMap.get(selectedNode.definition_id)?.display_name}
            configSchema={defMap.get(selectedNode.definition_id)?.config_schema}
            onSave={handleNodeConfigSave}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    );
  }

  // ── 只读模式 ──
  return (
    <div className={cn("flex h-full w-full", className)}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={onInit}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-border)" gap={20} size={1} />
        <Controls className="!rounded-xl !border-border !bg-card !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-hover" />
      </ReactFlow>
    </div>
  );
}
