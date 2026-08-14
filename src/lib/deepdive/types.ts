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

/**
 * One event shape for every research tier.
 *
 * v3 folded the separate quick-answer stream into this union so the dashboard,
 * the desk and the workflow nodes all read one stream rather than two
 * incompatible ones.
 *
 *  - `token`     — a content delta from a streamed synthesis.
 *  - `reasoning` — a reasoning delta, shown only when the user toggles it on.
 *                  Carries `stage` so it attaches to the right activity instead
 *                  of forming one undifferentiated firehose. Never emitted by
 *                  models that cannot stream reasoning (any `codex/` id).
 *  - `sources`   — the ranked source set, emitted once by the fast tiers.
 *  - `graph`     — frontier node/edge deltas (phase 2 of the v3 work).
 *  - `lead`      — a lead changing status, including being pruned as a dead end.
 */
export interface SSEEvent {
  type:
    | 'log'
    | 'stats'
    | 'status'
    | 'error'
    | 'artefact'
    | 'synthesis'
    | 'token'
    | 'reasoning'
    | 'sources'
    | 'graph'
    | 'lead'
    | 'complete';
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

export interface KnowledgeGap {
  gap: string;
  type: 'geographic' | 'temporal' | 'stakeholder' | 'methodological' | 'unanswered_goal';
  severity: 'high' | 'medium' | 'low';
  goal_index?: number;
}

export interface Hypothesis {
  hypothesis: string;
  supporting_fact_ids: string[];
  tension_fact_ids: string[];
  testability: 'high' | 'medium' | 'low';
  suggested_queries: string[];
}

export interface Contradiction {
  fact_a_id: string;
  fact_b_id: string;
  tension: string;
}

export interface FollowUpSuggestion {
  question: string;
  context: string;
  seed_fact_ids: string[];
}

export interface SourceDiversity {
  total_domains: number;
  by_type: Record<string, number>;
  concentration_index: number;
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
  knowledge_gaps?: KnowledgeGap[];
  hypotheses?: Hypothesis[];
  contradictions_map?: Contradiction[];
  suggested_followups?: FollowUpSuggestion[];
  source_diversity?: SourceDiversity;
}

export interface RedTeamReport {
  facts_challenged: number;
  facts_refuted: number;
  facts_nuanced: number;
  facts_strengthened: number;
  facts_unchanged: number;
}

export interface SeedContext {
  type: 'fact' | 'entity' | 'cluster' | 'gap' | 'hypothesis';
  parentTopic: string;
  parentGoals: string[];
  factContents?: string[];
  entityNames?: string[];
  clusterTitle?: string;
  clusterSummary?: string;
  gapDescription?: string;
  hypothesisText?: string;
  suggestedQueries?: string[];
}

export const DIVERSITY_THRESHOLDS: Record<string, number> = {
  low: 0.05,
  medium: 0.15,
  high: 0.30,
};
