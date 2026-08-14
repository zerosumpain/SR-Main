// The shape /api/jkai/intel/clusters ships, shared by every surface that renders
// a cluster.
//
// One declaration rather than three: the rail card, the cluster map and the full
// cluster page all read the same payload, and three hand-copied interfaces would
// drift the moment a field was added — the same reasoning that put the shared
// encodings in ./graph-visual.

export interface ClusterComposition {
  size: number;
  /** Entity type → count, biggest first. */
  types: Array<[string, number]>;
  /** Note source → how many entities carry it, biggest first. */
  sources: Array<[string, number]>;
  sourceless: number;
  noteTotal: number;
  /** Normalised source-mix entropy, 0..1. Subject versus feed. */
  diversity: number;
}

export interface ClusterDelta {
  joined: string[];
  left: string[];
  joinedCount: number;
  leftCount: number;
  at: string;
}

export interface ClusterMember {
  id: string;
  name: string;
  type: string;
  icon: string;
}

export interface ClusterBridge {
  id: string;
  name: string;
  type: string;
  /** Keys of the other clusters this member reaches. */
  reaches: string[];
}

export interface ClusterView {
  key: string;
  /** The user's name where there is one, the generated label otherwise. */
  label: string;
  autoLabel: string;
  name: string | null;
  colourIndex: number;
  size: number;
  composition: ClusterComposition;
  medianRelevance: number;
  /** Source diversity × log size — the ordering. */
  signal: number;
  span: { from: string; to: string } | null;
  members: ClusterMember[];
  bridges: ClusterBridge[];
  delta: ClusterDelta | null;
  firstSeenAt: string;
  lastSeenAt: string;
  mergedFrom: string[];
  splitFrom: string | null;
  narrative: string | null;
  narrativeAt: string | null;
  /** The membership has moved since the narrative was written. */
  narrativeStale: boolean;
  /** How far the cluster has moved from what the user named, 0..1. */
  nameDrift: number | null;
  nameDrifted: boolean;
  namedAt: string | null;
}

export interface ClusterRosterStats {
  totalEntities: number;
  connected: number;
  isolated: number;
  tracked: number;
  untracked: number;
  modularity: number;
  components: number;
}

export interface ClusterGraph {
  nodes: Array<{ key: string; label: string; size: number; colourIndex: number; signal: number }>;
  links: Array<{ source: string; target: string; count: number }>;
}

export interface ClusterRoster {
  clusters: ClusterView[];
  resolution: number;
  stats: ClusterRosterStats;
  clusterGraph: ClusterGraph;
  changes?: {
    created: string[];
    matched: string[];
    retired: string[];
    merged: string[];
    split: string[];
  };
}
