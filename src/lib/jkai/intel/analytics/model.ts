// The in-memory graph the analytics layer works on.
//
// Everything downstream (centrality, communities, paths, surprise scoring,
// insights) operates on this snapshot rather than hitting the database, for two
// reasons: the algorithms are iterative and would otherwise be thousands of
// round trips, and keeping them pure makes them unit-testable without a DB.
//
// Size is not a concern at the scale this runs at — the production graph is
// ~500 entities / ~460 edges, and these algorithms stay comfortable into the
// tens of thousands of nodes. `buildSnapshot` is the only DB-aware part and
// lives in ./load.ts so this module imports nothing.

export interface GraphNode {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  icon: string;
  color: string;
  summary: string | null;
  confidence: string;
  confirmed: boolean;
  createdAt: number;
  updatedAt: number;
  /** Notes this entity appears in. Drives evidence counts and recency. */
  noteCount: number;
  /** Most recent note timestamp this entity was seen in, epoch ms. */
  lastSeenAt: number;
  /**
   * When this entity was last actually OBSERVED, epoch ms — as opposed to when
   * the row about it was written.
   *
   * These are not the same thing and the difference is the whole ballgame for
   * anything time-weighted. `intel_notes.created_at` is the INGEST clock: all
   * 1,038 email notes on 2026-08-05 share a single `created_at` day, because
   * that is when the sweep wrote them, not when the mail was sent. Ranking on
   * that gives every Gmail-derived entity maximum freshness regardless of
   * whether its thread is from yesterday or eleven weeks ago.
   *
   * `intel_relationships.last_seen_at` is the real thing — the Gmail ingest
   * passes each thread's `internalDate` through as `observedAt` — and spans 34
   * distinct days over the same data. So the newest incident edge observation
   * WINS, and the note clock is used only for an entity with no edges at all
   * (33% of them, every one isolated).
   *
   * Deliberately not the later of the two: the ingest clock is almost always the
   * more recent, so combining them lets it bury the value it was meant to
   * correct.
   */
  evidenceAt: number;
  /** Observed surface forms. Searched alongside the name so "IBCA" finds the
   *  node stored under its expanded title. */
  aliases: string[];
  /** ER category slugs, unioned across every note asserting this entity. */
  categories: string[];
  /**
   * `intel_notes.source` values that asserted this entity, unioned — 'email',
   * 'file', 'research', 'chat', 'web', 'whatsapp', 'workflow'.
   *
   * Unioned rather than singular for the same reason categories are: an entity
   * named in both an email and a deep dive belongs to both, and filtering to
   * one source should return everything that source ever told us about.
   */
  sources: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string | null;
  confidence: string;
  strength: string;
  createdAt: number;
  /** Continuous 0..1 weight. `strength` is a display bucket derived from it. */
  weight: number;
  /** When this edge was last observed, epoch ms. Drives its staleness. */
  lastSeenAt: number;
  /**
   * The note source that asserted this edge ('email', 'file', …), if known.
   *
   * Named `sourceKind`, not `source`: on an edge, `source` already means the
   * SOURCE ENDPOINT of the relationship, and a second meaning on the same
   * object would be a genuine trap for anyone reading it later.
   */
  sourceKind: string | null;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Adjacency plus the index structures every algorithm here needs. */
export interface AdjacencyIndex {
  /** node id → set of neighbour ids (undirected). */
  neighbours: Map<string, Set<string>>;
  /** node id → its node record. */
  byId: Map<string, GraphNode>;
  /** Ordered node ids — the canonical iteration order. */
  ids: string[];
  /** "a|b" with a<b → the edges joining them. */
  edgesBetween: Map<string, GraphEdge[]>;
  degree: Map<string, number>;
}

/** Canonical undirected key for a node pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildIndex(snapshot: GraphSnapshot): AdjacencyIndex {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, Set<string>>();
  const edgesBetween = new Map<string, GraphEdge[]>();

  for (const n of snapshot.nodes) neighbours.set(n.id, new Set());

  for (const e of snapshot.edges) {
    // Edges referencing a node outside the snapshot (filtered view, deleted
    // entity) are skipped rather than creating phantom nodes.
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (e.source === e.target) continue;
    neighbours.get(e.source)!.add(e.target);
    neighbours.get(e.target)!.add(e.source);
    const key = pairKey(e.source, e.target);
    const list = edgesBetween.get(key);
    if (list) list.push(e);
    else edgesBetween.set(key, [e]);
  }

  const degree = new Map<string, number>();
  for (const [id, set] of neighbours) degree.set(id, set.size);

  return { neighbours, byId, ids: snapshot.nodes.map((n) => n.id), edgesBetween, degree };
}

/** Nodes reachable from `start` within `maxHops`, with the hop distance. */
export function hopNeighbourhood(
  index: AdjacencyIndex,
  start: string,
  maxHops: number,
): Map<string, number> {
  const dist = new Map<string, number>();
  if (!index.neighbours.has(start)) return dist;
  dist.set(start, 0);
  let frontier = [start];

  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of index.neighbours.get(id) ?? []) {
        if (dist.has(nb)) continue;
        dist.set(nb, hop);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Connected components, largest first. */
export function components(index: AdjacencyIndex): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];

  for (const id of index.ids) {
    if (seen.has(id)) continue;
    const group: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const cur = queue.pop()!;
      group.push(cur);
      for (const nb of index.neighbours.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    out.push(group);
  }

  return out.sort((a, b) => b.length - a.length);
}
