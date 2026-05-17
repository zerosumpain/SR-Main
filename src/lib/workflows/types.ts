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
  type:
    | 'dropdown'
    | 'toggle'
    | 'slider'
    | 'text'
    | 'textarea'
    | 'template-textarea'
    | 'number'
    | 'code'
    | 'schema-builder'
    | 'key-value-table'
    | 'chip-input'
    | 'phone';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  description?: string;
  /** If true, this field is only shown in Advanced mode */
  advancedOnly?: boolean;
  /** Render a section heading above this field (first occurrence of a label wins) */
  section?: string;
  /** Show this field only when another field's value matches. */
  visibleWhen?: {
    key: string;
    equals?: unknown;
    in?: unknown[];
    not?: unknown;
  };
  /** Language hint for `code` widget. */
  language?: 'json' | 'javascript' | 'jsonpath' | 'sql' | 'plaintext';
  /** For dropdown widgets, dynamic option resolver (resolved client-side at render time). */
  dynamicOptionsKey?: 'gemini-models' | 'scraper-profiles' | 'workflow-vars' | 'openrouter-models';
  /** Cheatsheet shown beneath a `code` widget — variables in scope, etc. */
  cheatsheet?: string[];
}

/**
 * Per-instance summary of what a configured node will do at runtime.
 * Populated either by deterministic `summarize(config)` on the NodeDefinition,
 * by the LLM workflow generator, or hand-edited. Surfaced on the canvas under
 * the node title and at the top of the config panel for trust-by-transparency.
 */
export interface NodeActionPreview {
  kind: 'http' | 'message' | 'llm' | 'db' | 'file' | 'cron' | 'scrape' | 'compute' | 'control' | 'trigger' | 'other';
  /** Compact key/value pairs displayed in a 2-column table. */
  details: Record<string, string>;
}

export interface SchemaFieldRow {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  /** Optional free-text description — surfaced as `description` in the
   *  generated JSON Schema and shown to LLM extractors as a field hint. */
  description?: string;
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
  /**
   * Deterministic per-instance summary. Given the configured values, return
   * a one-line plain-English description plus a structured preview of the
   * exact action the node will take at runtime. Used for canvas summary
   * lines and the "What this does" header on config panels.
   */
  summarize?: (config: Record<string, unknown>) => {
    line: string;
    preview: NodeActionPreview;
  };
  /**
   * Hide from orchestrator grounding and the admin /tools listing.
   * Stays registered + executable so existing canvases keep running, but
   * the LLM never sees it — used when a multi-mode legacy node has been
   * superseded by per-operation splits.
   */
  hidden?: boolean;
}

export interface NodeResult {
  output: Record<string, unknown>;
  /**
   * How many rows / records this node produced. Set explicitly by every
   * executor — defaults to 1 in the engine when omitted (e.g. legacy executors).
   * Used for status pills on nodes and labels on outgoing edges.
   */
  rowCount?: number;
  logs?: string[];
  metadata?: Record<string, unknown>;
  /** When set, the engine halts the run and waits for human input. */
  pause?: {
    reason: 'awaiting_human';
    interactionId: number;
  };
}

export interface ExecutionContext {
  runId: string;
  workflowId: string;
  workspaceDir: string;
  /** When true, side-effecting nodes must short-circuit and return a simulated output. */
  dryRun: boolean;
  emit: (event: WorkflowEvent) => void;
  getNodeOutput: (nodeId: string) => Record<string, unknown> | undefined;
  checkBreakpoint: () => Promise<void>;
  abortSignal: AbortSignal;
  /** Get outgoing edges from a node (for agent tool discovery) */
  getOutgoingEdges: (nodeId: string) => WorkflowEdgeDef[];
  /** Get incoming edges into a node (for wiring-aware behaviour). */
  getIncomingEdges: (nodeId: string) => WorkflowEdgeDef[];
  /** Get a node's type, config, and label by ID */
  getNodeConfig: (nodeId: string) => { type: string; config: Record<string, unknown>; label: string } | undefined;
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
  | 'run_completed_with_errors'
  | 'run_failed'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_paused'
  | 'node_skipped'
  | 'breakpoint_hit'
  | 'healing_started'
  | 'healing_progress'
  | 'healing_fix_applied'
  | 'healing_succeeded'
  | 'healing_failed'
  | 'healing_blocked'
  | 'interaction_pending'
  | 'interaction_resolved'
  | 'log';

export interface BaseWorkflowEvent {
  runId: string;
  timestamp: string;
}

export interface GenericWorkflowEvent extends BaseWorkflowEvent {
  type: WorkflowEventType;
  nodeId?: string;
  data?: Record<string, unknown>;
}

export interface GmailMessageReceivedEvent extends BaseWorkflowEvent {
  type: 'gmail.message.received';
  accountId: number;
  accountEmail: string;
  watchId: number;
  watchLabel: string;
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  labels: string[];
}

export interface GmailAuthExpiredEvent extends BaseWorkflowEvent {
  type: 'gmail.auth.expired';
  accountId: number;
  accountEmail: string;
  error: string;
}

export interface ScraperProgressEvent extends BaseWorkflowEvent {
  type: 'scraper.progress';
  runLogId: number;
  stage: 'nav' | 'page.done' | 'login.start' | 'login.done' | 'error';
  url?: string;
  pageIndex?: number;
  error?: string;
}

export interface ScraperRunFinishedEvent extends BaseWorkflowEvent {
  type: 'scraper.run.finished';
  runLogId: number;
  success: boolean;
  pagesLoaded: number;
  error?: string;
}

export type WorkflowEvent =
  | GenericWorkflowEvent
  | GmailMessageReceivedEvent
  | GmailAuthExpiredEvent
  | ScraperProgressEvent
  | ScraperRunFinishedEvent;

export type RunStatus = 'pending' | 'running' | 'paused' | 'awaiting_human' | 'completed' | 'completed_with_errors' | 'failed';
export type NodeExecutionStatus = 'pending' | 'running' | 'paused_breakpoint' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'healing';

export interface HealingContext {
  error: string;
  nodeType: string;
  nodeLabel: string;
  nodeConfig: Record<string, unknown>;
  inputData: Record<string, unknown>;
  nodeDefinition: NodeDefinition;
  previousAttempts: Array<{
    diagnosis: string;
    fixApplied: string;
    resultError: string;
  }>;
  workflowContext: {
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
    upstreamOutputs: Record<string, Record<string, unknown>>;
  };
}

export interface HealingDiagnosis {
  category: 'config_fix' | 'rewire_fix' | 'environment_issue' | 'unknown';
  diagnosis: string;
  reasoning: string;
  fix: {
    type: 'update_config' | 'insert_node' | 'rewire_edge' | 'none';
    changes: Record<string, unknown>;
    description: string;
  } | null;
  environmentAction?: string;
  alternative?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface UndoEntry {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number;
  timestamp: string;
  originalConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  fixDescription: string;
  rewireChanges?: {
    addedEdges: WorkflowEdgeDef[];
    removedEdgeIds: string[];
    addedNodes: WorkflowNodeDef[];
  };
}

export interface EngineOptions {
  selfHealing?: boolean;
}

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
  /** Plain-English one-liner of what this node will do at runtime. */
  actionSummary?: string;
  /** Structured preview shown above the config form. */
  actionPreview?: NodeActionPreview;
}

export interface WorkflowEdgeDef {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Display-only node types never participate in the DAG: they exist only
 * for side-panel rendering on the canvas (stats, post-it notes,
 * annotation boxes, etc.).
 */
export function isDisplayOnlyType(type: string): boolean {
  return type.startsWith('stats-') || type === 'postit' || type === 'annotation';
}
