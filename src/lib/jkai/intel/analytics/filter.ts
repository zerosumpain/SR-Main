// Which nodes survive the graph filters.
//
// Pure, like the rest of this directory: it takes the built index and a filter
// description and returns a set of ids, so it is unit-testable without a
// database and the same rules can be reused by anything that draws the graph.
//
// The ordering matters and is not arbitrary:
//
//   1. `entities` / `focus` pick a STARTING REGION of the graph.
//   2. `q` and `categories` narrow WHICH nodes in that region are wanted.
//   3. keyword matches are then re-expanded by `qHops`.
//
// Step 3 is the part that makes a keyword filter useful on a network rather
// than a list. Filtering to the literal matches leaves isolated dots with no
// edges between them, which answers nothing about how the matched things
// relate — the question the graph exists to answer. Expanding one hop around
// each match restores the connective tissue while keeping the view small, and
// `matched` comes back separately so the client can still show which nodes were
// the actual hits.
import type { AdjacencyIndex, GraphEdge, GraphNode } from './model';
import { hopNeighbourhood } from './model';

/**
 * Which clock the time window is measured against.
 *
 * Two, not one, because "show me what's new" and "show me what's changed" are
 * different questions and the graph can answer both:
 *
 *  - `added` — when the row entered the graph. Consistent across nodes and
 *    edges: both are `created_at`, both ingest clocks.
 *  - `updated` — when the row last changed.
 *
 * The honest caveat, because it will bite whoever reads this next:
 * `intel_relationships` has NO `updated_at` column — only `created_at` and
 * `last_seen_at`. So under `updated` an edge is measured on the later of those
 * two, and `last_seen_at` is an OBSERVATION clock (the mail's own date), not an
 * ingest one. A three-week-old email swept last night updates its edge last
 * night but stamps it three weeks ago, so it will not appear in a
 * "changed today" window. Nodes do not have this problem — `intel_entities`
 * has a real `updated_at`. See reference_intel_ingest_clock_vs_observation_clock:
 * whenever two clocks disagree, say which one you are using.
 */
export type GraphClock = 'added' | 'updated';

/** The timestamp a node is judged on under `clock`, epoch ms. 0 = unknown. */
export function nodeTimeUnder(node: GraphNode, clock: GraphClock): number {
  return clock === 'updated' ? Math.max(node.updatedAt || 0, node.createdAt || 0) : node.createdAt || 0;
}

/** The timestamp an edge is judged on under `clock`, epoch ms. 0 = unknown. */
export function edgeTimeUnder(edge: GraphEdge, clock: GraphClock): number {
  return clock === 'updated' ? Math.max(edge.lastSeenAt || 0, edge.createdAt || 0) : edge.createdAt || 0;
}

/**
 * Is `t` inside the window? An unknown timestamp (0) is OUT whenever a window
 * is set — a row with no date cannot honestly be claimed as recent.
 */
export function inWindow(t: number, since?: number | null, until?: number | null): boolean {
  if (!t) return false;
  if (since != null && t < since) return false;
  if (until != null && t > until) return false;
  return true;
}

export interface GraphFilter {
  typeId?: string | null;
  /**
   * Several entity types at once; a node passes if it carries ANY of them.
   *
   * `typeId` stays because deep links from entity cards and saved views carry
   * it, and the two intersect rather than replace: a request naming both is
   * asking for the one type AND one of the several, which is empty unless they
   * agree. That is the honest reading, and nothing sends both.
   */
  typeIds?: string[];
  communityId?: number | null;
  minDegree?: number;
  focusId?: string | null;
  hops?: number;
  /** Free text over name, aliases, summary and type name. */
  q?: string | null;
  /** How far to expand around a keyword hit. 0 = matches only. */
  qHops?: number;
  /** ER category slugs; a node passes if it carries ANY of them. */
  categories?: string[];
  /**
   * Note sources ('email', 'file', 'research', …); a node passes if ANY of the
   * notes asserting it came from one of them. Empty means no source filter —
   * NOT "exclude everything" — so the default view is the whole graph.
   */
  sources?: string[];
  /** Restrict to these entity ids (before keyword expansion). */
  entityIds?: string[];
  /** Window start, epoch ms. Null/undefined = open-ended. */
  since?: number | null;
  /** Window end, epoch ms. Null/undefined = open-ended. */
  until?: number | null;
  /** Which clock `since`/`until` are measured on. Default `updated`. */
  clock?: GraphClock;
}

export interface FilterResult {
  keep: Set<string>;
  /** Nodes that literally matched `q`; empty when no keyword was given. */
  matched: string[];
  /**
   * Edges inside the time window, when one is set. Reported so the renderers
   * can pick the recent connections out of the ones that merely came along as
   * endpoints — the same reason `matched` is reported separately from `keep`.
   */
  recentEdges: string[];
  /** Nodes whose OWN clock is inside the window, as opposed to endpoints. */
  recentNodes: string[];
}

/** Case-insensitive substring test over everything worth searching on a node. */
export function nodeMatches(node: GraphNode, needle: string): boolean {
  if (!needle) return true;
  const haystacks = [node.name, node.summary ?? '', node.typeName, ...(node.aliases ?? [])];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

export function applyGraphFilter(
  index: AdjacencyIndex,
  community: Map<string, number>,
  filter: GraphFilter,
): FilterResult {
  const hops = clamp(filter.hops ?? 2, 1, 5);
  const qHops = clamp(filter.qHops ?? 1, 0, 3);
  const minDegree = Math.max(filter.minDegree ?? 0, 0);
  const needle = (filter.q ?? '').trim().toLowerCase();
  const categories = (filter.categories ?? []).filter(Boolean);
  const sources = (filter.sources ?? []).filter(Boolean);

  let keep = new Set(index.ids);

  // 1. Starting region.
  if (filter.entityIds && filter.entityIds.length > 0) {
    const wanted = new Set(filter.entityIds);
    keep = new Set([...keep].filter((id) => wanted.has(id)));
  }
  if (filter.focusId && index.byId.has(filter.focusId)) {
    const near = new Set(hopNeighbourhood(index, filter.focusId, hops).keys());
    keep = new Set([...keep].filter((id) => near.has(id)));
  }

  // 2. Attribute filters.
  if (filter.typeId) {
    keep = new Set([...keep].filter((id) => index.byId.get(id)?.typeId === filter.typeId));
  }
  if (filter.typeIds?.length) {
    const wanted = new Set(filter.typeIds);
    keep = new Set([...keep].filter((id) => {
      const t = index.byId.get(id)?.typeId;
      return t ? wanted.has(t) : false;
    }));
  }
  if (filter.communityId !== null && filter.communityId !== undefined) {
    keep = new Set([...keep].filter((id) => community.get(id) === filter.communityId));
  }
  if (categories.length > 0) {
    keep = new Set(
      [...keep].filter((id) => {
        const on = index.byId.get(id)?.categories ?? [];
        return categories.some((c) => on.includes(c));
      }),
    );
  }
  if (sources.length > 0) {
    keep = new Set(
      [...keep].filter((id) => {
        const on = index.byId.get(id)?.sources ?? [];
        // A source filter now filters, with no exemption.
        //
        // This used to keep any entity with no recorded source, so that the
        // picker could not silently delete history — reasonable when an entity's
        // sources came only from its note links, which 561 of 4,737 entities did
        // not have. The effect was that those 561 appeared under EVERY source:
        // asking for 'email' returned entities whose only footprint was a deep
        // dive. `loadSnapshot` now falls back to `first_seen_in`, so every entity
        // carries the source it actually came from and the exemption protects
        // nothing. An entity reaching here with no source at all is a data
        // defect, and hiding it from a filtered view is the honest answer.
        return sources.some((s) => on.includes(s));
      }),
    );
  }
  // 2b. The time window.
  //
  // Applied to nodes AND edges, and the union is what survives — not the nodes
  // alone. A brand-new edge between two entities you have known for months is
  // the single most interesting thing a recency filter can surface, and
  // filtering on node timestamps alone throws exactly that away: neither
  // endpoint is recent, so the connection between them disappears at the moment
  // it appears. So an edge in the window pulls its endpoints in with it.
  //
  // `recentNodes` and `recentEdges` come back separately so the renderers can
  // draw what is genuinely new solid and the endpoints that came along dimmed —
  // the same treatment `matched` gets for a keyword.
  const windowed = filter.since != null || filter.until != null;
  const recentNodes: string[] = [];
  const recentEdges: string[] = [];
  if (windowed) {
    const clock = filter.clock ?? 'updated';
    for (const id of keep) {
      const node = index.byId.get(id);
      if (node && inWindow(nodeTimeUnder(node, clock), filter.since, filter.until)) {
        recentNodes.push(id);
      }
    }

    const withEndpoints = new Set(recentNodes);
    for (const edges of index.edgesBetween.values()) {
      for (const edge of edges) {
        // Both endpoints must have survived the attribute filters above, or a
        // time window would leak back nodes a source or category filter had
        // deliberately excluded.
        if (!keep.has(edge.source) || !keep.has(edge.target)) continue;
        if (!inWindow(edgeTimeUnder(edge, clock), filter.since, filter.until)) continue;
        recentEdges.push(edge.id);
        withEndpoints.add(edge.source);
        withEndpoints.add(edge.target);
      }
    }
    keep = withEndpoints;
  }

  if (minDegree > 0) {
    keep = new Set([...keep].filter((id) => (index.degree.get(id) ?? 0) >= minDegree));
  }

  // 3. Keyword, plus its neighbourhood.
  let matched: string[] = [];
  if (needle) {
    matched = [...keep].filter((id) => {
      const node = index.byId.get(id);
      return node ? nodeMatches(node, needle) : false;
    });

    const expanded = new Set(matched);
    if (qHops > 0) {
      for (const id of matched) {
        for (const neighbour of hopNeighbourhood(index, id, qHops).keys()) {
          // Neighbours are added even if they failed the keyword test, but they
          // must still respect the attribute filters above — otherwise a
          // category filter would leak nodes back in through the expansion.
          if (keep.has(neighbour)) expanded.add(neighbour);
        }
      }
    }
    keep = expanded;
  }

  return {
    keep,
    matched,
    // Trimmed to what actually survived: `minDegree` and the keyword step run
    // after the window, and reporting a node as recent after it has been
    // filtered out would make the counts disagree with the picture.
    recentNodes: recentNodes.filter((id) => keep.has(id)),
    recentEdges,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Parse a comma-separated query parameter into a trimmed, de-duplicated list. */
export function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}
