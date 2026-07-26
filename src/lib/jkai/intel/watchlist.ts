// The watchlist — structural change alarms for entities you have said matter.
//
// Every other intel surface answers "what does the graph look like now". None
// of them answer "what moved". A snapshot is worthless for that on its own: the
// only useful signal is the DIFF between two of them, and a diff needs a
// yesterday that survived a process restart. So a watch run reads the current
// structure of every watched entity, compares it against the last run's stored
// snapshot, and turns the differences into insights that can be dismissed and
// snoozed like any other finding.
//
// Two decisions are worth knowing about before changing anything here:
//
//  1. Community identity is an ANCHOR, not an index. Louvain hands out
//     arbitrary integer labels — the same partition can come back as {0,1,2} or
//     {2,0,1} on the next run — so comparing raw indices would report every
//     watched entity as having "moved cluster" on most nights. The snapshot
//     stores the lexicographically smallest member id of the entity's
//     community instead, which is stable under relabelling.
//
//  2. `diffWatched` is pure and takes both snapshots. It has no clock and no
//     DB, so every alarm rule is unit-testable without intel data, which is the
//     only way this is trustworthy — an alarm nobody can test is an alarm
//     nobody will believe.
//
// `$lib/db`, `$lib/server/models/settings` and `analytics/load` are imported
// dynamically: they reach `$env/dynamic/private`, which does not resolve under
// vitest, and the diff below is unit-tested. Same reason as entity-query.ts.
import { and, eq, isNull } from 'drizzle-orm';
import { intelEntities } from '$lib/db/schema';
import { brokerageScore } from './analytics/centrality';
import {
  persistInsights,
  EMPTY_PERSIST_RESULT,
  type PersistResult,
  type StorableInsight,
} from './insight-store';

/** app_settings key holding the previous run's structural snapshot. */
export const WATCHLIST_SNAPSHOT_KEY = 'intel.watchlist.snapshot';

// ── Snapshot shape ───────────────────────────────────────────────────────────

export interface WatchedNeighbour {
  id: string;
  name: string;
  /** 0..1 — PageRank relative to the graph's most important entity. */
  importance: number;
}

export interface WatchedSnapshotEntry {
  id: string;
  name: string;
  degree: number;
  /**
   * The lexicographically smallest member of this entity's community. See the
   * header: Louvain's own labels are not comparable between runs.
   */
  communityKey: string;
  communitySize: number;
  /** Betweenness per unit of degree — brokerage, 0..1-ish and graph-relative. */
  brokerage: number;
  /** Whether this entity currently occupies a broker position. */
  broker: boolean;
  /** Stored confidence 0..1, or null if the entity has never been scored. */
  confidence: number | null;
  /** Most important neighbours, capped — the "who it hangs off" fingerprint. */
  neighbours: WatchedNeighbour[];
}

export interface WatchlistSnapshot {
  /** Epoch ms. */
  takenAt: number;
  entities: WatchedSnapshotEntry[];
}

// ── Change shape ─────────────────────────────────────────────────────────────

export const WATCH_CHANGE_KINDS = [
  'degree_jump',
  'degree_collapse',
  'community_move',
  'new_important_neighbour',
  'became_broker',
  'ceased_broker',
  'confidence_drop',
  'appeared',
  'disappeared',
] as const;

export type WatchChangeKind = (typeof WATCH_CHANGE_KINDS)[number];

export interface WatchChange {
  entityId: string;
  entityName: string;
  kind: WatchChangeKind;
  /** 0..1. Drives both ordering and the persisted insight's score. */
  severity: number;
  /** Plain English, no jargon — this is what gets read at 7am. */
  sentence: string;
  /** The numbers behind `severity`, so a card never shows an unexplained score. */
  components: Record<string, number>;
  /** Other entities the change is about (the new neighbour, typically). */
  relatedIds: string[];
  relatedNames: string[];
}

/**
 * Kinds that raise an insight. `appeared` is deliberately excluded: putting an
 * entity on the watchlist is something you just did on purpose, so telling you
 * about it is noise, not news. It still comes back in the change list so the UI
 * can show the baseline it recorded.
 */
export const ALARM_KINDS: ReadonlySet<WatchChangeKind> = new Set(
  WATCH_CHANGE_KINDS.filter((k) => k !== 'appeared'),
);

/** Every insight kind this module can produce — the watchlist's slice of the table. */
export const WATCH_INSIGHT_KINDS: readonly string[] = WATCH_CHANGE_KINDS.map((k) => `watch_${k}`);

// ── Thresholds ───────────────────────────────────────────────────────────────
//
// Every threshold is BOTH relative and absolute. Relative alone fires on noise
// in the tail (1 → 2 connections is a 100% jump and means nothing); absolute
// alone never fires on a small entity and fires constantly on a hub.

/** A jump must be at least half again as many connections… */
export const DEGREE_JUMP_RATIO = 1.5;
/** …and at least this many in absolute terms. */
export const DEGREE_JUMP_MIN = 3;
/** A collapse must lose at least this share of the connections… */
export const DEGREE_COLLAPSE_RATIO = 0.6;
/** …and at least this many. */
export const DEGREE_COLLAPSE_MIN = 3;
/** A new neighbour is worth an alarm only above this share of top PageRank. */
export const IMPORTANT_NEIGHBOUR_MIN = 0.5;
/** Confidence has to fall by this much before the evidence is "weakening". */
export const CONFIDENCE_DROP_MIN = 0.15;
/** Neighbours kept in the snapshot fingerprint. */
export const MAX_SNAPSHOT_NEIGHBOURS = 8;
/** Brokerage percentile above which an entity counts as a broker. */
export const BROKER_PERCENTILE = 0.9;

// ── Pure helpers ─────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Severities are rounded before they become insight scores. The dedupe key
 * buckets by score, and an unrounded float carries floating-point noise that
 * serves no purpose in a key meant to be stable.
 */
function severity(n: number): number {
  return Math.round(clamp01(n) * 1000) / 1000;
}

/** Value at percentile `p` of an ASCENDING sorted array. Empty → 0. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (!sortedAscending.length) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.floor(sortedAscending.length * clamp01(p)));
  return sortedAscending[idx];
}

/**
 * community index → { key, size }, where key is the smallest member id.
 *
 * Pure and exported because it is the load-bearing part of decision (1) in the
 * header: get this wrong and every watched entity reports a cluster move on
 * every run.
 */
export function communityAnchors(
  communities: ReadonlyMap<number, string[]>,
): Map<number, { key: string; size: number }> {
  const out = new Map<number, { key: string; size: number }>();
  for (const [idx, members] of communities) {
    if (!members.length) continue;
    let smallest = members[0];
    for (const m of members) if (m < smallest) smallest = m;
    out.set(idx, { key: smallest, size: members.length });
  }
  return out;
}

function pct(from: number, to: number): number {
  if (from <= 0) return 100;
  return Math.round(((to - from) / from) * 100);
}

function listNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

// ── The diff ─────────────────────────────────────────────────────────────────

function change(
  entry: WatchedSnapshotEntry,
  kind: WatchChangeKind,
  sev: number,
  sentence: string,
  components: Record<string, number>,
  related: readonly WatchedNeighbour[] = [],
): WatchChange {
  return {
    entityId: entry.id,
    entityName: entry.name,
    kind,
    severity: severity(sev),
    sentence,
    components,
    relatedIds: related.map((r) => r.id),
    relatedNames: related.map((r) => r.name),
  };
}

function diffEntry(prev: WatchedSnapshotEntry, cur: WatchedSnapshotEntry): WatchChange[] {
  const out: WatchChange[] = [];
  const gained = cur.degree - prev.degree;

  if (gained >= DEGREE_JUMP_MIN && cur.degree >= prev.degree * DEGREE_JUMP_RATIO) {
    const opening =
      prev.degree === 0
        ? `${cur.name} went from no connections at all to ${cur.degree}.`
        : `${cur.name} went from ${prev.degree} connections to ${cur.degree} — a ${pct(prev.degree, cur.degree)}% jump.`;
    out.push(
      change(
        cur,
        'degree_jump',
        0.4 + Math.min(0.4, (gained / Math.max(1, prev.degree)) * 0.3),
        `${opening} Something is pulling it towards the centre of things.`,
        { previousDegree: prev.degree, currentDegree: cur.degree, gained },
      ),
    );
  } else if (-gained >= DEGREE_COLLAPSE_MIN && cur.degree <= prev.degree * DEGREE_COLLAPSE_RATIO) {
    const opening =
      cur.degree === 0
        ? `${cur.name} has lost all ${prev.degree} of its connections.`
        : `${cur.name} dropped from ${prev.degree} connections to ${cur.degree}.`;
    out.push(
      change(
        cur,
        'degree_collapse',
        // Rated above a comparable jump on purpose: gaining links adds to the
        // picture, losing them puts a hole in one you were already relying on.
        0.55 + (-gained / Math.max(1, prev.degree)) * 0.4,
        `${opening} Either those links were wrong and have been cleaned up, or your picture of it has just lost most of its substance.`,
        { previousDegree: prev.degree, currentDegree: cur.degree, lost: -gained },
      ),
    );
  }

  // Only meaningful once BOTH snapshots carry an anchor: an entity that was
  // outside the graph on one side has no cluster to have moved between.
  if (prev.communityKey && cur.communityKey && prev.communityKey !== cur.communityKey) {
    out.push(
      change(
        cur,
        'community_move',
        0.6,
        `${cur.name} has moved cluster — it now sits with a different group of ${cur.communitySize} entities. Whatever it is associated with has changed.`,
        { previousCommunitySize: prev.communitySize, currentCommunitySize: cur.communitySize },
      ),
    );
  }

  const known = new Set(prev.neighbours.map((n) => n.id));
  const arrivals = cur.neighbours
    .filter((n) => !known.has(n.id) && n.importance >= IMPORTANT_NEIGHBOUR_MIN)
    .sort((a, b) => b.importance - a.importance);

  if (arrivals.length) {
    const top = arrivals[0];
    out.push(
      change(
        cur,
        'new_important_neighbour',
        0.4 + top.importance * 0.5,
        `${cur.name} is now connected to ${listNames(arrivals.map((a) => a.name))}, ${arrivals.length === 1 ? 'one of' : 'among'} the most important entities in the graph. That link did not exist at the last check.`,
        { arrivals: arrivals.length, topImportance: Math.round(top.importance * 100) / 100 },
        arrivals.slice(0, 3),
      ),
    );
  }

  if (!prev.broker && cur.broker) {
    out.push(
      change(
        cur,
        'became_broker',
        0.75,
        `${cur.name} has become a broker — it now sits on the only route between parts of the graph that otherwise do not connect. That makes it both important and a single point of failure.`,
        { previousBrokerage: prev.brokerage, currentBrokerage: cur.brokerage },
      ),
    );
  } else if (prev.broker && !cur.broker) {
    out.push(
      change(
        cur,
        'ceased_broker',
        0.5,
        `${cur.name} is no longer a broker — the parts of the graph it used to join now reach each other another way.`,
        { previousBrokerage: prev.brokerage, currentBrokerage: cur.brokerage },
      ),
    );
  }

  if (prev.confidence != null && cur.confidence != null) {
    const drop = prev.confidence - cur.confidence;
    if (drop >= CONFIDENCE_DROP_MIN) {
      out.push(
        change(
          cur,
          'confidence_drop',
          0.45 + Math.min(0.5, drop * 1.5),
          `Confidence in ${cur.name} fell from ${prev.confidence.toFixed(2)} to ${cur.confidence.toFixed(2)}. The evidence behind it has weakened — worth checking what changed before relying on it.`,
          {
            previousConfidence: Math.round(prev.confidence * 100) / 100,
            currentConfidence: Math.round(cur.confidence * 100) / 100,
            drop: Math.round(drop * 100) / 100,
          },
        ),
      );
    }
  }

  return out;
}

/**
 * Changes worth alarming on between two snapshots.
 *
 * PURE. No clock, no DB. A null `previous` means there is nothing to compare
 * against, which is silence rather than "everything is new" — see
 * `runWatchlistCheck`, which records the baseline instead.
 */
export function diffWatched(
  previous: WatchlistSnapshot | null | undefined,
  current: WatchlistSnapshot,
): WatchChange[] {
  if (!previous || !Array.isArray(previous.entities)) return [];

  const before = new Map(previous.entities.map((e) => [e.id, e]));
  const after = new Map(current.entities.map((e) => [e.id, e]));
  const out: WatchChange[] = [];

  for (const cur of current.entities) {
    const prev = before.get(cur.id);
    if (!prev) {
      out.push(
        change(
          cur,
          'appeared',
          0.15,
          `${cur.name} is now being watched. Baseline: ${cur.degree} connection${cur.degree === 1 ? '' : 's'}${cur.broker ? ', currently a broker' : ''}.`,
          { degree: cur.degree },
        ),
      );
      continue;
    }
    out.push(...diffEntry(prev, cur));
  }

  for (const prev of previous.entities) {
    if (after.has(prev.id)) continue;
    out.push(
      change(
        prev,
        'disappeared',
        0.35,
        `${prev.name} has dropped off the watchlist — it was unwatched, merged into another entity, or removed from the graph. It had ${prev.degree} connection${prev.degree === 1 ? '' : 's'} when last seen.`,
        { previousDegree: prev.degree },
      ),
    );
  }

  // Loudest first, then stable by name so the same run always renders the same.
  return out.sort(
    (a, b) => b.severity - a.severity || a.entityName.localeCompare(b.entityName) || a.kind.localeCompare(b.kind),
  );
}

// ── Change → insight (pure) ──────────────────────────────────────────────────

const CHANGE_LABEL: Record<WatchChangeKind, string> = {
  degree_jump: 'connections jumped',
  degree_collapse: 'connections collapsed',
  community_move: 'moved cluster',
  new_important_neighbour: 'gained an important connection',
  became_broker: 'became a broker',
  ceased_broker: 'stopped being a broker',
  confidence_drop: 'confidence dropped',
  appeared: 'added to the watchlist',
  disappeared: 'left the watchlist',
};

function actionFor(c: WatchChange): Pick<StorableInsight, 'action' | 'actionLabel' | 'actionPayload'> {
  switch (c.kind) {
    case 'new_important_neighbour':
      return {
        action: 'ask',
        actionLabel: 'Ask jkai what the link is',
        actionPayload: `${c.entityName} is now connected to ${c.relatedNames.join(', ')} in my intel graph. What is the real relationship, and does it matter?`,
      };
    case 'degree_collapse':
    case 'confidence_drop':
      return {
        action: 'review',
        actionLabel: `Review ${c.entityName}`,
        actionPayload: `/jkai/intel/entities/${c.entityId}`,
      };
    case 'community_move':
    case 'ceased_broker':
      return {
        action: 'ask',
        actionLabel: 'Ask jkai what changed',
        actionPayload: `${c.sentence} What changed around ${c.entityName} to cause that?`,
      };
    default:
      return {
        action: 'research',
        actionLabel: `Deep dive on ${c.entityName}`,
        actionPayload: `${c.entityName} — what has changed recently, and why is it becoming more central?`,
      };
  }
}

/**
 * A change becomes an insight of its own kind rather than a generic
 * "watchlist" one, so two different alarms on the same entity in the same
 * score band cannot collapse onto one dedupe key.
 */
export function changeToInsight(c: WatchChange): StorableInsight {
  return {
    kind: `watch_${c.kind}`,
    title: `${c.entityName} — ${CHANGE_LABEL[c.kind]}`,
    detail: c.sentence,
    score: c.severity,
    entityIds: [c.entityId, ...c.relatedIds],
    components: c.components,
    ...actionFor(c),
  };
}

// ── DB-bound ─────────────────────────────────────────────────────────────────

/** Current structure of every watched entity. */
export async function snapshotWatched(): Promise<WatchlistSnapshot> {
  const { db } = await import('$lib/db');
  const { getGraphAnalysis } = await import('./analytics/load');

  const [rows, analysis] = await Promise.all([
    db
      .select({
        id: intelEntities.id,
        name: intelEntities.name,
        confidenceScore: intelEntities.confidenceScore,
      })
      .from(intelEntities)
      .where(and(eq(intelEntities.watched, true), isNull(intelEntities.mergedIntoId))),
    getGraphAnalysis(),
  ]);

  const { index, centrality, community } = analysis;
  const anchors = communityAnchors(community.communities);

  // Importance is expressed relative to the graph's own top entity, so the
  // "high-importance neighbour" threshold means the same thing on a 40-entity
  // graph as on a 4,000-entity one.
  let maxRank = 0;
  for (const r of centrality.pagerank.values()) if (r > maxRank) maxRank = r;

  // Broker is a graph-relative position, not a fixed number: a hard brokerage
  // threshold would call nothing a broker on a sparse graph and everything a
  // broker on a dense one.
  const brokerages = index.ids
    .map((id) => brokerageScore(id, centrality, index))
    .filter((b) => b > 0)
    .sort((a, b) => a - b);
  const brokerFloor = percentile(brokerages, BROKER_PERCENTILE);

  const entities: WatchedSnapshotEntry[] = rows.map((row) => {
    const node = index.byId.get(row.id);
    // A watched entity absent from the analysis snapshot (merged or deleted
    // between the two reads) records as structurally empty rather than being
    // dropped, so it does not masquerade as "disappeared" on the next diff.
    if (!node) {
      return {
        id: row.id,
        name: row.name,
        degree: 0,
        communityKey: '',
        communitySize: 0,
        brokerage: 0,
        broker: false,
        confidence: row.confidenceScore ?? null,
        neighbours: [],
      };
    }

    const brokerage = brokerageScore(row.id, centrality, index);
    const anchor = anchors.get(community.membership.get(row.id) ?? -1);
    const neighbours = [...(index.neighbours.get(row.id) ?? [])]
      .map((id) => ({
        id,
        name: index.byId.get(id)?.name ?? id,
        importance: maxRank > 0 ? (centrality.pagerank.get(id) ?? 0) / maxRank : 0,
      }))
      .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
      .slice(0, MAX_SNAPSHOT_NEIGHBOURS)
      .map((n) => ({ ...n, importance: Math.round(n.importance * 1000) / 1000 }));

    return {
      id: row.id,
      name: node.name || row.name,
      degree: index.degree.get(row.id) ?? 0,
      communityKey: anchor?.key ?? '',
      communitySize: anchor?.size ?? 0,
      brokerage: Math.round(brokerage * 1e6) / 1e6,
      broker: brokerage > 0 && brokerage >= brokerFloor,
      confidence: row.confidenceScore ?? null,
      neighbours,
    };
  });

  return { takenAt: Date.now(), entities };
}

export interface WatchlistCheckResult {
  /** True when this run only recorded a starting point and alarmed on nothing. */
  baseline: boolean;
  watched: number;
  takenAt: string;
  previousAt: string | null;
  changes: WatchChange[];
  persisted: PersistResult;
}

export async function readWatchlistSnapshot(): Promise<WatchlistSnapshot | null> {
  const { getSetting } = await import('$lib/server/models/settings');
  const stored = await getSetting<WatchlistSnapshot>(WATCHLIST_SNAPSHOT_KEY);
  if (!stored || !Array.isArray(stored.entities)) return null;
  return stored;
}

/**
 * Snapshot, diff against the last run, raise insights for what moved.
 *
 * The snapshot is written LAST and only after the insights are persisted: if
 * persistence fails, the next run compares against the same yesterday and
 * re-detects the change rather than losing it silently.
 */
export async function runWatchlistCheck(): Promise<WatchlistCheckResult> {
  const { setSetting } = await import('$lib/server/models/settings');

  const previous = await readWatchlistSnapshot();
  const current = await snapshotWatched();
  const takenAt = new Date(current.takenAt).toISOString();

  if (!previous) {
    await setSetting(WATCHLIST_SNAPSHOT_KEY, current);
    return {
      baseline: true,
      watched: current.entities.length,
      takenAt,
      previousAt: null,
      changes: [],
      persisted: { ...EMPTY_PERSIST_RESULT },
    };
  }

  const changes = diffWatched(previous, current);
  const alarms = changes.filter((c) => ALARM_KINDS.has(c.kind));
  const persisted = alarms.length
    ? await persistInsights(alarms.map(changeToInsight), `watchlist:${takenAt}`)
    : { ...EMPTY_PERSIST_RESULT };

  await setSetting(WATCHLIST_SNAPSHOT_KEY, current);

  return {
    baseline: false,
    watched: current.entities.length,
    takenAt,
    previousAt: new Date(previous.takenAt).toISOString(),
    changes,
    persisted,
  };
}

/** Put an entity on the watchlist, or take it off. Returns null if unknown. */
export async function setWatched(
  entityId: string,
  watched: boolean,
): Promise<{ id: string; name: string; watched: boolean } | null> {
  const { db } = await import('$lib/db');
  const [row] = await db
    .update(intelEntities)
    .set({ watched, updatedAt: new Date() })
    .where(eq(intelEntities.id, entityId))
    .returning({ id: intelEntities.id, name: intelEntities.name, watched: intelEntities.watched });
  return row ?? null;
}
