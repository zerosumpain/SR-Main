// src/lib/daydream/hub-counts.server.ts
//
// What the daydream hub's chrome needs on EVERY room: the rail badges, the
// cover tiles and the readout. COUNT queries and two pulse reads, nothing
// else — the same rule `/jkai/intel`'s layout follows. Anything expensive
// (the thought rows, the family trail, the hypothesis board) belongs to the
// room that renders it, or a badge would tax every room for a number.

import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamRules, daydreamThoughts, heartbeatActions } from '$lib/db/schema';
import { loadEngineState, loadThreshold, type EngineState } from './ledger';
import { MIN_VISITS_TO_ASK } from './types';
import type { BadgeCounts } from './hub';

/** The badge populations (`BadgeCounts`, in `hub.ts`) plus what the cover
 *  tiles and readout need. */
export interface HubCounts extends BadgeCounts {
  /** Live and waiting on nobody but the owner: status `new`. */
  undecided: number;
  places: number;
  namedPlaces: number;
  unnamedPlaces: number;
  thoughts7d: number;
  thoughtsAll: number;
  held: number;
  jobs: number;
  engine: EngineState;
  threshold: { value: number; feedbackCount: number };
  /** Think notes only — what the cover deck reports since the P2 rebuild. */
  think: { week: number; useful30d: number; rated30d: number; lastCycleAt: Date | null };
}


export async function loadHubCounts(opts: { activeWatches?: number } = {}): Promise<HubCounts> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [thoughtRows, placeRows, ruleRows, jobRows, engine, threshold, thinkRows] = await Promise.all([
    db
      .select({
        undecided: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'new')::int`,
        needsRating: sql<number>`count(*) filter (where ${daydreamThoughts.status} in ('delivered','seen','actioned') and ${daydreamThoughts.feedback} is null)::int`,
        unremembered: sql<number>`count(*) filter (where ${daydreamThoughts.reviewVerdict} is not null and ${daydreamThoughts.reviewMemoryId} is null)::int`,
        held: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'suppressed')::int`,
        // Think notes the feed shows and nobody has ruled on. The held-back
        // ones on the feed are those the daily cap or a route kept quiet
        // (`think/notes.ts` isOnFeed) — refuted and echoed ones never show.
        notesToRate: sql<number>`count(*) filter (where ${daydreamThoughts.kind} like 'think\\_%' and ${daydreamThoughts.feedback} is null and (${daydreamThoughts.status} in ('new','delivered','seen') or (${daydreamThoughts.status} = 'suppressed' and (${daydreamThoughts.suppressedReason} like 'feed_only%' or ${daydreamThoughts.suppressedReason} like 'notify:%' or ${daydreamThoughts.suppressedReason} like 'below_threshold%'))))::int`,
        week: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${weekAgo})::int`,
        all: sql<number>`count(*)::int`,
      })
      .from(daydreamThoughts),
    db
      .select({
        total: sql<number>`count(*)::int`,
        named: sql<number>`count(*) filter (where ${daydreamPlaces.label} is not null)::int`,
        ask: sql<number>`count(*) filter (where ${daydreamPlaces.label} is null and ${daydreamPlaces.distinctDays} >= ${MIN_VISITS_TO_ASK})::int`,
      })
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.status, 'active')),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamRules)
      .where(eq(daydreamRules.status, 'proposed')),
    db
      .select({
        total: sql<number>`count(*)::int`,
        failing: sql<number>`count(*) filter (where coalesce(${heartbeatActions.consecutiveFailures}, 0) > 0 or ${heartbeatActions.status} = 'paused')::int`,
      })
      .from(heartbeatActions)
      .where(sql`${heartbeatActions.name} like 'daydream-%'`),
    loadEngineState(),
    loadThreshold(),
    db
      .select({
        week: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${weekAgo})::int`,
        useful: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${monthAgo} and ${daydreamThoughts.feedback} = 'useful')::int`,
        rated: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${monthAgo} and ${daydreamThoughts.feedback} is not null)::int`,
        lastCycleAt: sql<Date | null>`(select ${heartbeatActions.lastRunAt} from ${heartbeatActions} where ${heartbeatActions.name} = 'daydream-think')`,
      })
      .from(daydreamThoughts)
      .where(sql`${daydreamThoughts.kind} like 'think\\_%'`),
  ]);
  const k = thinkRows[0];
  const t = thoughtRows[0];
  const p = placeRows[0];
  return {
    undecided: t?.undecided ?? 0,
    needsRating: t?.needsRating ?? 0,
    notesToRate: t?.notesToRate ?? 0,
    unrememberedRulings: t?.unremembered ?? 0,
    needsNaming: p?.ask ?? 0,
    places: p?.total ?? 0,
    namedPlaces: p?.named ?? 0,
    unnamedPlaces: (p?.total ?? 0) - (p?.named ?? 0),
    thoughts7d: t?.week ?? 0,
    thoughtsAll: t?.all ?? 0,
    held: t?.held ?? 0,
    proposedRules: ruleRows[0]?.n ?? 0,
    failingJobs: jobRows[0]?.failing ?? 0,
    jobs: jobRows[0]?.total ?? 0,
    activeWatches: opts.activeWatches ?? 0,
    engine,
    threshold,
    think: {
      week: k?.week ?? 0,
      useful30d: k?.useful ?? 0,
      rated30d: k?.rated ?? 0,
      lastCycleAt: k?.lastCycleAt ? new Date(k.lastCycleAt) : null,
    },
  };
}

/** The shape every room returns when the counts cannot be read. Every key
 *  present, so the layout's union type keeps its properties. */
export function emptyHubCounts(): HubCounts {
  return {
    undecided: 0,
    needsRating: 0,
    notesToRate: 0,
    unrememberedRulings: 0,
    needsNaming: 0,
    places: 0,
    namedPlaces: 0,
    unnamedPlaces: 0,
    thoughts7d: 0,
    thoughtsAll: 0,
    held: 0,
    proposedRules: 0,
    failingJobs: 0,
    jobs: 0,
    activeWatches: 0,
    engine: {
      lastDetectAt: null,
      lastObserveAt: null,
      coverage: null,
      trailSpanDays: null,
      sources: [],
      pausedActions: [],
      summary: null,
    },
    threshold: { value: 0, feedbackCount: 0 },
    think: { week: 0, useful30d: 0, rated30d: 0, lastCycleAt: null },
  };
}
