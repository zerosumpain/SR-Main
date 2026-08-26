// "You haven't trained in four days, you're working from home, and the house
//  fills up around half three."
//
// Three signals that are each useless alone. The one that only the trail can
// supply is the third: the hour the house typically stops being quiet, learned
// from the owner's own history rather than assumed.

import { coveredEnough, ramp } from './shared';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
  type TrailPoint,
} from '../snapshot-types';

/** Days without a workout before it is worth mentioning. */
const MIN_DAYS_SINCE_WORKOUT = 3;
/** Weekday observations needed before the learned hour means anything. */
const MIN_PATTERN_DAYS = 3;
/** Don't suggest a window shorter than this. */
const MIN_WINDOW_MINS = 45;

/**
 * The local hour at which the owner is typically no longer alone at home on a
 * weekday, learned from the trail.
 *
 * Approximated by the earliest hour at which their own "at home" state
 * consistently resumes after a daytime absence — a proxy for the household
 * filling up, which the trail cannot observe directly. Returns null when there
 * are not enough weekdays to say, which is the honest answer for the first
 * three weeks.
 *
 * Exported for testing: this is the number the whole suggestion hangs on, and a
 * plausible-looking wrong value here produces a confidently wrong nudge.
 */
export function learnedBusyHour(
  trail: TrailPoint[],
  localHourOf: (d: Date) => number,
  localDayOf: (d: Date) => number,
  minDays = MIN_PATTERN_DAYS,
): { hour: number; days: number } | null {
  /** dayKey → the earliest afternoon hour a home arrival was seen. */
  const arrivals = new Map<string, number>();

  let prevHome: boolean | null = null;
  let prevKey = '';

  for (const p of trail) {
    if (p.isHome == null) {
      // A gap breaks the run: we do not know whether they were home, and
      // treating unknown as "away" would invent an arrival that never happened.
      prevHome = null;
      continue;
    }
    const day = localDayOf(p.ts);
    if (day > 4) {
      prevHome = p.isHome;
      continue;
    } // weekdays only
    const hour = localHourOf(p.ts);
    const key = `${p.ts.toISOString().slice(0, 10)}`;
    if (key !== prevKey) prevHome = null;
    prevKey = key;

    // An arrival: not-home → home, in the afternoon.
    if (prevHome === false && p.isHome === true && hour >= 12 && hour <= 20) {
      const existing = arrivals.get(key);
      if (existing == null || hour < existing) arrivals.set(key, hour);
    }
    prevHome = p.isHome;
  }

  if (arrivals.size < minDays) return null;

  const hours = [...arrivals.values()].sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  const median =
    hours.length % 2 === 0 ? (hours[mid - 1] + hours[mid]) / 2 : hours[mid];

  return { hour: Math.round(median), days: arrivals.size };
}

export const freeWindow: Detector = {
  kind: 'free_window',
  description:
    'Days since the last workout, crossed with being at home on a weekday and the learned hour the house fills up.',

  readiness(s: DaydreamSnapshot) {
    if (s.health.daysSinceWorkout == null) {
      return notReady(0, 1, 'workout history', 'no workout history available');
    }
    // Needs enough weekday trail to have learned the busy hour at all.
    const learned = learnedBusyHour(s.trail, localHour, localDay);
    if (!learned) {
      return notReady(
        0,
        MIN_PATTERN_DAYS,
        'weekday afternoons observed',
        `needs ${MIN_PATTERN_DAYS} weekday afternoons of trail to learn when the house fills up`,
      );
    }
    return ready(learned.days, MIN_PATTERN_DAYS, 'weekday afternoons observed');
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    const days = s.health.daysSinceWorkout;
    if (days == null || days < MIN_DAYS_SINCE_WORKOUT) return [];
    if (!s.isWeekday) return [];
    if (!s.current?.isHome) return [];

    // A day the sensor mostly missed cannot support "you have been in all day".
    if (!coveredEnough(s.coverage.last24h)) return [];

    const learned = learnedBusyHour(s.trail, localHour, localDay);
    if (!learned) return [];

    const minutesLeft = (learned.hour - s.localHour) * 60;
    if (minutesLeft < MIN_WINDOW_MINS) return [];

    // A diary that could not be fully read must never be reported as empty —
    // that is how "your afternoon is free" gets said over a meeting.
    if (s.calendar.available && !s.calendar.partial) {
      const until = new Date(s.now.getTime() + minutesLeft * 60_000);
      const clash = s.calendar.events.find((e) => e.start < until && e.start >= s.now);
      if (clash) return [];
    }
    if (s.calendar.partial) return [];

    const staleness = ramp(days, MIN_DAYS_SINCE_WORKOUT - 1, 10);
    const room = ramp(minutesLeft, MIN_WINDOW_MINS, 180);

    return [
      {
        kind: 'free_window',
        title: `${Math.round(minutesLeft / 15) * 15} minutes before the house fills up`,
        explanation:
          `${days} days since your last workout, you are at home on a weekday, and on the ` +
          `${learned.days} weekday afternoons on record the house is typically busy from about ` +
          `${learned.hour}:00.`,
        rawScore: Math.min(0.85, 0.35 + 0.35 * staleness + 0.15 * room),
        components: {
          daysSinceWorkout: days,
          minutesLeft,
          learnedBusyHour: learned.hour,
          observedDays: learned.days,
          coverage24h: Math.round(s.coverage.last24h * 100) / 100,
        },
        evidence: [
          { kind: 'health', id: 'workouts:last', note: `${days} days ago` },
          { kind: 'trail', id: `pattern:${learned.days}-weekdays`, note: `busy from ~${learned.hour}:00` },
        ],
        placeId: s.current?.placeId ?? null,
        // Once per day: the window shrinks as the day goes on, but re-raising
        // it every ten minutes as it does would be intolerable.
        dedupeKey: `free_window:${s.localDate}`,
        proposedActions: [{ kind: 'open_health', label: 'Training load', payload: '/health' }],
      },
    ];
  },
};

// Local-time helpers, kept here rather than imported from places.ts so the
// detector stays free of anything that reaches for the database.
const LOCAL_TZ = 'Europe/London';

export function localHour(d: Date): number {
  const hh = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TZ,
    hour: '2-digit',
    hour12: false,
  }).format(d);
  return Number(hh) % 24;
}

export function localDay(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, weekday: 'short' }).format(d);
  return Math.max(0, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd));
}
