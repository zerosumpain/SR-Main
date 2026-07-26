// Path finding — "how is X connected to Y?"
//
// The question an intelligence graph exists to answer. Plain shortest path is
// rarely enough: the second and third routes between two entities are often
// more revealing than the first, so `findPaths` returns several disjoint-ish
// routes rather than one.
import type { AdjacencyIndex, GraphEdge } from './model';
import { pairKey } from './model';

export interface PathStep {
  from: string;
  to: string;
  edges: GraphEdge[];
}

export interface GraphPath {
  nodes: string[];
  steps: PathStep[];
  hops: number;
}

/** Shortest path between two nodes, or null when no route exists. */
export function shortestPath(
  index: AdjacencyIndex,
  from: string,
  to: string,
  maxHops = 6,
): GraphPath | null {
  const paths = findPaths(index, from, to, { maxHops, limit: 1 });
  return paths[0] ?? null;
}

function toPath(index: AdjacencyIndex, nodes: string[]): GraphPath {
  const steps: PathStep[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    steps.push({
      from: nodes[i],
      to: nodes[i + 1],
      edges: index.edgesBetween.get(pairKey(nodes[i], nodes[i + 1])) ?? [],
    });
  }
  return { nodes, steps, hops: nodes.length - 1 };
}

export interface FindPathsOptions {
  maxHops?: number;
  /** How many routes to return. */
  limit?: number;
  /** Entity ids that may not appear on a route (used to force alternatives). */
  exclude?: Set<string>;
}

/**
 * Up to `limit` routes between two entities, shortest first.
 *
 * After the first route we penalise its intermediate nodes so subsequent routes
 * go a genuinely different way — otherwise "alternative paths" are the same
 * chain with one hop swapped, which tells you nothing. Bounded BFS keeps this
 * cheap: the search never expands past `maxHops`.
 */
export function findPaths(
  index: AdjacencyIndex,
  from: string,
  to: string,
  opts: FindPathsOptions = {},
): GraphPath[] {
  const maxHops = opts.maxHops ?? 4;
  const limit = opts.limit ?? 3;
  if (from === to || !index.neighbours.has(from) || !index.neighbours.has(to)) return [];

  const found: GraphPath[] = [];
  const penalised = new Set<string>(opts.exclude ?? []);

  for (let attempt = 0; attempt < limit; attempt++) {
    const route = bfsRoute(index, from, to, maxHops, penalised);
    if (!route) break;
    found.push(toPath(index, route));
    // Penalise the intermediates (never the endpoints) so the next search is
    // pushed onto different ground.
    for (const n of route.slice(1, -1)) penalised.add(n);
  }

  return found;
}

function bfsRoute(
  index: AdjacencyIndex,
  from: string,
  to: string,
  maxHops: number,
  blocked: Set<string>,
): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  let frontier = [from];

  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of index.neighbours.get(id) ?? []) {
        if (prev.has(nb)) continue;
        if (blocked.has(nb) && nb !== to) continue;
        prev.set(nb, id);
        if (nb === to) {
          const route: string[] = [];
          let cur: string | null = to;
          while (cur !== null) {
            route.push(cur);
            cur = prev.get(cur) ?? null;
          }
          return route.reverse();
        }
        next.push(nb);
      }
    }
    frontier = next;
  }

  return null;
}

/** Neighbours shared by two nodes — the basis of most link-prediction scores. */
export function commonNeighbours(index: AdjacencyIndex, a: string, b: string): string[] {
  const na = index.neighbours.get(a);
  const nb = index.neighbours.get(b);
  if (!na || !nb) return [];
  const smaller = na.size <= nb.size ? na : nb;
  const larger = na.size <= nb.size ? nb : na;
  return [...smaller].filter((n) => larger.has(n) && n !== a && n !== b);
}

/**
 * Adamic-Adar: common neighbours weighted by 1/log(degree), so a shared
 * connection through a niche entity counts for far more than one through a hub
 * everything touches. The standard measure for "these two should probably be
 * connected and aren't".
 */
export function adamicAdar(index: AdjacencyIndex, a: string, b: string): number {
  let score = 0;
  for (const n of commonNeighbours(index, a, b)) {
    const deg = index.degree.get(n) ?? 0;
    if (deg > 1) score += 1 / Math.log(deg);
  }
  return score;
}
