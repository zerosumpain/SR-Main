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
}

export interface PlanningResult {
  proposal: string;
  critique: string;
  revision: string;
  finalWorkflow: GeneratedWorkflow;
  tokensUsed: number;
}

export interface OrchestratorConfig {
  temperature?: number;
  maxTokens?: number;
}
