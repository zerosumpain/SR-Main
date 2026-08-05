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
import type { AdjacencyIndex, GraphNode } from './model';
import { hopNeighbourhood } from './model';

export interface GraphFilter {
  typeId?: string | null;
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
}

export interface FilterResult {
  keep: Set<string>;
  /** Nodes that literally matched `q`; empty when no keyword was given. */
  matched: string[];
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

  return { keep, matched };
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
