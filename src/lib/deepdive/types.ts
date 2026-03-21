export interface SessionConfig {
  maxSources: number;
  diversityThreshold: 'low' | 'medium' | 'high';
  analysisDepth: 'shallow' | 'standard' | 'deep';
  redTeamAggression: 'gentle' | 'standard' | 'aggressive';
  maxFactsBeforePhase3: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  maxSources: 25,
  diversityThreshold: 'medium',
  analysisDepth: 'standard',
  redTeamAggression: 'standard',
  maxFactsBeforePhase3: 200,
};

export type SessionStatus =
  | 'draft'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'post_processing'
  | 'complete'
  | 'failed';

export interface SSEEvent {
  type: 'log' | 'stats' | 'status' | 'error';
  message?: string;
  data?: Record<string, unknown>;
}

export interface SessionStats {
  sourcesFound: number;
  factsExtracted: number;
  entitiesIdentified: number;
  counterfactualsRaised: number;
}

export interface LogEvent {
  icon: string;
  message: string;
  timestamp: number;
}

export type TimeLimitOption = 15 | 30 | 60 | 120 | null;

export interface IdentityCluster {
  name: string;
  identifier: string;
  fact_ids: string[];
}

export interface ResearchReport {
  ranked_facts: string[];
  timeline: { date: string; facts: string[] }[];
  clusters: {
    title: string;
    summary: string;
    fact_ids: string[];
  }[];
  executive_summary: string;
  entity_centrality: Record<string, number>;
  identity_clusters?: IdentityCluster[];
  chronological_fact_ids?: string[];
}

export interface RedTeamReport {
  facts_challenged: number;
  facts_refuted: number;
  facts_nuanced: number;
  facts_strengthened: number;
  facts_unchanged: number;
}

export const DIVERSITY_THRESHOLDS: Record<string, number> = {
  low: 0.05,
  medium: 0.15,
  high: 0.30,
};
