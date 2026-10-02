import type { WorkflowNodeDef, WorkflowEdgeDef } from './types';

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
