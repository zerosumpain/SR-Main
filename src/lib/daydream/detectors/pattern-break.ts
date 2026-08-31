// "You always go there on a Tuesday. It's Tuesday evening and you haven't."
//
// The detector most exposed to the failure this whole design is arranged
// against: a dead sensor reading as a change in behaviour. It carries the
// longest support gate of the eight, and it checks coverage twice — once for
// the history that establishes the routine, once for the window in which the
// routine supposedly failed to happen.
//
// Without both checks, a homeserv outage produces a confident sentence about
// how the owner has broken a habit.

import { coveredEnough, localDayStart } from './shared';
import { coverageOf } from '../cluster';
import { MIN_COVERAGE } from '../types';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
  type PlaceSummary,
} from '../snapshot-types';

/** Days of trail before any routine claim is credible. */
const MIN_TRAIL_DAYS = 28;
/** Visits on the same weekday before it counts as a routine. */
const MIN_SAME_DAY_VISITS = 4;
/** Share of that place's visits that must fall on the one weekday. */
const DOMINANCE = 0.6;

export interface Routine {
  place: PlaceSummary;
  day: number;
  visits: number;
  share: number;
  /** Typical local hour, for "you usually go by now". */
  typicalHour: number;
}

/** Places with a strong single-weekday habit. Pure. */
export function findRoutines(places: PlaceSummary[]): Routine[] {
  const out: Routine[] = [];
  for (const p of places) {
    if (p.status !== 'active') continue;
    const total = p.dayHistogram.reduce((a, b) => a + b, 0);
    if (total < MIN_SAME_DAY_VISITS) continue;

    const peak = p.dayHistogram.indexOf(Math.max(...p.dayHistogram));
    const visits = p.dayHistogram[peak] ?? 0;
    const share = total > 0 ? visits / total : 0;
    if (visits < MIN_SAME_DAY_VISITS || share < DOMINANCE) continue;

    const hourPeak = p.hourHistogram.length
      ? p.hourHistogram.indexOf(Math.max(...p.hourHistogram))
      : 12;

    out.push({ place: p, day: peak, visits, share, typicalHour: hourPeak });
  }
  return out.sort((a, b) => b.visits - a.visits);
}

export const patternBreak: Detector = {
  kind: 'pattern_break',
  description:
    'An established weekday routine that has not happened today — and the sensor was up, so it is real.',

  readiness(s: DaydreamSnapshot) {
    if (s.trailSpanDays < MIN_TRAIL_DAYS) {
      return notReady(s.trailSpanDays, MIN_TRAIL_DAYS, 'days of trail');
    }
    const routines = findRoutines(s.places).length;
    return routines > 0
      ? ready(routines, 1, 'established routines')
      : notReady(
          0,
          1,
          'established routines',
          `no place has ${MIN_SAME_DAY_VISITS}+ visits concentrated on one weekday`,
        );
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    if (s.trailSpanDays < MIN_TRAIL_DAYS) return [];

    // Rule one: the history that established the routine has to be real.
    if (!coveredEnough(s.coverage.last7d)) return [];

    // Rule two: today has to have been observed. An unobserved day cannot
    // support "it did not happen" — only "I did not see it happen", which is
    // not worth anyone's attention.
    const dayStart = localDayStart(s.now);
    const todayCoverage = coverageOf(
      s.trail.map((t) => ({ ts: t.ts, source: t.source })),
      dayStart,
      s.now,
      s.coverage.pollIntervalMins,
    );
    if (todayCoverage < MIN_COVERAGE) return [];

    const routines = findRoutines(s.places).filter((r) => r.day === s.localDay);
    if (routines.length === 0) return [];

    const out: Candidate[] = [];

    for (const routine of routines) {
      // Only interesting once the usual hour has passed.
      if (s.localHour < routine.typicalHour + 1) continue;

      const visitedToday = s.trail.some(
        (t) => t.placeId === routine.place.id && t.ts >= dayStart,
      );
      if (visitedToday) continue;

      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

      out.push({
        kind: 'pattern_break',
        title: `No ${routine.place.label ?? 'usual stop'} today`,
        explanation:
          `${routine.visits} of the last visits to ${routine.place.label ?? 'this place'} were on a ` +
          `${days[routine.day]}, usually around ${routine.typicalHour}:00. Today is ` +
          `${days[s.localDay]} and it has not happened. The trail covered ` +
          `${Math.round(todayCoverage * 100)}% of today, so this is an absence rather than a blind spot.`,
        rawScore: Math.min(0.7, 0.3 + 0.4 * routine.share),
        components: {
          visits: routine.visits,
          share: Math.round(routine.share * 100) / 100,
          typicalHour: routine.typicalHour,
          todayCoverage: Math.round(todayCoverage * 100) / 100,
          weekCoverage: Math.round(s.coverage.last7d * 100) / 100,
        },
        evidence: [
          { kind: 'place', id: routine.place.id, note: routine.place.label ?? '' },
          { kind: 'trail', id: `coverage:${s.localDate}`, note: `${Math.round(todayCoverage * 100)}%` },
        ],
        placeId: routine.place.id,
        dedupeKey: `pattern_break:${routine.place.id}:${s.localDate}`,
        proposedActions: [],
      });
    }

    return out.slice(0, 1);
  },
};
