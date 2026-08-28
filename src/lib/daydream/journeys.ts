// src/lib/daydream/journeys.ts
//
// The moving half of the trail.
//
// `cluster.ts` defines a visit as time spent still. A journey is the exact
// complement, and until now it was discarded: 17.8% of the trail is in motion —
// 5,868 vehicle fixes averaging 77 km/h, plus walking and active — and nothing
// read a single one of them. The machinery that separates the two halves is
// already written, so this is the cheap half of the value.
//
// The same 75 m / 6 min stillness test decides both, which matters more than it
// looks: if a journey used a different notion of "moving" from the one a visit
// uses to mean "still", the two would disagree about the same minute and the
// day's minutes would not add up.
//
// What a journey is NOT is a claim about method. `mode` comes from GPS speed
// alone: it cannot separate running from cycling, `rail` also matches a
// motorway, and the trail contains fixes recorded as `vehicle` at 399 km/h,
// which are jumps rather than journeys. Method is carried as colour, never as
// fact — the same rule the trail has always applied to `mode`.

import { metresBetween } from './cluster';
import {
  MIN_DWELL_MINS,
  MIN_JOURNEY_METRES,
  MIN_JOURNEY_MINS,
  STILL_MAX_GAP_MINS,
  STILL_RADIUS_M,
  type MovementMode,
} from './types';

export interface JourneyFix {
  ts: Date;
  lat: number;
  lon: number;
  subject: string;
  speedKmh?: number | null;
  mode?: MovementMode | null;
  placeId?: string | null;
}

export interface Journey {
  subject: string;
  startedAt: Date;
  endedAt: Date;
  minutes: number;
  /** Summed leg-by-leg, not start-to-end: a round trip covers real distance
   *  and ends where it began, and straight-line would call that zero. */
  distanceKm: number;
  meanSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  /** The band the most fixes fell in. Advisory. */
  dominantMode: MovementMode | null;
  fixCount: number;
  /** The place left and the place arrived at, where the trail knows them. */
  fromPlaceId: string | null;
  toPlaceId: string | null;
}

/** A pair of consecutive fixes is movement when it is neither a hole in the
 *  record nor a person standing still. Deliberately the negation of the visit
 *  test, so a minute cannot be both. */
function isMovingLeg(a: JourneyFix, b: JourneyFix): boolean {
  const gapMins = (b.ts.getTime() - a.ts.getTime()) / 60_000;
  if (gapMins > STILL_MAX_GAP_MINS) return false;
  return metresBetween(a.lat, a.lon, b.lat, b.lon) > STILL_RADIUS_M;
}

/**
 * Split one subject's day into journeys.
 *
 * A journey ends when the stillness becomes a VISIT — that is, when it lasts
 * MIN_DWELL_MINS. Below that the stop is part of the journey and its minutes
 * count toward it: traffic lights, a level crossing, a queue at a junction are
 * all time spent travelling, and a definition that ended a journey at every red
 * light would report nine journeys for one trip to the shops.
 *
 * Tying it to the visit threshold rather than picking a separate number is what
 * keeps the two halves consistent. Any minute is journey time, visit time, or
 * unobserved, and never two of those.
 */
export function segmentJourneys(fixes: JourneyFix[]): Journey[] {
  const bySubject = new Map<string, JourneyFix[]>();
  for (const f of fixes) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    const list = bySubject.get(f.subject) ?? [];
    list.push(f);
    bySubject.set(f.subject, list);
  }

  const out: Journey[] = [];

  for (const [subject, list] of bySubject) {
    const ordered = [...list].sort((a, b) => a.ts.getTime() - b.ts.getTime());

    let run: JourneyFix[] = [];
    /** Stationary fixes seen since the last movement — absorbed if the stop
     *  turns out to be brief, discarded with the journey if it turns out to be
     *  a visit. */
    let pending: JourneyFix[] = [];
    let leftFrom: string | null = null;

    const close = (arrivedAt: string | null) => {
      if (run.length >= 2) {
        const j = summarise(subject, run, leftFrom, arrivedAt);
        if (j.minutes >= MIN_JOURNEY_MINS && j.distanceKm * 1000 >= MIN_JOURNEY_METRES) out.push(j);
      }
      run = [];
      pending = [];
      leftFrom = null;
    };

    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];

      if (isMovingLeg(prev, cur)) {
        if (run.length === 0) {
          leftFrom = prev.placeId ?? null;
          run.push(prev);
        } else if (pending.length) {
          // The stop was shorter than a visit, so it was part of the journey.
          run.push(...pending);
        }
        pending = [];
        run.push(cur);
        continue;
      }

      if (run.length === 0) continue; // not travelling; nothing to hold open

      pending.push(cur);
      const stoppedMins =
        (cur.ts.getTime() - run[run.length - 1].ts.getTime()) / 60_000;
      if (stoppedMins >= MIN_DWELL_MINS) close(pending[0]?.placeId ?? cur.placeId ?? null);
    }

    close(ordered[ordered.length - 1]?.placeId ?? null);
  }

  return out.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

function summarise(
  subject: string,
  run: JourneyFix[],
  fromPlaceId: string | null,
  toPlaceId: string | null,
): Journey {
  const startedAt = run[0].ts;
  const endedAt = run[run.length - 1].ts;
  const minutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);

  let metres = 0;
  for (let i = 1; i < run.length; i++) {
    metres += metresBetween(run[i - 1].lat, run[i - 1].lon, run[i].lat, run[i].lon);
  }

  const speeds = run.map((f) => f.speedKmh).filter((s): s is number => s != null && Number.isFinite(s));
  const modes = new Map<MovementMode, number>();
  for (const f of run) {
    if (!f.mode || f.mode === 'unknown') continue;
    modes.set(f.mode, (modes.get(f.mode) ?? 0) + 1);
  }
  let dominantMode: MovementMode | null = null;
  let best = 0;
  for (const [m, n] of modes) if (n > best) ((best = n), (dominantMode = m));

  return {
    subject,
    startedAt,
    endedAt,
    minutes,
    distanceKm: Math.round((metres / 1000) * 100) / 100,
    // Derived from the distance actually covered rather than averaging the
    // per-fix speeds: one 399 km/h GPS jump would otherwise dominate the mean.
    meanSpeedKmh: minutes > 0 ? Math.round((metres / 1000 / (minutes / 60)) * 10) / 10 : null,
    maxSpeedKmh: speeds.length ? Math.max(...speeds) : null,
    dominantMode,
    fixCount: run.length,
    fromPlaceId,
    toPlaceId,
  };
}

export interface JourneyDay {
  count: number;
  minutesMoving: number;
  distanceKm: number;
  longestMinutes: number;
  maxSpeedKmh: number | null;
  byMode: Partial<Record<MovementMode, number>>;
}

/** The day's journeys as the numbers a signal store wants. */
export function summariseDay(journeys: Journey[]): JourneyDay {
  const byMode: Partial<Record<MovementMode, number>> = {};
  let minutesMoving = 0;
  let distanceKm = 0;
  let longestMinutes = 0;
  let maxSpeedKmh: number | null = null;

  for (const j of journeys) {
    minutesMoving += j.minutes;
    distanceKm += j.distanceKm;
    if (j.minutes > longestMinutes) longestMinutes = j.minutes;
    if (j.maxSpeedKmh != null && (maxSpeedKmh == null || j.maxSpeedKmh > maxSpeedKmh)) {
      maxSpeedKmh = j.maxSpeedKmh;
    }
    if (j.dominantMode) byMode[j.dominantMode] = (byMode[j.dominantMode] ?? 0) + j.minutes;
  }

  return {
    count: journeys.length,
    minutesMoving,
    distanceKm: Math.round(distanceKm * 100) / 100,
    longestMinutes,
    maxSpeedKmh,
    byMode,
  };
}
