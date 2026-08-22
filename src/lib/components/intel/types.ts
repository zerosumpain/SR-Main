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
  /** Note sources that asserted this entity ('email', 'file', 'research', …). */
  sources: string[];
  /** Evidence view only — true when this node IS a source note, not an entity. */
  evidence?: boolean;
  /** 0..1 staleness weight — 1 is current, the floor is old but not gone. */
  recency: number;
  /**
   * 0..1 — confidence discounted by age, from `entityRelevance`. The same
   * number the entity card shows, computed server-side so the two views and the
   * card cannot disagree. Older payloads (a cached tab) may not carry it, hence
   * optional; `nodeRelevance` in graph-visual falls back to recency.
   */
  relevance?: number;
  /**
   * Inside the recency window on its own clock.
   *
   * Distinct from `recency`, which is a continuous 0..1 staleness weight used
   * for fading. This is a membership answer to the question the slicer asked,
   * and false for everything when no window is set.
   */
  recent?: boolean;
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
  /** Continuous 0..1 weight; `strength` is the display bucket derived from it. */
  weight: number;
  /** 0..1 staleness weight for this edge. */
  recency: number;
  /** The note source that asserted this edge, if known. Not an endpoint. */
  sourceKind: string | null;
  /** Inside the recency window. False for everything when no window is set. */
  recent?: boolean;
}

export interface NetworkPayload {
  nodes: NetNode[];
  edges: NetEdge[];
  types: Array<{ id: string; name: string; icon: string; color: string }>;
  categories: NetCategory[];
  /** Every source present in the graph, with its entity count. Counted over the
   *  whole graph, not the filtered view, so deselecting one does not remove the
   *  control you would use to bring it back. */
  sources: Array<{ id: string; count: number }>;
  /** Finer facets under a source — e.g. email split by kind of sender. */
  sourceKinds?: Array<{ id: string; source: string; kind: string; count: number }>;
  /** Finer still — the individual sender domains under a source. */
  sourceDomains?: Array<{ id: string; source: string; domain: string; count: number }>;
  /** Ids that literally matched the keyword filter (the rest is context). */
  matched: string[];
  trimmed: boolean;
  /** True when any filter is narrowing the view — the `selected*` stats are the
   *  ones worth showing while it is. */
  filtering?: boolean;
  /** 'evidence' when the nodes are notes and the entities they mention. */
  mode?: 'evidence';
  /** Which clock the recency window was measured on, echoed back. */
  clock?: 'added' | 'updated';
  /** The window that produced this payload, epoch ms; nulls are open-ended. */
  window?: { since: number | null; until: number | null };
  /**
   * Graph activity per UTC day, over the WHOLE graph rather than the filtered
   * selection — so the slicer's chart does not redraw itself as the window it
   * is driving moves across it.
   */
  activity?: {
    from: number;
    to: number;
    days: Array<{ t: number; nodes: number; edges: number }>;
    olderNodes: number;
    olderEdges: number;
  };
  stats: {
    totalNodes: number;
    totalEdges: number;
    shown: number;
    communities: number;
    modularity: number;
    components: number;
    largestComponent: number;
    isolated: number;
    /** What the current filter admits, before the 600-node render trim. */
    selectedNodes?: number;
    selectedEdges?: number;
    selectedCommunities?: number;
    /** What the recency window itself admitted, before endpoint expansion. */
    recentNodes?: number;
    recentEdges?: number;
    /** Evidence view only — how much of each side is in play. */
    evidenceNodes?: number;
    entityNodes?: number;
  };
  /** Clusters the filter reaches. `size` is the cluster's true size; `reach` is
   *  how much of it is in the current selection (equal when unfiltered). */
  communities: Array<{
    id: number;
    size: number;
    reach?: number;
    label: string;
    key?: string | null;
    colourIndex?: number | null;
  }>;
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
