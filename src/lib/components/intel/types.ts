// Shared shapes for the Intel dashboard components.
//
// The graph payload types (NetNode, NetEdge, NetCategory, NetworkPayload) live
// in $lib/codegraph/types — they are what the codegraph module produces, and a
// producer should not have to reach into the UI tree to name its own output.
//
// Kept in a plain .ts module rather than exported from a component: a Svelte
// component's instance `<script>` cannot export types, and putting them in a
// `module` block would make every importer pull the component in.

export interface InsightEntity {
  id: string;
  name: string;
  type: string;
  icon: string;
  color: string;
}

export interface InsightData {
  id: string;
  kind: string;
  title: string;
  detail: string;
  score: number;
  action: string;
  actionLabel: string;
  actionPayload: string;
  entities: InsightEntity[];
}

export interface UnlikelyRelation {
  score: number;
  hops: number;
  reasons: string[];
  crossCommunity: boolean;
  sharedNeighbours: number;
  semanticDistance: number | null;
  entities: InsightEntity[];
}

export interface PredictedLink {
  score: number;
  reason: string;
  entities: InsightEntity[];
  via: InsightEntity[];
}

export interface DuplicateSide {
  id: string;
  name: string;
  type: string;
  degree: number;
  noteCount: number;
  /** Surface forms already recorded for this entity. */
  aliases?: string[];
  summary?: string | null;
}

/** A standing answer to "are these the same thing?", or null if nobody has said. */
export interface DuplicateDecision {
  verdict: 'same' | 'different' | 'unsure';
  decidedBy: 'human' | 'llm' | 'auto';
  rationale: string | null;
  model: string | null;
  at: string;
}

export interface DuplicateRow {
  confidence: number;
  signals: string[];
  reason: string;
  autoMergeable: boolean;
  decision?: DuplicateDecision | null;
  keep: DuplicateSide;
  merge: DuplicateSide;
}
