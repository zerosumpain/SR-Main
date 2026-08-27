// src/lib/daydream/rules/backtest.ts
//
// "How often would this have gone off last month?"
//
// The single most useful thing to know about a proposed rule, and the one gate
// that needs no human judgement: a rule that would have fired forty times a
// week is noise whatever it claims to detect, and it can be refused without
// anyone reading it.
//
// ── The honest caveat, which is load-bearing ─────────────────────────────────
//
// The replay reconstructs a snapshot from the TRAIL and the PLACE GRAPH at
// hourly intervals. Those it can rebuild exactly. It cannot rebuild what the
// calendar said last Tuesday, or what the offer index held before it existed,
// so those facts come back null — and a condition on a null is FALSE, so a rule
// that depends on them fires LESS in replay than it would live.
//
// For a noise gate that is the dangerous direction to be wrong in. So any rule
// referencing a fact the replay could not reconstruct is flagged
// `lowerBound: true`, its estimate is reported as a floor rather than a count,
// and it can never be auto-anything. Quietly returning an under-estimate as if
// it were a measurement is exactly how a gate goes green for the wrong reason.

import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { coverageOf } from '../cluster';
import { DEFAULT_SUBJECT, LOCAL_TZ } from '../types';
import { extractFacts } from './facts';
import { evaluateRule } from './evaluate';
import type { DaydreamSnapshot, PlaceSummary, TrailPoint } from '../snapshot-types';
import type { Condition, FactKey, RuleSpec } from './spec';

/** Facts the replay can rebuild from stored history. Everything else is null. */
export const REPLAYABLE_FACTS: ReadonlySet<FactKey> = new Set([
  'localHour',
  'localDay',
  'isWeekday',
  'isHome',
  'mode',
  'atPlaceKind',
  'atPlaceIsNamed',
  'minutesAtCurrentPlace',
  'nearestPlaceDistanceM',
  'nearestPlaceKind',
  'positionAgeMins',
  'trailSpanDays',
  'coverage24h',
  'coverage7d',
  'unnamedPlaceCount',
  // familyTracked/familyAtHome are deliberately NOT here yet: the replay
  // rebuilds the owner's snapshot only, so a family rule replays as null →
  // fires LESS than live → flagged lowerBound, the safe direction for a
  // noise gate. Replaying the household is work for when a rule earns it.
]);

/** More than this in a week is noise, whatever it claims to detect. */
export const MAX_FIRES_PER_WEEK = 14;

export interface BacktestResult {
  fires: number;
  samples: number;
  days: number;
  firesPerWeek: number;
  lowerBound: boolean;
  /** Facts the rule uses that the replay could not reconstruct. */
  missingFacts: string[];
  note: string;
  /** Auto-refusal, before any human looks. */
  tooNoisy: boolean;
}

/** Every fact a spec touches, condition and score terms alike. */
export function factsUsed(spec: RuleSpec): FactKey[] {
  const found = new Set<FactKey>();
  const walk = (c: Condition) => {
    if ('all' in c) c.all.forEach(walk);
    else if ('any' in c) c.any.forEach(walk);
    else if ('not' in c) walk(c.not);
    else found.add(c.fact);
  };
  walk(spec.when);
  for (const t of spec.terms) found.add(t.fact);
  return [...found];
}

function localParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TZ,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const day = Math.max(0, order.indexOf(get('weekday')));
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    localDay: day,
    localHour: Number(get('hour')) % 24,
    isWeekday: day <= 4,
  };
}

/**
 * A snapshot as it would have looked at `at`, from stored history only.
 *
 * Unreconstructible sources are marked `unavailable` rather than `empty`, which
 * is what makes their facts come back null instead of zero — the same
 * distinction the live snapshot draws, and for the same reason.
 */
function snapshotAt(
  at: Date,
  allTrail: TrailPoint[],
  places: PlaceSummary[],
  firstTs: Date,
): DaydreamSnapshot {
  const window = allTrail.filter((t) => t.ts <= at && t.ts >= new Date(at.getTime() - 30 * 86_400_000));
  const positioned = window.filter((t) => t.lat != null);
  const last = positioned[positioned.length - 1];

  const cov = (hours: number) =>
    coverageOf(
      window.map((t) => ({ ts: t.ts, source: t.source })),
      new Date(at.getTime() - hours * 3_600_000),
      at,
    );

  return {
    now: at,
    ...localParts(at),
    current: last
      ? {
          ts: last.ts,
          lat: last.lat as number,
          lon: last.lon as number,
          mode: last.mode,
          isHome: last.isHome,
          placeId: last.placeId,
          accuracyM: last.accuracyM,
          ageMins: Math.max(0, Math.round((at.getTime() - last.ts.getTime()) / 60000)),
        }
      : null,
    trail: window,
    trailDays: 30,
    trailSpanDays: Math.floor((at.getTime() - firstTs.getTime()) / 86_400_000),
    places,
    coverage: { last24h: cov(24), last7d: cov(24 * 7) },
    health: {
      lastNightSleep: null,
      sleepBaseline: null,
      readiness: null,
      daysSinceWorkout: null,
      trainingLoad: null,
    },
    calendar: { events: [], partial: false, available: false },
    interests: [],
    offers: { available: false, items: [] },
    memories: [],
    // Replay is the owner's world only; a family rule read against this
    // snapshot sees `available: false` and its facts stay null (lowerBound).
    family: { available: false, members: [] },
    sources: [{ key: 'replay', status: 'ok', detail: 'trail and places only' }],
  };
}

/**
 * Replay a rule over stored history, hourly.
 *
 * Hourly rather than per-fix: the live detect tick is every ten minutes, so an
 * hourly replay under-counts by up to 6×. That is corrected for in
 * `firesPerWeek` rather than left as a hidden discount — an estimate that
 * quietly flatters a rule is worse than no estimate.
 */
export async function backtestRule(
  spec: RuleSpec,
  opts: { days?: number; subject?: string; now?: Date } = {},
): Promise<BacktestResult> {
  const days = opts.days ?? 30;
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  const used = factsUsed(spec);
  const missingFacts = used.filter((f) => !REPLAYABLE_FACTS.has(f));

  const trail = (await db
    .select({
      id: daydreamTrail.id,
      ts: daydreamTrail.ts,
      source: daydreamTrail.source,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      mode: daydreamTrail.mode,
      isHome: daydreamTrail.isHome,
      placeId: daydreamTrail.placeId,
      accuracyM: daydreamTrail.accuracyM,
    })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.subject, subject), gte(daydreamTrail.ts, since)))
    .orderBy(asc(daydreamTrail.ts))) as TrailPoint[];

  if (trail.length === 0) {
    return {
      fires: 0,
      samples: 0,
      days,
      firesPerWeek: 0,
      lowerBound: true,
      missingFacts,
      note: 'no trail to replay against — this estimate means nothing',
      tooNoisy: false,
    };
  }

  const places = (await db.select().from(daydreamPlaces)) as unknown as PlaceSummary[];
  const firstTs = trail[0].ts;

  let fires = 0;
  let samples = 0;
  for (let t = since.getTime(); t <= now.getTime(); t += 3_600_000) {
    const snap = snapshotAt(new Date(t), trail, places, firstTs);
    if (snap.trailSpanDays < spec.minTrailDays) continue;
    samples++;
    if (evaluateRule(spec, extractFacts(snap)).fired) fires++;
  }

  // An hourly sample against a ten-minute tick. The correction is applied and
  // stated rather than silently omitted.
  const TICKS_PER_SAMPLE = 6;
  const observedDays = Math.max(1, samples / 24);
  const firesPerWeek = Math.round((fires / observedDays) * 7 * TICKS_PER_SAMPLE * 10) / 10;

  const lowerBound = missingFacts.length > 0;
  const noteParts = [
    `${fires} fires across ${samples} hourly samples over ${Math.round(observedDays)} days`,
    `≈${firesPerWeek}/week once scaled to the 10-minute tick`,
  ];
  if (lowerBound) {
    noteParts.push(
      `LOWER BOUND — the replay could not reconstruct ${missingFacts.join(', ')}, so live firing will be higher`,
    );
  }

  return {
    fires,
    samples,
    days,
    firesPerWeek,
    lowerBound,
    missingFacts,
    note: noteParts.join('. '),
    // A lower-bound estimate that is ALREADY too noisy is still a refusal —
    // it can only get worse.
    tooNoisy: firesPerWeek > MAX_FIRES_PER_WEEK,
  };
}
