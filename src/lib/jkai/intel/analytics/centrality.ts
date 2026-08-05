// Centrality — "who matters, and why".
//
// Three measures, because they disagree in the way that is actually useful:
//   degree      — how many things this touches. Popularity.
//   betweenness — how often this sits on the shortest path between two others.
//                 Brokerage. A node with LOW degree and HIGH betweenness is the
//                 single link between two parts of your world, which is the most
//                 fragile and most interesting position in the graph.
//   pagerank    — importance weighted by the importance of what points at it.
//                 Robust to a node inflating its degree with trivial links.
//
// BETWEENNESS IS THE WHOLE COST OF THIS MODULE, and it has twice been the cause
// of a production incident, so the history matters:
//
// Brandes' algorithm is O(V·E). The first implementation here was also
// synchronous and stored its per-source working set in string-keyed Maps. The
// "stays usable to ~20k nodes" claim that once sat here was never measured and
// was wrong by orders of magnitude. Measured on this host, single-threaded:
//
//     500 nodes /   460 edges →    0.16 s
//   3,105 nodes / 3,028 edges →    7.4  s
//   5,338 nodes / 5,356 edges →   40.3 s     ← the live graph, 2026-08-05
//
// At 3.1k nodes it pinned the event loop for 7.4 s; /api/health/workflow-engine
// 503s past 5 s; systemd's watchdog restarts the service on a 503. The nightly
// intel sweep was therefore restarting production every ~6 minutes. Yielding to
// the event loop (below) stopped the restart loop but did nothing for wall
// clock, and by 5.3k nodes a cold /jkai/intel load spent 40 s inside this
// function — long past Caddy's proxy timeout, so the page 502'd instead of
// drawing.
//
// Two changes fixed the cost rather than its symptoms:
//
//   1. The graph is compiled once into a CSR adjacency over integer node
//      indices, and every per-source array is a typed array allocated ONCE and
//      refilled. The old code allocated four string-keyed Maps of size V for
//      each of V sources — that allocation and hashing, not the algorithm, was
//      most of the 40 s. Predecessors are no longer stored at all: the
//      accumulation phase recovers them with `dist[v] === dist[w] - 1`, which is
//      the standard Brandes variant and exact.
//
//   2. A sampled-source fallback (Brandes–Pich) for the day the graph outgrows
//      even that. It is a brake against a repeat outage, NOT the normal path —
//      see EXACT_MAX_NODES for why it is set where it is.
//
// Measured after (1), same host, same graph:
//
//   5,338 nodes / 5,356 edges →   1.66 s, results bit-for-bit identical
//
// `scripts/bench-intel-betweenness.ts` reproduces both the timing and the
// accuracy comparison that settled where the sampling threshold goes.
//
import type { AdjacencyIndex } from './model';

/**
 * Time between yields, in ms. The pass hands the event loop back at least this
 * often so health probes and pending I/O are still served while it runs — a
 * blocking span over ~5 s is what the workflow-engine health check 503s on, and
 * a 503 is what the systemd watchdog restarts the service for.
 */
const YIELD_EVERY_MS = 40;

/** Hand the event loop back, so pending I/O and health probes get served. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Up to this many nodes, every source is walked and the result is EXACT.
 *
 * Set deliberately far above the live graph (5,338 on 2026-08-05, ≈1.7 s), so
 * the normal path stays exact and this is a brake rather than a behaviour.
 * Cost is O(V·E): roughly 6 s at 10k nodes and 25 s at 20k, so 12k is about the
 * last size at which an exact pass still fits inside a request.
 *
 * Sampling was measured as an everyday option and rejected. On a 5,338-node
 * graph it cut 1.66 s to 0.25 s but moved 8 of the top 50 brokers and dropped
 * the rank correlation to 0.92 — a real change to what the dashboard says, in
 * exchange for 1.4 s that is already absorbed by the analysis cache. Speed here
 * came from the CSR rewrite, not from approximating; this constant exists so a
 * graph that doubles twice more degrades to an estimate instead of to an outage.
 */
const EXACT_MAX_NODES = 12_000;

/**
 * Sources sampled above that threshold (Brandes–Pich).
 *
 * Each source contributes an independent estimate of every node's betweenness,
 * so the accumulated total is scaled by V/k. The estimator is unbiased; what
 * sampling costs is precision, most visibly in the middle of the ranking.
 *
 * The sample is DETERMINISTIC — see `samplePivots`. It has to be: the watchlist
 * stores each entity's previous brokerage and alerts on the change, so a sample
 * that reshuffled per pass would invent "this entity's position changed"
 * notifications out of pure noise.
 */
const SAMPLE_SOURCES = 1_500;

/**
 * FNV-1a over the node id. Used only to order candidate pivots, so the sample
 * is a fixed function of the ids present rather than of insertion order or of
 * when the pass happened to run.
 */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * `k` source indices, chosen deterministically.
 *
 * Ordering by a hash of the id rather than by degree or position keeps the
 * sample uniform (a degree-biased sample would bias the estimate towards hubs)
 * and keeps it STABLE as the graph grows: a node's hash never changes, so
 * adding entities perturbs the chosen set by roughly k/V members instead of
 * reshuffling it. Consecutive nightly passes therefore compare like with like.
 */
function samplePivots(ids: string[], k: number): Int32Array {
  const order = Array.from({ length: ids.length }, (_, i) => i);
  order.sort((a, b) => hashId(ids[a]) - hashId(ids[b]) || (a - b));
  return Int32Array.from(order.slice(0, k));
}

export interface CentralityScores {
  degree: Map<string, number>;
  betweenness: Map<string, number>;
  pagerank: Map<string, number>;
}

/**
 * The graph flattened into CSR (compressed sparse row) form over integer node
 * indices: `adj.slice(offsets[v], offsets[v + 1])` are v's neighbours.
 *
 * Built once per pass. Every hot loop below then touches nothing but typed
 * arrays — no Map lookups, no string hashing, no per-source allocation.
 */
interface Csr {
  n: number;
  offsets: Int32Array;
  adj: Int32Array;
}

function toCsr(index: AdjacencyIndex): Csr {
  const n = index.ids.length;
  const idx = new Map<string, number>();
  for (let i = 0; i < n; i++) idx.set(index.ids[i], i);

  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    offsets[i + 1] = offsets[i] + (index.neighbours.get(index.ids[i])?.size ?? 0);
  }

  const adj = new Int32Array(offsets[n]);
  const cursor = Int32Array.from(offsets.subarray(0, n));
  for (let i = 0; i < n; i++) {
    for (const nb of index.neighbours.get(index.ids[i]) ?? []) {
      // A neighbour outside the index cannot happen (buildIndex drops those
      // edges) but guarding keeps a malformed index from writing out of bounds.
      const j = idx.get(nb);
      if (j !== undefined) adj[cursor[i]++] = j;
    }
  }

  return { n, offsets, adj };
}

/**
 * Brandes' betweenness centrality for an unweighted undirected graph.
 *
 * Exact below EXACT_MAX_NODES, Brandes–Pich sampled-source above it. Values are
 * normalised to 0..1 against the theoretical maximum so they can be compared
 * across graphs of different sizes.
 */
export async function betweenness(index: AdjacencyIndex): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const n = index.ids.length;
  for (const id of index.ids) scores.set(id, 0);
  if (n === 0) return scores;

  const { offsets, adj } = toCsr(index);

  // Allocated once and refilled per source. This is the change that took the
  // live graph from 40 s to under two seconds.
  const dist = new Int32Array(n);
  const sigma = new Float64Array(n);
  const delta = new Float64Array(n);
  const order = new Int32Array(n); // BFS discovery order — also the stack.
  const total = new Float64Array(n);

  const sampled = n > EXACT_MAX_NODES;
  const sources = sampled
    ? samplePivots(index.ids, SAMPLE_SOURCES)
    : Int32Array.from({ length: n }, (_, i) => i);

  let lastYield = Date.now();
  for (let si = 0; si < sources.length; si++) {
    if (Date.now() - lastYield >= YIELD_EVERY_MS) {
      await breathe();
      lastYield = Date.now();
    }

    const s = sources[si];
    dist.fill(-1);
    sigma.fill(0);
    delta.fill(0);
    sigma[s] = 1;
    dist[s] = 0;

    // BFS from s. `order` doubles as the queue and, read backwards, as the
    // stack of nodes in non-increasing distance that the accumulation needs.
    order[0] = s;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const v = order[head++];
      const dv = dist[v];
      const sv = sigma[v];
      for (let e = offsets[v]; e < offsets[v + 1]; e++) {
        const w = adj[e];
        if (dist[w] < 0) {
          dist[w] = dv + 1;
          order[tail++] = w;
        }
        if (dist[w] === dv + 1) sigma[w] += sv;
      }
    }

    // Accumulate dependencies back down the BFS tree. Predecessors are not
    // stored: v precedes w on a shortest path from s exactly when they are
    // adjacent and dist[v] === dist[w] - 1.
    for (let i = tail - 1; i > 0; i--) {
      const w = order[i];
      const coeff = (1 + delta[w]) / sigma[w];
      const dw = dist[w];
      for (let e = offsets[w]; e < offsets[w + 1]; e++) {
        const v = adj[e];
        if (dist[v] === dw - 1) delta[v] += sigma[v] * coeff;
      }
      total[w] += delta[w];
    }
  }

  // Undirected: every pair is counted twice. Normalise by the maximum possible
  // value for a graph this size, (n-1)(n-2), so scores land in 0..1. A sampled
  // pass walked k of the n sources, so its total is scaled back up by n/k —
  // that is what makes the estimate comparable with an exact one.
  const scale = sampled ? n / sources.length : 1;
  const denom = n > 2 ? (n - 1) * (n - 2) : 1;
  for (let i = 0; i < n; i++) scores.set(index.ids[i], (total[i] * scale) / denom);
  return scores;
}

/** PageRank with the standard 0.85 damping factor. */
export function pagerank(index: AdjacencyIndex, iterations = 40, damping = 0.85): Map<string, number> {
  const n = index.ids.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;
  for (const id of index.ids) rank.set(id, 1 / n);

  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>();
    let dangling = 0;

    for (const id of index.ids) {
      const deg = index.degree.get(id) ?? 0;
      if (deg === 0) dangling += rank.get(id)!;
      next.set(id, 0);
    }

    for (const id of index.ids) {
      const deg = index.degree.get(id) ?? 0;
      if (deg === 0) continue;
      const share = rank.get(id)! / deg;
      for (const nb of index.neighbours.get(id)!) {
        next.set(nb, next.get(nb)! + share);
      }
    }

    // Rank held by dangling nodes is redistributed uniformly, so the vector
    // stays a probability distribution.
    const base = (1 - damping) / n + (damping * dangling) / n;
    for (const id of index.ids) {
      next.set(id, base + damping * next.get(id)!);
    }

    for (const [id, v] of next) rank.set(id, v);
  }

  return rank;
}

/**
 * Slow-pass warning threshold. Well under the point where the graph is in
 * trouble, but high enough that a healthy pass never logs.
 */
const SLOW_PASS_MS = 5_000;

export async function computeCentrality(index: AdjacencyIndex): Promise<CentralityScores> {
  const t0 = Date.now();
  const scores: CentralityScores = {
    degree: new Map(index.degree),
    betweenness: await betweenness(index),
    pagerank: pagerank(index),
  };
  const ms = Date.now() - t0;
  if (ms > SLOW_PASS_MS) {
    // Announce the scaling wall before it becomes a mystery. Past the sampled
    // threshold the cost is O(k·E), so if this fires the graph has grown enough
    // that k itself wants revisiting.
    console.warn(
      `[intel:centrality] pass took ${ms}ms for ${index.ids.length} nodes — ` +
        `betweenness is ${index.ids.length > EXACT_MAX_NODES ? 'sampled' : 'exact'}; ` +
        'consider lowering SAMPLE_SOURCES.',
    );
  }
  return scores;
}

/**
 * Brokerage — high betweenness relative to degree. These are the entities whose
 * removal would actually fragment your picture, as opposed to the merely
 * well-connected ones. Returns 0 for anything too peripheral to matter.
 */
export function brokerageScore(
  id: string,
  scores: CentralityScores,
  index: AdjacencyIndex,
): number {
  const deg = index.degree.get(id) ?? 0;
  if (deg < 2) return 0;
  const btw = scores.betweenness.get(id) ?? 0;
  // Betweenness per unit of degree: a node bridging two clusters through only a
  // couple of links scores far above a hub with the same raw betweenness.
  return btw / Math.log2(deg + 1);
}
