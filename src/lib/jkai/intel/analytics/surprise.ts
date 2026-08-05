// "Unlikely relations" — the connections worth being told about.
//
// A graph full of obvious links is noise. What earns a place on a dashboard is
// a pair of entities that ARE connected but have no business being similar:
// different clusters, different types, no shared context, unrelated subject
// matter — and yet a short, real path between them. That is either a genuine
// insight about your world or a sign the extractor conflated something, and
// both are worth surfacing.
//
// Two complementary outputs:
//   scoreSurprisingLinks — pairs that ARE connected but shouldn't look it
//   predictMissingLinks  — pairs that are NOT connected but structurally should be
import type { AdjacencyIndex, GraphNode } from './model';
import { pairKey, hopNeighbourhood } from './model';
import { commonNeighbours, adamicAdar } from './paths';

/** Time between yields, in ms. Well inside the 5s the health probe 503s past. */
const YIELD_EVERY_MS = 40;

/** Hand the event loop back, so pending I/O and health probes get served. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface SurpriseContext {
  index: AdjacencyIndex;
  /** node id → community index, from detectCommunities. */
  membership: Map<string, number>;
  /** node id → unit-normalised embedding. Optional; scoring degrades gracefully. */
  embeddings?: Map<string, number[]>;
  /**
   * Pairs the user has said are NOT related, as `pairKey` strings.
   *
   * Suppressed edges are deliberately absent from the index, so without this
   * the predictor would re-propose every rejected pair on the next run and
   * "not related" would mean nothing beyond the moment it was clicked.
   */
  suppressedPairs?: Set<string>;
}

export interface SurprisingLink {
  a: string;
  b: string;
  hops: number;
  score: number;
  /** Human-readable reasons, strongest first — this is what the UI shows. */
  reasons: string[];
  crossCommunity: boolean;
  crossType: boolean;
  sharedNeighbours: number;
  semanticDistance: number | null;
  /** Intermediate entity ids on the route, for explaining the find. */
  via: string[];
}

export interface PredictedLink {
  a: string;
  b: string;
  score: number;
  sharedNeighbours: string[];
  reason: string;
}

/** Cosine distance in 0..1 for unit-length vectors (1 - cosine similarity, halved). */
export function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0.5;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0.5;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  // Map cosine similarity (-1..1) onto a 0..1 distance.
  return Math.min(1, Math.max(0, (1 - sim) / 2));
}

/** How far apart two entities are in subject matter. Null when unknowable. */
function semanticDistance(ctx: SurpriseContext, a: string, b: string): number | null {
  const va = ctx.embeddings?.get(a);
  const vb = ctx.embeddings?.get(b);
  if (!va || !vb) return null;
  return cosineDistance(va, vb);
}

/**
 * How expected a link between two nodes is under the configuration model —
 * the standard null model in which nodes wire up in proportion to their degree.
 * Expected edge multiplicity is deg(a)·deg(b)/2m.
 *
 * This factor is what stops hubs from monopolising the results. The production
 * graph has one entity of degree 119 in a graph of ~460 edges, so EVERYTHING it
 * touches is technically cross-cluster and, without this correction, scored as
 * a startling discovery. It isn't: a hub connecting to things is the least
 * surprising event in a graph. Two obscure entities connecting is the story.
 */
function expectedness(index: AdjacencyIndex, a: string, b: string, edgeCount: number): number {
  if (edgeCount <= 0) return 0;
  const da = index.degree.get(a) ?? 0;
  const db = index.degree.get(b) ?? 0;
  return (da * db) / (2 * edgeCount);
}

function totalEdges(index: AdjacencyIndex): number {
  let sum = 0;
  for (const id of index.ids) sum += index.degree.get(id) ?? 0;
  return sum / 2;
}

/** The degree at the given percentile — the line above which a node is a hub. */
export function degreeAtPercentile(index: AdjacencyIndex, p: number): number {
  const degrees = index.ids.map((id) => index.degree.get(id) ?? 0).sort((a, b) => a - b);
  if (!degrees.length) return 0;
  return degrees[Math.min(degrees.length - 1, Math.floor(degrees.length * p))];
}

/**
 * Adamic-Adar over the pair's shared neighbours: rare connectors count for
 * more than hubs everything touches.
 */
function sharedRarity(index: AdjacencyIndex, shared: string[]): number {
  let sum = 0;
  for (const u of shared) sum += 1 / Math.log(2 + (index.degree.get(u) ?? 0));
  return sum;
}

/**
 * How specific the intermediates on a route are. A path through two obscure
 * entities is a real discovery; the same path through the graph's biggest hub
 * is just "everything touches IBCA".
 */
function bridgeSpecificity(index: AdjacencyIndex, mids: string[]): number {
  if (!mids.length) return 0;
  let sum = 0;
  for (const u of mids) sum += 1 / Math.log(2 + (index.degree.get(u) ?? 0));
  return Math.min(1, sum / mids.length / 0.6);
}

/**
 * `hopNeighbourhood` plus the BFS tree that produced it: for every node reached,
 * the neighbour it was first reached FROM.
 *
 * This exists so a route can be read back for every node in one sweep instead of
 * re-running a BFS per destination. That was the single most expensive thing in
 * this module: at three hops the pair loop below reached ~690k pairs whose route
 * had to be inspected, and a fresh O(V+E) BFS for each of them cost 53 s on the
 * live graph (`scripts/bench-intel-insights.ts`) — long enough to trip the
 * event-loop watchdog and take the site down with it.
 *
 * Walking the parents is EXACTLY equivalent to the per-pair BFS it replaces, not
 * an approximation: both explore frontier by frontier in the same order and set
 * a node's parent the first time it is seen, so they agree on every route. The
 * per-pair walk stopped early once its destination was found, which changes when
 * the walk ends but never which parent a node was given.
 */
function bfsTree(
  index: AdjacencyIndex,
  start: string,
  maxHops: number,
): { dist: Map<string, number>; parent: Map<string, string | null> } {
  const dist = new Map<string, number>();
  const parent = new Map<string, string | null>();
  if (!index.neighbours.has(start)) return { dist, parent };
  dist.set(start, 0);
  parent.set(start, null);
  let frontier = [start];

  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of index.neighbours.get(id) ?? []) {
        if (dist.has(nb)) continue;
        dist.set(nb, hop);
        parent.set(nb, id);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return { dist, parent };
}

/**
 * The intermediates on the route the BFS tree recorded — BOTH endpoints
 * excluded, matching the `route.slice(1, -1)` this replaces.
 *
 * Starting from `to`'s parent drops the destination; stopping while the current
 * node still has a parent drops the start, whose parent is null. Getting that
 * second half wrong is not a subtle failure — including the start node makes
 * every route look like it runs through whichever entity the sweep happened to
 * be scoring from, which both mis-scores `bridgeSpecificity` and defeats the hub
 * gate that keeps the results readable.
 */
function midsFromTree(parent: Map<string, string | null>, to: string): string[] {
  const route: string[] = [];
  let cur: string | null | undefined = parent.get(to);
  while (cur != null && parent.get(cur) != null) {
    route.push(cur);
    cur = parent.get(cur);
  }
  return route.reverse();
}

/**
 * Score every pair within `maxHops` of each other for surprise.
 *
 * The score multiplies independent signals, so a pair must be unusual on
 * SEVERAL axes to rank — one oddity alone (say, merely being different types)
 * cannot carry a pair to the top. Each factor is bounded below so a single zero
 * doesn't annihilate an otherwise interesting pair.
 */
export async function scoreSurprisingLinks(
  ctx: SurpriseContext,
  opts: { maxHops?: number; limit?: number; minScore?: number } = {},
): Promise<SurprisingLink[]> {
  const maxHops = Math.min(opts.maxHops ?? 3, 4);
  const limit = opts.limit ?? 25;
  const minScore = opts.minScore ?? 0.05;
  const { index, membership } = ctx;

  const seen = new Set<string>();
  const out: SurprisingLink[] = [];
  const edgeCount = totalEdges(index);
  // Anything above this degree is a hub: it connects to everything, so a route
  // that only passes through hubs is not evidence of anything.
  const hubDegree = Math.max(4, degreeAtPercentile(index, 0.9));

  let lastYield = Date.now();
  for (const a of index.ids) {
    // Hand the event loop back periodically.
    //
    // This sweep is ~2.5s on the live graph even after the BFS-tree rewrite, and
    // the insights request that runs it also parses several thousand embeddings.
    // Together they blocked the loop for 5-7s — and /api/health/workflow-engine
    // 503s past 5s, which the systemd watchdog restarts the service for, which
    // kills whatever request was in flight and presents to the browser as a 502.
    // The same reasoning, and the same fix, as betweenness in ./centrality.
    if (Date.now() - lastYield >= YIELD_EVERY_MS) {
      await breathe();
      lastYield = Date.now();
    }
    const nodeA = index.byId.get(a);
    if (!nodeA) continue;
    // A node connected to nothing has no relations to be surprised by.
    if ((index.degree.get(a) ?? 0) === 0) continue;

    // One BFS per source, reused for both the reachable set and every route
    // read off it below.
    const { dist: reach, parent } = bfsTree(index, a, maxHops);
    for (const [b, hops] of reach) {
      if (hops === 0) continue;
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);

      const nodeB = index.byId.get(b);
      if (!nodeB) continue;

      const sharedIds = commonNeighbours(index, a, b);
      const shared = sharedIds.length;
      const crossCommunity = membership.get(a) !== membership.get(b);
      const crossType = nodeA.typeId !== nodeB.typeId;
      const expected = expectedness(index, a, b, edgeCount);

      // The intermediates the pair is actually connected through.
      //
      // At two hops these are EXACTLY the common neighbours, which are already
      // computed above — so use them rather than one arbitrary BFS route. That
      // matters: a pair joined both through a hub and through an obscure entity
      // is a genuine find, and picking whichever route BFS happened to reach
      // first could have discarded it. Beyond two hops there is no such
      // shortcut, so one shortest route stands in.
      const mids =
        hops === 1
          ? []
          : hops === 2
            ? sharedIds
            : midsFromTree(parent, b);

      // HARD GATE. A route whose every intermediate is a hub is the single
      // biggest source of false positives: with one degree-119 entity in a
      // 460-edge graph, "two hops apart" describes most of the graph and means
      // nothing. Without this the top results were a list of things connected
      // to IBCA, which John already knows.
      if (mids.length && mids.every((u) => (index.degree.get(u) ?? 0) >= hubDegree)) continue;

      // Proximity: a direct edge between two unrelated things is worth seeing,
      // but it is an ASSERTED link, not a discovery — so it is scored below a
      // two-hop find, which is something nobody wrote down.
      const proximity = hops === 1 ? 0.7 : hops === 2 ? 1 : 0.45;
      // Structural novelty: shared context makes a link ordinary.
      const novelty = 1 / (1 + shared);
      const communityFactor = crossCommunity ? 1 : 0.3;
      const typeFactor = crossType ? 1 : 0.6;
      // Configuration-model correction: how expected this pairing is by degree.
      const rarity = 1 / (1 + expected);
      // Adamic-Adar over shared neighbours — rare connectors count for more.
      const connectorRarity = shared ? Math.min(1, sharedRarity(index, sharedIds) / shared / 0.35) : 1;
      // How specific the intermediates on the route are.
      const bridge = mids.length ? 0.35 + 0.65 * bridgeSpecificity(index, mids) : 1;

      // Every factor except the semantic one, which is the only expensive term:
      // it needs a cosine over two 1536-dimension embeddings, and at three hops
      // this loop reaches ~830k pairs.
      //
      // `cosineDistance` is clamped to 0..1, so `semanticFactor` can never
      // exceed 1 — which makes this an EXACT early exit rather than a heuristic:
      // a pair whose structural product already sits below `minScore` cannot be
      // lifted over it by any embedding, so its cosine is never worth computing.
      // Roughly nineteen in twenty pairs leave here.
      const structural =
        proximity * novelty * communityFactor * typeFactor * rarity * connectorRarity * bridge;
      if (structural < minScore) continue;

      const dist = semanticDistance(ctx, a, b);
      // Unknown semantic distance is treated as neutral, never as evidence.
      const semanticFactor = dist === null ? 0.6 : 0.25 + 0.75 * dist;

      const score = structural * semanticFactor;
      if (score < minScore) continue;

      const reasons: string[] = [];
      if (crossCommunity) reasons.push('joins two separate clusters');
      if (shared === 0) reasons.push('shares no other context');
      else if (shared === 1) reasons.push('shares only one connection');
      if (dist !== null && dist > 0.5) reasons.push('unrelated subject matter');
      if (expected < 0.05) reasons.push('neither is a hub');
      if (mids.length && bridgeSpecificity(index, mids) > 0.6) {
        const names = mids.map((u) => index.byId.get(u)?.name).filter(Boolean);
        if (names.length) reasons.push(`connected only through ${names.join(' → ')}`);
      }
      if (crossType) reasons.push(`links a ${nodeA.typeName} to a ${nodeB.typeName}`);
      if (hops === 1) reasons.push('directly connected');
      else reasons.push(`${hops} hops apart`);

      out.push({
        a,
        b,
        hops,
        score,
        reasons,
        crossCommunity,
        crossType,
        sharedNeighbours: shared,
        semanticDistance: dist,
        via: mids,
      });
    }
  }

  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/**
 * Pairs that are NOT connected but look like they should be — high Adamic-Adar
 * (several niche connections in common) with no edge between them. These are
 * either a relationship the extractor missed or a real-world link nobody has
 * written down yet; either way it is a question worth asking.
 */
export function predictMissingLinks(
  ctx: SurpriseContext,
  opts: { limit?: number; minScore?: number } = {},
): PredictedLink[] {
  const limit = opts.limit ?? 20;
  const minScore = opts.minScore ?? 0.6;
  const { index } = ctx;

  const seen = new Set<string>();
  const out: PredictedLink[] = [];

  for (const a of index.ids) {
    // Only nodes with enough structure to say anything about.
    if ((index.degree.get(a) ?? 0) < 2) continue;
    // Candidates are exactly the nodes two hops away: they share a neighbour
    // with `a` by construction, and are not already adjacent to it.
    const twoHop = hopNeighbourhood(index, a, 2);

    for (const [b, hops] of twoHop) {
      if (hops !== 2) continue;
      if ((index.degree.get(b) ?? 0) < 2) continue;
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      // Already ruled out by the user — never propose it again.
      if (ctx.suppressedPairs?.has(key)) continue;

      const score = adamicAdar(index, a, b);
      if (score < minScore) continue;

      const shared = commonNeighbours(index, a, b);
      const names = shared
        .map((id) => index.byId.get(id)?.name)
        .filter((n): n is string => Boolean(n));

      out.push({
        a,
        b,
        score,
        sharedNeighbours: shared,
        reason:
          names.length === 1
            ? `Both connect to ${names[0]}, but not to each other`
            : `Share ${names.length} connections (${names.slice(0, 3).join(', ')}) but are not linked`,
      });
    }
  }

  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** Entities holding a cluster together — high internal, low external linkage. */
export function findBridges(
  ctx: SurpriseContext,
  opts: { limit?: number } = {},
): Array<{ id: string; communitiesJoined: number[]; score: number }> {
  const { index, membership } = ctx;
  const out: Array<{ id: string; communitiesJoined: number[]; score: number }> = [];

  for (const id of index.ids) {
    const nbs = index.neighbours.get(id);
    if (!nbs || nbs.size < 2) continue;
    const comms = new Set<number>();
    for (const nb of nbs) {
      const c = membership.get(nb);
      if (c !== undefined) comms.add(c);
    }
    if (comms.size < 2) continue;
    // Joining many clusters through few links is the strongest broker position.
    out.push({
      id,
      communitiesJoined: [...comms].sort((a, b) => a - b),
      score: comms.size / Math.log2(nbs.size + 1),
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 15);
}

/** Node record helper for callers assembling API payloads. */
export function describe(index: AdjacencyIndex, id: string): GraphNode | null {
  return index.byId.get(id) ?? null;
}
