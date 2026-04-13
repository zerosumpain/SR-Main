export interface Position {
  x: number;
  y: number;
}

export interface PortDefinition {
  name: string;
  type: 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array';
  label?: string;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

export interface BasicConfigField {
  key: string;
  label: string;
  type: 'dropdown' | 'toggle' | 'slider' | 'text' | 'textarea' | 'template-textarea' | 'number' | 'code';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  description?: string;
  /** If true, this field is only shown in Advanced mode */
  advancedOnly?: boolean;
}

export interface NodeDefinition {
  type: string;
  label: string;
  category: 'trigger' | 'core' | 'integration' | 'control' | 'custom' | 'agentic';
  description: string;
  configSchema: JsonSchema;
  defaultConfig: Record<string, unknown>;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  /** Basic-mode form fields. If absent, node only has Advanced (raw config) mode. */
  basicConfig?: BasicConfigField[];
  /** Rich description for the LLM orchestrator — when/why to use this node */
  llmDescription?: string;
  /** Example configs for the orchestrator */
  llmExamples?: Record<string, unknown>[];
}

export interface NodeResult {
  output: Record<string, unknown>;
  logs?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  runId: string;
  workflowId: string;
  workspaceDir: string;
  emit: (event: WorkflowEvent) => void;
  getNodeOutput: (nodeId: string) => Record<string, unknown> | undefined;
  checkBreakpoint: () => Promise<void>;
  abortSignal: AbortSignal;
}

export interface NodeExecutor {
  type: string;
  execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult>;
  getInputSchema(config: Record<string, unknown>): JsonSchema;
  getOutputSchema(config: Record<string, unknown>): JsonSchema;
}

export type WorkflowEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_paused'
  | 'node_skipped'
  | 'breakpoint_hit'
  | 'log';

export interface WorkflowEvent {
  type: WorkflowEventType;
  runId: string;
  nodeId?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type NodeExecutionStatus = 'pending' | 'running' | 'paused_breakpoint' | 'completed' | 'failed' | 'skipped';

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
}

export interface WorkflowNodeDef {
  id: string;
  type: string;
  position: Position;
  config: Record<string, unknown>;
  label: string;
}

export interface WorkflowEdgeDef {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
