/**
 * The workflow shapes Main's SR-Workflows clients send and receive.
 *
 * SR-Workflows owns the full type model (node definitions, executors, events,
 * healing). Main keeps only what crosses its runtime contract: graph
 * definitions it starts or generates, run statuses, heal records in a run
 * result and the node catalogue it displays.
 */

export interface Position {
  x: number;
  y: number;
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
}

export interface WorkflowEdgeDef {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export type RunStatus = 'pending' | 'running' | 'paused' | 'awaiting_human' | 'completed' | 'completed_with_errors' | 'failed';

/** One self-healing attempt, as a run result reports it. */
export interface UndoEntry {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number;
  timestamp: string;
  originalConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  fixDescription: string;
  nodeLabel?: string;
  nodeType?: string;
  retrySucceeded?: boolean;
  rewireChanges?: {
    addedEdges: WorkflowEdgeDef[];
    removedEdgeIds: string[];
    addedNodes: WorkflowNodeDef[];
  };
}

/** A pinned node output for a test run: replayed instead of executing the node. */
export interface PinnedOutput {
  output: Record<string, unknown>;
  /** The branch it took (conditional, switch, approval), replayed with the output. */
  handle?: string | null;
}

export interface PortDefinition {
  name: string;
  type: 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array';
  label?: string;
}

/**
 * One visible node type from SR-Workflows' registry (`node_catalogue` runtime
 * operation), for the admin tools page. Hidden and retired types are omitted.
 */
export interface NodeCatalogueEntry {
  type: string;
  label: string;
  category: string;
  description: string;
  llmDescription?: string | null;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  configSchema: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
}
