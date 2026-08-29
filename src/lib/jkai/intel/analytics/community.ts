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
import { isCoLocationEdge, pairKey } from './model';

export interface CommunityResult {
  /** node id → community index. */
  membership: Map<string, number>;
  /** community index → member node ids. */
  communities: Map<number, string[]>;
  /** Newman modularity of the final partition, -1..1. Above ~0.3 is meaningful. */
  modularity: number;
  /** The resolution this partition was found at. */
  resolution: number;
}

/**
 * How large the biggest cluster may be, as a share of the entities connected to
 * anything at all.
 *
 * Measured rather than picked to look round. At the default γ=1 the production
 * graph puts 607 of its 6,410 connected entities — 9.5% — into one community,
 * and that community is precisely the one nobody can read anything out of: it is
 * a fifth of everything the picker shows and its members span chat transcripts,
 * home automation and half the product surface. 8% is the tightest cap the real
 * graph can satisfy while still taking the best modularity on offer (γ=1.25
 * gives 6.1% at Q=0.846, equal-best across the sweep).
 */
export const DOMINANCE_CAP = 0.08;

/**
 * The resolutions tried by the tuner.
 *
 * Louvain measures 80–205 ms over the whole production graph, so evaluating
 * seven of them costs under a second. That is cheap enough to re-tune on every
 * user-triggered recalculation, which is better than storing a tuned value:
 * the right resolution is a property of the graph's current shape, and the
 * graph gained 70% more entities in the nine days before this was written.
 */
export const RESOLUTION_SWEEP = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0] as const;

/** Below this a community is a fragment, not a neighbourhood worth naming. */
export const MIN_MEANINGFUL_SIZE = 5;

export interface ResolutionCandidate {
  resolution: number;
  /** Always measured at γ=1, so candidates share one yardstick. */
  modularity: number;
  /** Communities with at least MIN_MEANINGFUL_SIZE members. */
  clusters: number;
  largest: number;
  /** `largest` over the number of entities with at least one edge. */
  largestShare: number;
}

interface WeightedGraph {
  nodes: number[];
  /** node → Map<neighbour, weight> */
  adj: Map<number, Map<number, number>>;
  /** Self-loop weight accumulated when communities were collapsed. */
  selfLoops: Map<number, number>;
  totalWeight: number;
}

/**
 * Does anything other than co-location join these two?
 *
 * True when the pair has no recorded edges at all, so a caller holding an index
 * built without them cannot silently lose every pair.
 */
function pairIsSubstantive(index: AdjacencyIndex, a: string, b: string): boolean {
  const edges = index.edgesBetween.get(pairKey(a, b));
  if (!edges || edges.length === 0) return true;
  return edges.some((e) => !isCoLocationEdge(e, index.byId));
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
      // A pair joined ONLY by co-location is not adjacent for clustering.
      //
      // Two things in the same city are not related to each other, but every
      // edge saying so is true, so this cannot be fixed in the data — only by
      // declining to cluster on it. `Hany Shoukry based_in London` and
      // `Olympia London located_in London` put a consultant and a venue in one
      // community; an eBay seller's registered address put an order for a Dell
      // micro PC in with the 2026 World Cup.
      //
      // Per PAIR, not per edge, and conservative by construction: one
      // substantive relation anywhere between two nodes and the pair counts
      // normally. Only a pair whose entire relationship is "both are in London"
      // is dropped. The edges themselves stay in the snapshot — they are drawn,
      // walked by path finding, and counted in degree and centrality. This is
      // the only place that declines to see them.
      if (!pairIsSubstantive(index, id, nb)) continue;
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

/**
 * One Louvain level: greedy local moving until no node changes community.
 *
 * `resolution` scales the null model — the term subtracted for the connections
 * a community would be expected to have by chance. Above 1 that expectation is
 * inflated, so a community has to be more densely joined than usual to be worth
 * keeping together, and the partition comes out finer; below 1 it is discounted
 * and communities merge. It multiplies only the null term, never the observed
 * weight, which is what keeps γ=1 exactly the behaviour this had before.
 */
function optimiseLevel(graph: WeightedGraph, resolution: number): Map<number, number> {
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
      let bestGain = (links.get(own) ?? 0) - (resolution * commTotal.get(own)! * k) / m2;

      for (const [c, wIn] of links) {
        if (c === own) continue;
        const gain = wIn - (resolution * commTotal.get(c)! * k) / m2;
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

export function detectCommunities(index: AdjacencyIndex, resolution = 1): CommunityResult {
  const { graph, order } = toWeighted(index);

  // node index → community, refined level by level.
  let current = graph;
  let mapping = new Map<number, number>(order.map((_, i) => [i, i]));

  for (let level = 0; level < 10; level++) {
    const local = optimiseLevel(current, resolution);
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

  return { membership, communities, modularity: modularity(index, membership), resolution };
}

/**
 * Pick a resolution the partition is READABLE at.
 *
 * Deliberately not "maximise modularity". Q is nearly flat across the whole
 * sweep on the real graph (0.828–0.846) and peaks at γ≈1.0–1.25, so it cannot
 * tell a partition containing one 607-node blob apart from one without — and
 * the blob is the thing that makes the view unreadable. So the dominance cap is
 * the binding constraint and modularity only breaks ties beneath it.
 *
 * Coverage is deliberately NOT scored: communities of five or more cover 91.7%
 * of the connected graph at every γ in the sweep, so it carries no signal. Nor
 * is the isolate count, which is 2,632 at every γ — those entities have no edges
 * at all, and no resolution can cluster something that touches nothing. That is
 * a data-quality finding, and it belongs on the quality page rather than in a
 * tuning decision.
 */
export function autoTuneResolution(index: AdjacencyIndex): {
  resolution: number;
  candidates: ResolutionCandidate[];
} {
  // Against connected entities, not all of them: isolates are unclusterable at
  // every resolution, so counting them would shrink every share by the same
  // factor and quietly let a genuine blob through the cap.
  const connected = index.ids.filter((id) => (index.degree.get(id) ?? 0) > 0).length;

  const candidates: ResolutionCandidate[] = RESOLUTION_SWEEP.map((resolution) => {
    const result = detectCommunities(index, resolution);
    const sizes = [...result.communities.values()].map((ids) => ids.length);
    const largest = sizes.length ? Math.max(...sizes) : 0;
    return {
      resolution,
      modularity: result.modularity,
      clusters: sizes.filter((s) => s >= MIN_MEANINGFUL_SIZE).length,
      largest,
      largestShare: connected ? largest / connected : 0,
    };
  });

  const eligible = candidates.filter((c) => c.largestShare <= DOMINANCE_CAP);
  const best = eligible.length
    ? eligible.reduce((a, b) => (b.modularity > a.modularity ? b : a))
    : candidates.reduce((a, b) => (b.largestShare < a.largestShare ? b : a));

  return { resolution: best.resolution, candidates };
}
