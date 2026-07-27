// Shared shapes for the Intel dashboard components.
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

export interface NetNode {
  id: string;
  name: string;
  type: string;
  typeId: string;
  icon: string;
  color: string;
  summary: string | null;
  confirmed: boolean;
  confidence: string;
  noteCount: number;
  degree: number;
  importance: number;
  betweenness: number;
  brokerage: number;
  community: number;
  hops: number | null;
  /** ER category slugs, unioned across the notes asserting this entity. */
  categories: string[];
  /** Observed surface forms — searched alongside the name. */
  aliases: string[];
}

export interface NetCategory {
  id: string;
  slug: string;
  name: string;
  color: string;
}

export interface NetEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string | null;
  strength: string;
  confidence: string;
  crossCommunity: boolean;
}

export interface NetworkPayload {
  nodes: NetNode[];
  edges: NetEdge[];
  types: Array<{ id: string; name: string; icon: string; color: string }>;
  categories: NetCategory[];
  /** Ids that literally matched the keyword filter (the rest is context). */
  matched: string[];
  trimmed: boolean;
  stats: {
    totalNodes: number;
    totalEdges: number;
    shown: number;
    communities: number;
    modularity: number;
    components: number;
    largestComponent: number;
    isolated: number;
  };
  communities: Array<{ id: number; size: number; label: string }>;
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

export interface DuplicateRow {
  confidence: number;
  signals: string[];
  reason: string;
  autoMergeable: boolean;
  keep: { id: string; name: string; type: string; degree: number; noteCount: number };
  merge: { id: string; name: string; type: string; degree: number; noteCount: number };
}
