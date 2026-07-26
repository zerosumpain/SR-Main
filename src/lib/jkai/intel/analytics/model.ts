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
