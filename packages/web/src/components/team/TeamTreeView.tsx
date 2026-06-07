"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeProps,
  type ReactFlowInstance,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { cn } from "@/lib/utils";
import type { Team, APIResponse, Workflow, NodeDefResponse } from "@/lib/types";
import { api } from "@/lib/api";
import {
  Workflow as WfIcon,
  Box,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ── Context for callbacks (avoids passing functions through node.data) ──

interface TeamActions {
  onEdit: (team: Team) => void;
  onDelete: (id: string, name: string) => void;
  onToggleCollapse: (teamId: string) => void;
  isCollapsed: (teamId: string) => boolean;
}

const TeamActionsContext = createContext<TeamActions | null>(null);

function useTeamActions() {
  const ctx = useContext(TeamActionsContext);
  if (!ctx) throw new Error("useTeamActions must be used within TeamActionsContext.Provider");
  return ctx;
}

// ── Types ──

interface TeamResources {
  workflows: Workflow[];
  nodes: NodeDefResponse[];
}

// ── Node data types (no functions — only serializable data) ──

interface UserNodeData {
  kind: "user";
  [key: string]: unknown;
}

interface TeamNodeData {
  kind: "team";
  teamId: string;
  team: Team;
  wfCount: number;
  ndCount: number;
  [key: string]: unknown;
}

interface ResourceNodeData {
  kind: "resource";
  resType: "workflow" | "node";
  name: string;
  subLabel: string;
  icon: string;
  [key: string]: unknown;
}

type TreeNodeData = UserNodeData | TeamNodeData | ResourceNodeData;

// ── Custom Nodes ──

function UserNodeComponent() {
  return (
    <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full bg-brand/10 border-2 border-brand/40 shadow-[0_0_20px_color-mix(in_srgb,var(--color-brand)_20%,transparent)]">
      <span className="text-2xl">🧑</span>
      <span className="text-[10px] font-semibold text-brand mt-0.5">User</span>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-brand/50" />
    </div>
  );
}

function TeamNodeComponent({ data }: { id: string; data: TeamNodeData }) {
  const { teamId, team, wfCount, ndCount } = data;
  const { onEdit, onDelete, onToggleCollapse, isCollapsed } = useTeamActions();
  const collapsed = isCollapsed(teamId);

  return (
    <div className="w-[220px] rounded-xl border bg-card/90 border-border hover:border-brand/50 hover:shadow-lg overflow-hidden">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-brand/50" />

      {/* Header */}
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1">
        <span className="text-xl leading-none mt-0.5 shrink-0">{team.icon || "👥"}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate leading-tight">{team.display_name}</div>
          <div className="text-[10px] text-muted-foreground truncate">{team.name}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 nopan nodrag">
          <button
            className="p-1 rounded hover:bg-brand/10 text-muted-foreground hover:text-brand transition-colors"
            onClick={(e) => { e.stopPropagation(); onEdit(team); }}
            title="编辑"
            type="button"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete(team.id, team.display_name); }}
            title="删除"
            type="button"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Resource badges — always visible */}
      <div className="px-3 pb-1.5 flex items-center gap-1.5 flex-wrap">
        {wfCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet/10 text-violet border border-violet/20">
            <WfIcon className="w-2.5 h-2.5" />
            {wfCount} 工作流
          </span>
        )}
        {ndCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber/10 text-amber border border-amber/20">
            <Box className="w-2.5 h-2.5" />
            {ndCount} 节点
          </span>
        )}
        {wfCount === 0 && ndCount === 0 && (
          <span className="text-[10px] text-muted-foreground italic">暂无关联资源</span>
        )}
      </div>

      {/* Collapse toggle footer */}
      <div className="border-t border-border/40 nopan nodrag">
        <button
          className="w-full flex items-center justify-center gap-1 py-1 text-[10px] text-muted-foreground hover:text-brand hover:bg-brand/5 transition-colors"
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(teamId); }}
          type="button"
        >
          {collapsed ? (
            <><ChevronRight className="w-3 h-3" /><span>展开资源</span></>
          ) : (
            <><ChevronDown className="w-3 h-3" /><span>折叠资源</span></>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-brand/50" />
    </div>
  );
}

function ResourceNodeComponent({ data }: { data: ResourceNodeData }) {
  const isWorkflow = data.resType === "workflow";
  return (
    <div
      className={cn(
        "w-[160px] h-10 flex items-center gap-1.5 px-2.5 text-xs rounded-lg border",
        isWorkflow
          ? "bg-violet/5 border-violet/30 hover:border-violet/50 hover:bg-violet/10"
          : "bg-amber/5 border-amber/30 hover:border-amber/50 hover:bg-amber/10",
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-brand/40" />
      <span className="text-sm shrink-0">{data.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{data.name}</div>
        {data.subLabel && (
          <div className="truncate text-[10px] text-muted-foreground">{data.subLabel}</div>
        )}
      </div>
    </div>
  );
}

// ── Custom Edge ──

function TeamEdgeComponent(props: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });

  return (
    <>
      {/* Background dim path */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth={2}
        strokeOpacity={0.12}
        strokeDasharray="6 4"
      />
      {/* Foreground animated path */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth={1.5}
        strokeOpacity={0.5}
        strokeDasharray="8 6"
        className="flow-line"
      />
    </>
  );
}

// ── Node type registry (must be stable outside component) ──

const nodeTypes: NodeTypes = {
  userNode: UserNodeComponent,
  teamNode: TeamNodeComponent,
  resourceNode: ResourceNodeComponent,
};

const edgeTypes = { teamEdge: TeamEdgeComponent };

// ── Dagre layout ──

function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 100 });

  for (const n of nodes) {
    const w = n.data?.kind === "user" ? 80 : n.data?.kind === "team" ? 220 : 160;
    const h = n.data?.kind === "user" ? 80 : n.data?.kind === "team" ? 100 : 40;
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    const w = n.data?.kind === "user" ? 80 : n.data?.kind === "team" ? 220 : 160;
    const h = n.data?.kind === "user" ? 80 : n.data?.kind === "team" ? 100 : 40;
    return {
      ...n,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}

// ── Main Component ──

interface TeamTreeViewProps {
  teams: Team[];
  onEditTeam: (team: Team) => void;
  onDeleteTeam: (id: string, name: string) => void;
}

export default function TeamTreeView({ teams, onEditTeam, onDeleteTeam }: TeamTreeViewProps) {
  const [teamResources, setTeamResources] = useState<Record<string, TeamResources>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node<TreeNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Load resources for all active teams
  useEffect(() => {
    for (const team of teams) {
      if (team.status !== "active" || teamResources[team.id]) continue;
      Promise.all([
        api.get<APIResponse<Workflow[]>>(`/teams/${team.id}/workflows`),
        api.get<APIResponse<NodeDefResponse[]>>(`/teams/${team.id}/nodes`),
      ])
        .then(([wfRes, nodeRes]) => {
          setTeamResources((prev) => ({
            ...prev,
            [team.id]: { workflows: wfRes.data || [], nodes: nodeRes.data || [] },
          }));
        })
        .catch(() => {
          setTeamResources((prev) => ({ ...prev, [team.id]: { workflows: [], nodes: [] } }));
        });
    }
  }, [teams, teamResources]);

  const toggleCollapse = useCallback((teamId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }, []);

  // Stable context value — callbacks don't change identity
  const teamActions = useMemo<TeamActions>(() => ({
    onEdit: onEditTeam,
    onDelete: onDeleteTeam,
    onToggleCollapse: toggleCollapse,
    isCollapsed: (id: string) => collapsed.has(id),
  }), [onEditTeam, onDeleteTeam, toggleCollapse, collapsed]);

  // Build React Flow nodes + edges from team data → store in state
  useEffect(() => {
    const activeTeams = teams.filter((t) => t.status === "active");
    const newNodes: Node<TreeNodeData>[] = [];
    const newEdges: Edge[] = [];

    // User node — preserve existing position if already placed
    const existingUser = nodes.find((n) => n.id === "user");
    newNodes.push({
      id: "user",
      type: "userNode",
      position: existingUser?.position ?? { x: 0, y: 0 },
      data: { kind: "user" },
    });

    // Team + Resource nodes
    for (const team of activeTeams) {
      const teamNodeId = `team-${team.id}`;
      const res = teamResources[team.id];
      const wfCount = res?.workflows?.length ?? 0;
      const ndCount = res?.nodes?.length ?? 0;
      const isCollapsed = collapsed.has(team.id);

      const existingTeam = nodes.find((n) => n.id === teamNodeId);
      newNodes.push({
        id: teamNodeId,
        type: "teamNode",
        position: existingTeam?.position ?? { x: 0, y: 0 },
        data: {
          kind: "team",
          teamId: team.id,
          team,
          wfCount,
          ndCount,
        },
      });

      newEdges.push({
        id: `e-user-${teamNodeId}`,
        source: "user",
        target: teamNodeId,
        type: "teamEdge",
      });

      // Resource nodes (only when expanded)
      if (!isCollapsed && res) {
        const allResources = [
          ...res.workflows.map((w) => ({
            type: "workflow" as const,
            id: w.id,
            name: w.name,
            sub: w.status,
          })),
          ...res.nodes.map((n) => ({
            type: "node" as const,
            id: n.id,
            name: n.display_name || n.name,
            sub: n.category || undefined,
          })),
        ];

        for (const r of allResources) {
          const resNodeId = `res-${r.type}-${r.id}`;
          const existingRes = nodes.find((n) => n.id === resNodeId);
          newNodes.push({
            id: resNodeId,
            type: "resourceNode",
            position: existingRes?.position ?? { x: 0, y: 0 },
            data: {
              kind: "resource",
              resType: r.type,
              name: r.name,
              subLabel: r.sub || "",
              icon: r.type === "workflow" ? "🔀" : "📦",
            },
          });

          newEdges.push({
            id: `e-${teamNodeId}-${resNodeId}`,
            source: teamNodeId,
            target: resNodeId,
            type: "teamEdge",
          });
        }
      }
    }

    // Apply dagre layout only for nodes without a saved position (new nodes)
    const needsLayout = newNodes.filter((n) => {
      const existing = nodes.find((o) => o.id === n.id);
      return !existing || (existing.position.x === 0 && existing.position.y === 0);
    });

    if (needsLayout.length > 0) {
      const laidNodes = layoutWithDagre(newNodes, newEdges);
      setNodes(laidNodes);
    } else {
      setNodes(newNodes);
    }
    setEdges(newEdges);
  }, [teams, teamResources, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle node drag — update positions in state
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // Track initial fit to avoid re-fitting on collapse/expand
  const [hasFitted, setHasFitted] = useState(false);

  // Auto-fit view only on initial load (when node count stabilizes)
  useEffect(() => {
    if (!flowInstance || hasFitted) return;
    if (nodes.length < 2) return; // wait for at least user + 1 team
    const timer = setTimeout(() => {
      flowInstance.fitView({ padding: 0.2 });
      setHasFitted(true);
    }, 100);
    return () => clearTimeout(timer);
  }, [flowInstance, nodes.length, hasFitted]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    setFlowInstance(instance);
  }, []);

  return (
    <TeamActionsContext.Provider value={teamActions}>
      <div className="rounded-xl border bg-surface/30" style={{ height: 620 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onInit={onInit}
          fitView
          nodesConnectable={false}
          elementsSelectable={false}
          selectNodesOnDrag={false}
          panOnDrag={[0]}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2.5}
          defaultEdgeOptions={{ type: "teamEdge" }}
        >
          <Background color="var(--color-border)" gap={20} size={1} />
          <Controls
            className="!rounded-xl !border-border !bg-card !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-hover"
            showInteractive={false}
          />
          <MiniMap
            className="!rounded-xl !border-border !bg-card"
            nodeColor={() => "var(--color-brand)"}
            maskColor="var(--color-foreground)"
            style={{ opacity: 0.7 }}
          />
        </ReactFlow>
      </div>
    </TeamActionsContext.Provider>
  );
}
