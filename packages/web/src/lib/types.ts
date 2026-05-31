/** AgentFlow 前端类型定义 — 手动维护（与后端 schema 同步） */

// ── 通用 ──

export interface APIResponse<T> {
  success: boolean;
  data: T | null;
  message: string;
  errors?: { [key: string]: string }[] | null;
}

// ── DAG ──

export interface NodeInstance {
  id: string;
  definition_id: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  hooks: Record<string, unknown>[];
}

export interface EdgeDef {
  source_id: string;
  target_id: string;
  condition?: string | null;
  data_mapping?: Record<string, unknown> | null;
}

export interface DAGDefinition {
  nodes: NodeInstance[];
  edges: EdgeDef[];
}

// ── Workflow ──

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  dag?: DAGDefinition | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowCreate {
  name: string;
  description?: string | null;
  category?: string | null;
  dag?: DAGDefinition | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
}

export interface WorkflowUpdate {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  dag?: DAGDefinition | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  status?: string | null;
}

// ── Task ──

export interface Task {
  id: string;
  user_id: string;
  title: string;
  intent?: string | null;
  matched_workflow_id?: string | null;
  status: string;
  execution_mode: string;
  context?: Record<string, unknown> | null;
  input_data?: Record<string, unknown> | null;
  output_data?: Record<string, unknown> | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCreate {
  title: string;
  input_data?: Record<string, unknown> | null;
  workflow_id?: string | null;
  execution_mode?: string | null;
  dag?: DAGDefinition | null;
}

export interface Step {
  id: string;
  task_id: string;
  node_id: string;
  node_definition_id?: string | null;
  status: string;
  snapshot_id?: string | null;
  input_data?: Record<string, unknown> | null;
  output_data?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  retry_count: number;
  round_count: number;
  approval_count: number;
  debug_info?: Record<string, unknown> | null;
  started_at?: string | null;
  completed_at?: string | null;
}

// ── Approval ──

export interface Approval {
  id: string;
  task_id: string;
  step_id?: string | null;
  user_id: string;
  source: string; // agent | workflow
  urgency: string;
  type: string;
  title: string;
  description?: string | null;
  options?: Record<string, unknown>[] | null;
  input_schema?: Record<string, unknown> | null;
  context_data?: Record<string, unknown> | null;
  validation_result?: Record<string, unknown> | null;
  status: string; // pending | approved | rejected
  result?: Record<string, unknown> | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface ApprovalResolve {
  status: "approved" | "rejected";
  result?: Record<string, unknown> | null;
}

// ── SSE Event ──

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
  source?: string;
  task_id?: string | null;
}

// ── Match ──

export interface MatchRequest {
  user_input: string;
}

export interface MatchResult {
  mode: "matched" | "dynamic_assembly" | "bare_agent";
  workflow_id?: string | null;
  workflow_name?: string | null;
  confidence?: number | null;
  dag?: DAGDefinition | null;
  reasoning?: string | null;
}

// ── Describe (自然语言创建) ──

export interface NodeDefResponse {
  id: string;
  author_id: string;
  name: string;
  display_name: string;
  description?: string | null;
  category?: string | null;
  adapter_type: string;
  config_schema?: Record<string, unknown> | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  default_config?: Record<string, unknown> | null;
  skill_md?: string | null;
  version: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DescribeNodeRequest {
  user_input: string;
}

export interface DescribeNodeResponse {
  skill_md: string;
  suggested: Record<string, string>;
}

export interface ConfirmNodeRequest {
  skill_md: string;
  overrides?: Record<string, string> | null;
}

export interface DescribeWorkflowRequest {
  user_input: string;
}

export interface DescribeWorkflowResponse {
  name: string;
  display_name: string;
  description?: string | null;
  category?: string | null;
  dag: DAGDefinition;
}

export interface ConfirmWorkflowRequest {
  name: string;
  description?: string | null;
  category?: string | null;
  dag?: DAGDefinition | null;
}
