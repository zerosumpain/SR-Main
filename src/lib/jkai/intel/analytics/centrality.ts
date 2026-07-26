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
// Betweenness uses Brandes' algorithm (O(V·E)); at ~500 nodes / ~460 edges that
// is a few milliseconds, and it stays usable to ~20k nodes.
import type { AdjacencyIndex } from './model';

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
export function betweenness(index: AdjacencyIndex): Map<string, number> {
  const scores = new Map<string, number>();
  for (const id of index.ids) scores.set(id, 0);

  for (const s of index.ids) {
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

export function computeCentrality(index: AdjacencyIndex): CentralityScores {
  return {
    degree: new Map(index.degree),
    betweenness: betweenness(index),
    pagerank: pagerank(index),
  };
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
