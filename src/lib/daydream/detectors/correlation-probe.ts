// The speculative one, and the one most able to embarrass everybody.
//
// Over a single person's data, spurious correlation is the DEFAULT outcome
// rather than the edge case: enough pairs of signals, and some of them line up
// by chance every time. Three constraints keep this honest, and none of them is
// optional:
//
//   1. A minimum support of n ≥ 8 co-occurrences. Below that it says nothing.
//   2. It always states its n, in the title, where it cannot be skimmed past.
//   3. It is phrased as a QUESTION and proposes nothing. A correlation this
//      cheap has not earned an imperative.
//
// It also carries the longest support gate of the eight, so in practice it is
// silent for the first couple of months regardless of what merges when.

import { ramp } from './shared';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
  type PlaceSummary,
} from '../snapshot-types';

/** Co-occurrences before a pairing may be mentioned at all. */
export const MIN_SUPPORT = 8;
/** Days of trail before any of this is worth computing. */
const MIN_TRAIL_DAYS = 42;

export interface Pairing {
  place: PlaceSummary;
  /** Visits to this place that were never followed by going in — the trail
   *  shows arrival within range but no dwell above the visit threshold. */
  passes: number;
  visits: number;
}

/** A pass is one contiguous encounter, not one polling row. */
export function countPassEpisodes(
  trail: DaydreamSnapshot['trail'],
  placeId: string,
  maxGapMins = 20,
): number {
  const matching = trail
    .filter(
      (t) =>
        t.placeId === placeId &&
        (t.mode === 'walking' || t.mode === 'active' || t.mode === 'vehicle'),
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  let episodes = 0;
  let previous: Date | null = null;
  for (const point of matching) {
    if (!previous || point.ts.getTime() - previous.getTime() > maxGapMins * 60_000) episodes++;
    previous = point.ts;
  }
  return episodes;
}

/**
 * Places the owner repeatedly goes past without stopping.
 *
 * Chosen as the first probe because it is the one pairing here that is
 * genuinely computable from the trail alone and does not need a second signal
 * to correlate against — which is exactly the property that keeps it from being
 * numerology.
 */
export function findRepeatedPasses(s: DaydreamSnapshot): Pairing[] {
  const out: Pairing[] = [];

  for (const place of s.places) {
    if (place.status !== 'active') continue;

    // Fixes that fell inside the place's radius but belonged to a moving
    // segment — near it, not at it.
    const passes = countPassEpisodes(s.trail, place.id);

    if (passes < MIN_SUPPORT) continue;
    out.push({ place, passes, visits: place.visitCount });
  }

  return out.sort((a, b) => b.passes - a.passes);
}

export const correlationProbe: Detector = {
  kind: 'correlation_probe',
  description:
    'A pairing with enough support to be worth asking about. Always states its n, always asks rather than tells.',

  readiness(s: DaydreamSnapshot) {
    if (s.trailSpanDays < MIN_TRAIL_DAYS) {
      return notReady(s.trailSpanDays, MIN_TRAIL_DAYS, 'days of trail');
    }
    const found = findRepeatedPasses(s).length;
    return found > 0
      ? ready(found, 1, 'pairings above support')
      : notReady(0, 1, 'pairings above support', `nothing has co-occurred ${MIN_SUPPORT}+ times`);
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    if (s.trailSpanDays < MIN_TRAIL_DAYS) return [];

    const pairings = findRepeatedPasses(s);
    if (pairings.length === 0) return [];

    const top = pairings[0];
    const where = top.place.label ?? 'somewhere you pass often';
    const support = ramp(top.passes, MIN_SUPPORT, 30);

    return [
      {
        kind: 'correlation_probe',
        // n in the title, deliberately — a correlation without its sample size
        // is a rumour.
        title: `You've gone past ${where} ${top.passes} times without stopping — worth a look?`,
        explanation:
          `${top.passes} passes and ${top.visits} actual visits over ${s.trailSpanDays} days of trail. ` +
          `That is a pattern with enough occurrences to mention, and nothing more than that — ` +
          `it may mean nothing at all. Tell me to drop it and I will stop noticing.`,
        // Capped low. A probe should never outrank something the owner actually
        // holds, like a voucher or a health reading.
        rawScore: Math.min(0.5, 0.25 + 0.25 * support),
        components: {
          passes: top.passes,
          visits: top.visits,
          support: top.passes,
          trailSpanDays: s.trailSpanDays,
        },
        evidence: [{ kind: 'place', id: top.place.id, note: `${top.passes} passes` }],
        placeId: top.place.id,
        // Weekly at most. A speculative question asked daily is nagging.
        dedupeKey: `correlation_probe:${top.place.id}:${isoWeek(s.now)}`,
        // Nothing proposed on purpose: a correlation this cheap has not earned
        // an imperative.
        proposedActions: [],
      },
    ];
  },
};

/** ISO week token, so a probe recurs weekly rather than daily. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
