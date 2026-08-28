// Dijkstra routing for the Broads Pilot engine: passability-aware shortest-time
// paths plus a reachability frontier. Pure, dependency-free.
import type {
  WaterGraph,
  GraphEdge,
  Restrictions,
  Boat,
  Bridge,
  BridgeVerdict,
  RouteLeg,
  Verdict,
} from './types';
import { buildAdjacency, type AdjEntry } from './graph';
import { groundSpeedMs, edgeVerdict, bridgeVerdict } from './passability';

const RANK: Record<Verdict, number> = { pass: 0, marginal: 1, blocked: 2 };

/** Time (s) to traverse an edge: capped at 6 mph, with a 0.9 real-world factor. */
export function edgeTimeS(edge: GraphEdge): number {
  const mph = Math.min(edge.limit_mph, 6);
  return edge.length_m / (groundSpeedMs(mph) * 0.9);
}

interface DijkstraResult {
  /** node id → edge taken to reach it (for path reconstruction) */
  prevEdge: Map<string, GraphEdge>;
  /** node id → previous node id */
  prevNode: Map<string, string>;
  /** node id → best time (s) from source */
  dist: Map<string, number>;
}

/** Generic Dijkstra over edge-time, with a pluggable edge filter. */
function dijkstra(
  graph: WaterGraph,
  fromId: string,
  allow: (edge: GraphEdge) => boolean,
  budgetS = Infinity,
): DijkstraResult {
  const adj = buildAdjacency(graph);
  const dist = new Map<string, number>();
  const prevEdge = new Map<string, GraphEdge>();
  const prevNode = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(fromId, 0);
  // Simple array-based priority queue (graphs here are small).
  const pq: { node: string; d: number }[] = [{ node: fromId, d: 0 }];

  while (pq.length) {
    // pop the minimum
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[bi].d) bi = i;
    const { node, d } = pq.splice(bi, 1)[0];
    if (visited.has(node)) continue;
    visited.add(node);

    const neighbours: AdjEntry[] = adj.get(node) ?? [];
    for (const { edge, to } of neighbours) {
      if (!allow(edge)) continue;
      const nd = d + edgeTimeS(edge);
      if (nd > budgetS) continue; // never expand beyond the budget
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prevEdge.set(to, edge);
        prevNode.set(to, node);
        pq.push({ node: to, d: nd });
      }
    }
  }
  return { prevEdge, prevNode, dist };
}

/** Reconstruct the edge path from source to target (empty if unreachable). */
function reconstruct(res: DijkstraResult, fromId: string, toId: string): GraphEdge[] {
  if (!res.dist.has(toId)) return [];
  const edges: GraphEdge[] = [];
  let cur = toId;
  while (cur !== fromId) {
    const e = res.prevEdge.get(cur);
    const p = res.prevNode.get(cur);
    if (!e || p === undefined) return []; // disconnected
    edges.push(e);
    cur = p;
  }
  edges.reverse();
  return edges;
}

/** Bridge verdicts encountered along a path; non-pass first (worst-ranked),
 * then in path order. Deduplicated by bridge id. */
function pathBridges(
  edges: GraphEdge[],
  restrictions: Restrictions,
  boat: Boat,
): BridgeVerdict[] {
  const seen = new Map<string, BridgeVerdict>();
  for (const edge of edges) {
    for (const rid of edge.restriction_ids) {
      if (seen.has(rid)) continue;
      const bridge = restrictions.bridges.find((b) => b.id === rid);
      if (!bridge) continue;
      seen.set(rid, { bridge, verdict: bridgeVerdict(bridge, boat) });
    }
  }
  const list = [...seen.values()];
  // Stable sort: non-pass (higher rank) first.
  return list
    .map((bv, i) => ({ bv, i }))
    .sort((a, b) => RANK[b.bv.verdict] - RANK[a.bv.verdict] || a.i - b.i)
    .map((x) => x.bv);
}

/**
 * Shortest-time route from `fromId` to `toId` for `boat`, skipping any edge
 * blocked for that boat. On failure, returns an empty leg whose `blockedAt`
 * names the single nearest blocking bridge on the would-be (allow-blocked)
 * path, or null if no path exists even then.
 */
export function route(
  graph: WaterGraph,
  restrictions: Restrictions,
  boat: Boat,
  fromId: string,
  toId: string,
): RouteLeg {
  const empty = (blockedAt: Bridge | null): RouteLeg => ({
    edges: [],
    distance_m: 0,
    time_s: 0,
    bridges: [],
    crossesBreydon: false,
    blockedAt,
  });

  if (fromId === toId) return { ...empty(null), blockedAt: null };

  const passable = (edge: GraphEdge) =>
    edgeVerdict(edge, restrictions, boat) !== 'blocked';

  const res = dijkstra(graph, fromId, passable);
  const edges = reconstruct(res, fromId, toId);

  if (edges.length === 0) {
    // Second Dijkstra ignoring the block, to discover what's in the way.
    const allowAll = () => true;
    const res2 = dijkstra(graph, fromId, allowAll);
    const wouldBe = reconstruct(res2, fromId, toId);
    let blockedAt: Bridge | null = null;
    outer: for (const edge of wouldBe) {
      for (const rid of edge.restriction_ids) {
        const bridge = restrictions.bridges.find((b) => b.id === rid);
        if (bridge && bridgeVerdict(bridge, boat) === 'blocked') {
          blockedAt = bridge; // nearest blocking bridge along the path
          break outer;
        }
      }
    }
    return empty(blockedAt);
  }

  const distance_m = edges.reduce((s, e) => s + e.length_m, 0);
  const time_s = edges.reduce((s, e) => s + edgeTimeS(e), 0);
  const crossesBreydon = edges.some((e) => e.tidal_zone === 'breydon');

  return {
    edges,
    distance_m,
    time_s,
    bridges: pathBridges(edges, restrictions, boat),
    crossesBreydon,
    blockedAt: null,
  };
}

/**
 * Reachability frontier: every node within `budgetS` time of `fromId`,
 * expanding only through edges that are not blocked for `boat`.
 */
export function reachable(
  graph: WaterGraph,
  restrictions: Restrictions,
  boat: Boat,
  fromId: string,
  budgetS: number,
): Map<string, { time_s: number; dist_m: number }> {
  const adj = buildAdjacency(graph);
  const passable = (edge: GraphEdge) =>
    edgeVerdict(edge, restrictions, boat) !== 'blocked';

  const time = new Map<string, number>();
  const dist = new Map<string, number>();
  const visited = new Set<string>();
  time.set(fromId, 0);
  dist.set(fromId, 0);

  const pq: { node: string; t: number; d: number }[] = [
    { node: fromId, t: 0, d: 0 },
  ];

  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].t < pq[bi].t) bi = i;
    const { node, t, d } = pq.splice(bi, 1)[0];
    if (visited.has(node)) continue;
    visited.add(node);

    for (const { edge, to } of adj.get(node) ?? []) {
      if (!passable(edge)) continue;
      const nt = t + edgeTimeS(edge);
      if (nt > budgetS) continue; // do not record nodes beyond the budget
      const nd = d + edge.length_m;
      if (nt < (time.get(to) ?? Infinity)) {
        time.set(to, nt);
        dist.set(to, nd);
        pq.push({ node: to, t: nt, d: nd });
      }
    }
  }

  const out = new Map<string, { time_s: number; dist_m: number }>();
  for (const [node, t] of time) out.set(node, { time_s: t, dist_m: dist.get(node)! });
  return out;
}
