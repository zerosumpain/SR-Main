// src/lib/daydream/hub-counts.ts
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

export interface HubCounts {
  /** Live and waiting on nobody but the owner: status `new`. */
  undecided: number;
  /** Reached him and never rated — the starved input. */
  needsRating: number;
  /** Verdicts with no memory behind them. */
  unrememberedRulings: number;
  /** Unnamed active places at or over the ask threshold, by distinct days. */
  needsNaming: number;
  places: number;
  namedPlaces: number;
  unnamedPlaces: number;
  thoughts7d: number;
  thoughtsAll: number;
  held: number;
  proposedRules: number;
  /** Daydream heartbeat rows in trouble: failures counted or paused. */
  failingJobs: number;
  jobs: number;
  activeWatches: number;
  engine: EngineState;
  threshold: { value: number; feedbackCount: number };
}


export async function loadHubCounts(opts: { activeWatches?: number } = {}): Promise<HubCounts> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [thoughtRows, placeRows, ruleRows, jobRows, engine, threshold] = await Promise.all([
    db
      .select({
        undecided: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'new')::int`,
        needsRating: sql<number>`count(*) filter (where ${daydreamThoughts.status} in ('delivered','seen','actioned') and ${daydreamThoughts.feedback} is null)::int`,
        unremembered: sql<number>`count(*) filter (where ${daydreamThoughts.reviewVerdict} is not null and ${daydreamThoughts.reviewMemoryId} is null)::int`,
        held: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'suppressed')::int`,
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
  ]);
  const t = thoughtRows[0];
  const p = placeRows[0];
  return {
    undecided: t?.undecided ?? 0,
    needsRating: t?.needsRating ?? 0,
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
  };
}

/** The shape every room returns when the counts cannot be read. Every key
 *  present, so the layout's union type keeps its properties. */
export function emptyHubCounts(): HubCounts {
  return {
    undecided: 0,
    needsRating: 0,
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
  };
}

export const HUB_BASE = '/jkai/daydreams';

/** One tab in the rail. Structurally the shell's `ShellTab`, declared here so
 *  the domain layer never imports a UI module (the boundary gate). */
export interface HubTab {
  id: RoomId;
  label: string;
  href: string;
  count?: number;
  tone?: 'action' | 'watch' | 'quiet';
}

/** The eleven rooms, in rail order, each a real route. */
export const ROOMS = [
  'feed',
  'memory',
  'briefing',
  'watches',
  'family',
  'discoveries',
  'calendar',
  'places',
  'money',
  'engine',
  'improvement',
] as const;
export type RoomId = (typeof ROOMS)[number];

export function isRoom(s: string | null | undefined): s is RoomId {
  return !!s && (ROOMS as readonly string[]).includes(s);
}

/** PURE. The rail, with its badges. Tested so a badge can never count the
 *  wrong population without a test saying so. */
export function hubTabs(c: Pick<HubCounts,
  'needsRating' | 'unrememberedRulings' | 'activeWatches' | 'needsNaming' | 'proposedRules' | 'failingJobs'
>): HubTab[] {
  const room = (id: RoomId, label: string, extra: Partial<HubTab> = {}): HubTab => ({
    id,
    label,
    href: `${HUB_BASE}/${id}`,
    ...extra,
  });
  return [
    room('feed', 'Feed', { count: c.needsRating, tone: 'action' }),
    room('memory', 'Memory', { count: c.unrememberedRulings, tone: 'watch' }),
    room('briefing', 'Briefing'),
    room('watches', 'Watches', { count: c.activeWatches, tone: 'quiet' }),
    room('family', 'Family'),
    room('discoveries', 'Discoveries'),
    room('calendar', 'Calendar'),
    room('places', 'Places', { count: c.needsNaming, tone: 'action' }),
    room('money', 'Money'),
    room('engine', 'Engine', {
      count: c.proposedRules || c.failingJobs,
      tone: c.failingJobs ? 'watch' : 'action',
    }),
    room('improvement', 'Improvement'),
  ];
}

/** Where an old `?tab=` link lands. Unknown tabs go to the feed; the rest of
 *  the query (`?rate=`) rides along, because a notification's deep link is
 *  the one link that must keep working. */
export function legacyTabTarget(url: URL): string {
  const tab = url.searchParams.get('tab');
  const room: RoomId = isRoom(tab) ? tab : 'feed';
  const q = new URLSearchParams(url.searchParams);
  q.delete('tab');
  const qs = q.toString();
  return `${HUB_BASE}/${room}${qs ? `?${qs}` : ''}${url.hash ?? ''}`;
}
