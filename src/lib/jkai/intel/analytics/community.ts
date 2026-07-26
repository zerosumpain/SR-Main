// Community detection — the clusters your knowledge actually falls into.
//
// Louvain modularity optimisation. Two phases repeated until modularity stops
// improving: (1) greedily move each node to the neighbouring community that
// gains the most modularity; (2) collapse each community into a super-node and
// repeat on the smaller graph.
//
// Chosen over label propagation because Louvain is deterministic given a fixed
// node order (label propagation needs randomisation to avoid oscillation, and a
// dashboard that reshuffles its clusters on every reload is useless) and because
// it yields a modularity figure that tells you whether the clustering means
// anything at all.
import type { AdjacencyIndex } from './model';

export interface CommunityResult {
  /** node id → community index. */
  membership: Map<string, number>;
  /** community index → member node ids. */
  communities: Map<number, string[]>;
  /** Newman modularity of the final partition, -1..1. Above ~0.3 is meaningful. */
  modularity: number;
}

interface WeightedGraph {
  nodes: number[];
  /** node → Map<neighbour, weight> */
  adj: Map<number, Map<number, number>>;
  /** Self-loop weight accumulated when communities were collapsed. */
  selfLoops: Map<number, number>;
  totalWeight: number;
}

function toWeighted(index: AdjacencyIndex): { graph: WeightedGraph; order: string[] } {
  const order = [...index.ids];
  const idx = new Map(order.map((id, i) => [id, i]));
  const adj = new Map<number, Map<number, number>>();
  const selfLoops = new Map<number, number>();
  let totalWeight = 0;

  for (let i = 0; i < order.length; i++) {
    adj.set(i, new Map());
    selfLoops.set(i, 0);
  }

  for (const id of order) {
    const i = idx.get(id)!;
    for (const nb of index.neighbours.get(id) ?? []) {
      const j = idx.get(nb);
      if (j === undefined || j === i) continue;
      adj.get(i)!.set(j, 1);
      if (i < j) totalWeight += 1;
    }
  }

  return { graph: { nodes: [...adj.keys()], adj, selfLoops, totalWeight }, order };
}

function weightedDegree(graph: WeightedGraph, node: number): number {
  let sum = 2 * (graph.selfLoops.get(node) ?? 0);
  for (const w of graph.adj.get(node)?.values() ?? []) sum += w;
  return sum;
}

/** One Louvain level: greedy local moving until no node changes community. */
function optimiseLevel(graph: WeightedGraph): Map<number, number> {
  const community = new Map<number, number>();
  for (const n of graph.nodes) community.set(n, n);
  if (graph.totalWeight === 0) return community;

  const m2 = 2 * graph.totalWeight;
  const degrees = new Map(graph.nodes.map((n) => [n, weightedDegree(graph, n)]));
  const commTotal = new Map<number, number>();
  for (const n of graph.nodes) commTotal.set(n, degrees.get(n)!);

  let improved = true;
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;

    for (const node of graph.nodes) {
      const own = community.get(node)!;
      const k = degrees.get(node)!;

      // Weight from this node into each neighbouring community.
      const links = new Map<number, number>();
      for (const [nb, w] of graph.adj.get(node) ?? []) {
        const c = community.get(nb)!;
        links.set(c, (links.get(c) ?? 0) + w);
      }

      // Remove the node from its own community before evaluating.
      commTotal.set(own, commTotal.get(own)! - k);

      let bestComm = own;
      let bestGain = (links.get(own) ?? 0) - (commTotal.get(own)! * k) / m2;

      for (const [c, wIn] of links) {
        if (c === own) continue;
        const gain = wIn - (commTotal.get(c)! * k) / m2;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          bestComm = c;
        }
      }

      commTotal.set(bestComm, (commTotal.get(bestComm) ?? 0) + k);
      if (bestComm !== own) {
        community.set(node, bestComm);
        improved = true;
      }
    }
  }

  return community;
}

/** Collapse each community into a single node, preserving edge weights. */
function collapse(graph: WeightedGraph, community: Map<number, number>): { graph: WeightedGraph; map: Map<number, number> } {
  const renumber = new Map<number, number>();
  for (const c of community.values()) {
    if (!renumber.has(c)) renumber.set(c, renumber.size);
  }

  const adj = new Map<number, Map<number, number>>();
  const selfLoops = new Map<number, number>();
  for (let i = 0; i < renumber.size; i++) {
    adj.set(i, new Map());
    selfLoops.set(i, 0);
  }

  for (const node of graph.nodes) {
    const c = renumber.get(community.get(node)!)!;
    selfLoops.set(c, selfLoops.get(c)! + (graph.selfLoops.get(node) ?? 0));
    for (const [nb, w] of graph.adj.get(node) ?? []) {
      const d = renumber.get(community.get(nb)!)!;
      if (c === d) {
        // Halved because each internal edge is walked from both endpoints.
        selfLoops.set(c, selfLoops.get(c)! + w / 2);
      } else {
        adj.get(c)!.set(d, (adj.get(c)!.get(d) ?? 0) + w);
      }
    }
  }

  return {
    graph: { nodes: [...adj.keys()], adj, selfLoops, totalWeight: graph.totalWeight },
    map: renumber,
  };
}

/** Newman modularity of a partition on the ORIGINAL graph. */
export function modularity(index: AdjacencyIndex, membership: Map<string, number>): number {
  let edgeCount = 0;
  for (const id of index.ids) edgeCount += index.degree.get(id) ?? 0;
  const m = edgeCount / 2;
  if (m === 0) return 0;

  const internal = new Map<number, number>();
  const totalDeg = new Map<number, number>();

  for (const id of index.ids) {
    const c = membership.get(id);
    if (c === undefined) continue;
    totalDeg.set(c, (totalDeg.get(c) ?? 0) + (index.degree.get(id) ?? 0));
    for (const nb of index.neighbours.get(id) ?? []) {
      if (membership.get(nb) === c) internal.set(c, (internal.get(c) ?? 0) + 1);
    }
  }

  let q = 0;
  for (const [c, deg] of totalDeg) {
    const inside = (internal.get(c) ?? 0) / 2;
    q += inside / m - (deg / (2 * m)) ** 2;
  }
  return q;
}

export function detectCommunities(index: AdjacencyIndex): CommunityResult {
  const { graph, order } = toWeighted(index);

  // node index → community, refined level by level.
  let current = graph;
  let mapping = new Map<number, number>(order.map((_, i) => [i, i]));

  for (let level = 0; level < 10; level++) {
    const local = optimiseLevel(current);
    const distinct = new Set(local.values()).size;
    const collapsed = collapse(current, local);

    // Rewrite the original-node → community mapping through this level.
    const next = new Map<number, number>();
    for (const [orig, comm] of mapping) {
      next.set(orig, collapsed.map.get(local.get(comm) ?? comm) ?? 0);
    }
    mapping = next;

    if (distinct === current.nodes.length) break; // nothing merged; converged
    current = collapsed.graph;
    if (current.nodes.length <= 1) break;
  }

  const membership = new Map<string, number>();
  order.forEach((id, i) => membership.set(id, mapping.get(i) ?? 0));

  // Renumber so the largest community is 0, the next 1, and so on — stable,
  // readable indices for colouring the UI.
  const sizes = new Map<number, number>();
  for (const c of membership.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const rank = new Map(
    [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c], i) => [c, i]),
  );
  for (const [id, c] of membership) membership.set(id, rank.get(c) ?? 0);

  const communities = new Map<number, string[]>();
  for (const [id, c] of membership) {
    const list = communities.get(c);
    if (list) list.push(id);
    else communities.set(c, [id]);
  }

  return { membership, communities, modularity: modularity(index, membership) };
}
