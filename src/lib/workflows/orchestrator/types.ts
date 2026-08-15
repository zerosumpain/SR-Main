import type { WorkflowNodeDef, WorkflowEdgeDef } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    workflowGenerated?: boolean;
    planningRound?: number;
    error?: string;
  };
  createdAt: string;
}

export interface GeneratedWorkflow {
  name: string;
  description?: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  explanation: string;
  warnings?: string[];
  trigger?: { type: string; config?: Record<string, unknown> };
}

export interface OrchestratorConfig {
  temperature?: number;
  maxTokens?: number;
}

export interface ThinkingStep {
  type: 'search' | 'use_node' | 'create_node' | 'connect' | 'ask_user' | 'finalize' | 'set_trigger';
  summary: string;
  detail?: string;
  nodeId?: string;
  timestamp: number;
}

export interface NodeReasoning {
  reason: string;
  alternatives: Array<{ nodeType: string; whyRejected: string }>;
  searchQuery?: string;
  isNewNode?: boolean;
}

export interface CritiqueIssue {
  severity: 'MISSING' | 'MISMATCH' | 'UNNECESSARY' | 'INCOMPLETE';
  nodeId?: string;
  message: string;
}

export interface RevisionDelta {
  action: 'added' | 'removed' | 'modified' | 'rewired';
  nodeId?: string;
  description: string;
}

export interface OrchestratorThinking {
  steps: ThinkingStep[];
  nodeReasoning: Record<string, NodeReasoning>;
  debate: {
    proposal: { nodeCount: number; edgeCount: number; newNodes: string[] };
    issues: CritiqueIssue[];
    revisions: RevisionDelta[];
  };
}

export interface WorkflowDraft {
  nodes: Map<string, {
    id: string;
    type: string;
    config: Record<string, unknown>;
    label: string;
    reason: string;
    alternatives: Array<{ nodeType: string; whyRejected: string }>;
    searchQuery?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  newNodeTypes: Array<{
    type: string;
    label: string;
    category: string;
    description: string;
    configSchema: Record<string, unknown>;
    defaultConfig: Record<string, unknown>;
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
    executorCode: string;
    testConfig?: Record<string, unknown>;
    reason: string;
  }>;
  searchLog: Array<{ query: string; results: string[]; timestamp: number }>;
  decisions: ThinkingStep[];
  trigger?: { type: string; config?: Record<string, unknown> };
}
