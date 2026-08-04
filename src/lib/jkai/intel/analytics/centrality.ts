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
// Betweenness uses Brandes' algorithm (O(V·E)). The "stays usable to ~20k
// nodes" claim that used to sit here was never measured and is wrong by orders
// of magnitude. Measured on this host, single-threaded:
//
//     500 nodes /   460 edges →    0.16 s
//   3,105 nodes / 3,028 edges →    7.4  s     ← the live graph, 2026-08-04
//   6,000 nodes / 6,000 edges →   34.5  s
//
// That mattered for more than patience. The whole computation was synchronous,
// so at live scale it pinned the event loop for 7.4 s; /api/health/workflow-engine
// 503s past 5 s; systemd's watchdog restarts the service on a 503. The nightly
// intel sweep was therefore restarting production every ~6 minutes for the
// length of its run window, and each restart began the sweep again.
//
// So the outer loop now yields to the event loop periodically. The result is
// bit-for-bit identical — this is not an approximation — it just stops one
// analytics pass from taking the site down with it. The cost is still
// super-linear, and a graph that grows much past ~6k nodes needs sampled-source
// (Brandes–Pich) betweenness rather than a bigger yield budget; `computeCentrality`
// warns when a pass runs long so that arrives as a log line and not as an outage.
import type { AdjacencyIndex } from './model';

/**
 * Source nodes processed between yields. Each iteration is roughly
 * O(E + V) — a couple of milliseconds at live scale — so 64 keeps any single
 * blocking span comfortably under the 5 s health threshold while adding only a
 * few hundred yields to a full pass.
 */
const YIELD_EVERY = 64;

/** Hand the event loop back, so pending I/O and health probes get served. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface CentralityScores {
  degree: Map<string, number>;
  betweenness: Map<string, number>;
  pagerank: Map<string, number>;
}

/**
 * Brandes' betweenness centrality for an unweighted undirected graph.
 * Values are normalised to 0..1 against the theoretical maximum so they can be
 * compared across graphs of different sizes.
 */
export async function betweenness(index: AdjacencyIndex): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  for (const id of index.ids) scores.set(id, 0);

  let sinceYield = 0;
  for (const s of index.ids) {
    if (++sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      await breathe();
    }
    const stack: string[] = [];
    const preds = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();

    for (const id of index.ids) {
      preds.set(id, []);
      sigma.set(id, 0);
      dist.set(id, -1);
    }
    sigma.set(s, 1);
    dist.set(s, 0);

    // BFS from s, recording every shortest-path predecessor.
    const queue: string[] = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++];
      stack.push(v);
      for (const w of index.neighbours.get(v) ?? []) {
        if (dist.get(w)! < 0) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          preds.get(w)!.push(v);
        }
      }
    }

    // Accumulate dependencies back down the BFS tree.
    const delta = new Map<string, number>();
    for (const id of index.ids) delta.set(id, 0);
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of preds.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) scores.set(w, scores.get(w)! + delta.get(w)!);
    }
  }

  // Undirected: every pair is counted twice. Normalise by the maximum possible
  // value for a graph this size, (n-1)(n-2), so scores land in 0..1.
  const n = index.ids.length;
  const denom = n > 2 ? (n - 1) * (n - 2) : 1;
  for (const [id, v] of scores) scores.set(id, v / denom);
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
const SLOW_PASS_MS = 10_000;

export async function computeCentrality(index: AdjacencyIndex): Promise<CentralityScores> {
  const t0 = Date.now();
  const scores: CentralityScores = {
    degree: new Map(index.degree),
    betweenness: await betweenness(index),
    pagerank: pagerank(index),
  };
  const ms = Date.now() - t0;
  if (ms > SLOW_PASS_MS) {
    // Announce the scaling wall before it becomes a mystery. See the module
    // header: past roughly 6k nodes this wants sampled-source betweenness.
    console.warn(
      `[intel:centrality] pass took ${ms}ms for ${index.ids.length} nodes — ` +
        'betweenness is super-linear; consider sampled-source (Brandes–Pich).',
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
