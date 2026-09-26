// src/lib/home/presence/crossings.ts
//
// Arriving at and leaving a place, as edges on the trail (household movement,
// spec section 6). PURE: no database, no clock. `alerts.ts` feeds it fixes and
// persists what it returns.
//
// The two edges are deliberately different widths. A person ARRIVES on the
// first fix inside the radius whose accuracy circle is smaller than the radius
// (a 400 m circle "arrives" at every shop it passes), and LEAVES only on the
// first fix beyond radius + 50 m. The 50 m band between them is what absorbs
// jitter at the edge: a phone sitting on the doorstep reads 5 m inside, 8 m
// outside, 3 m inside, and without the band that is three alerts.
//
// Leaving also needs the WHOLE accuracy circle past that band, not just its
// centre. Indoors a phone drifts: an 80 m circle on a 50 m place wanders 150 m
// out and back while nobody moves, and centre-only would call each wander a
// leave and the next fix an arrive.
//
// An arrive is refused from a fix moving at rail speed: a train through a
// flagged place is passing, not arriving. Leaving on one is still leaving.
//
// Each place says which DIRECTIONS it announces (`alertArrive`, `alertLeave`,
// both on by default). That gates the EVENT only: whether someone is inside is
// tracked exactly as before, so turning "when they leave" off and on again
// never invents a crossing that did not happen.
//
// The same holds for the master switch (`alerts`). Home is watched whatever
// it says, so who is in stays known, but it raises nothing unless its switch
// is on, like every other place. No place notifies by default.

import { metresBetween } from './cluster';
import { MAX_USABLE_ACCURACY_M } from './types';

/** How far past the radius a fix must be before it counts as leaving. */
export const LEAVE_BAND_M = 50;
/** At or above this speed a fix is a train (or a motorway) going through, and
 *  cannot arrive anywhere. 90 km/h = 25 m/s. */
export const PASSING_SPEED_KMH = 90;
/** The same crossing inside this window is the same crossing. */
export const DEDUPE_WINDOW_MS = 10 * 60_000;

export type CrossingKind = 'arrive' | 'leave';

export interface CrossingPlace {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** The master switch. False = watched (inside is tracked) but silent in
   *  both directions. Absent = on: only flagged places are passed in, apart
   *  from home, which always carries its flag. */
  alerts?: boolean;
  /** Raise an event on arriving here. Absent = on (the column default). */
  alertArrive?: boolean;
  /** Raise an event on leaving here. Absent = on. */
  alertLeave?: boolean;
}

/** Whether a place announces crossings in this direction: never with its
 *  master switch off; otherwise an unknown place (or one without the flags)
 *  announces both, as the columns default. PURE. */
export function raisesCrossing(
  place: Pick<CrossingPlace, 'alerts' | 'alertArrive' | 'alertLeave'> | undefined,
  kind: CrossingKind,
): boolean {
  if (place?.alerts === false) return false;
  return (kind === 'arrive' ? place?.alertArrive : place?.alertLeave) !== false;
}

export interface CrossingFix {
  lat: number;
  lon: number;
  /** Metres. Null when the source did not say. */
  accuracyM: number | null;
  ts: Date;
  /** The trail row's speed, from the previous fix. Null or absent = unknown. */
  speedKmh?: number | null;
  /** The trail row's mode band ('vehicle', 'rail', …). Advisory. */
  mode?: string | null;
}

/** Whether a fix is moving too fast to be arriving anywhere. Every mode band
 *  at 90 km/h is `vehicle` or `rail`, so the speed alone decides. */
export function isPassingThrough(fix: CrossingFix): boolean {
  return fix.speedKmh != null && fix.speedKmh >= PASSING_SPEED_KMH;
}

export interface Crossing {
  placeId: string;
  kind: CrossingKind;
}

/**
 * The crossings one fix makes, given where the person already was.
 *
 * `prev.inside` is every place they were last known to be inside. A place in
 * `inside` that is no longer in `places` (unflagged, retired) is dropped from
 * the returned set silently: no leave is raised for somewhere nobody is
 * watching any more. A direction the place does not announce moves `inside`
 * all the same and raises nothing.
 *
 * A null accuracy is taken as usable, as the trail writer takes it: Home
 * Assistant does not always report one, and refusing those fixes would make a
 * Life360 member never arrive anywhere.
 */
export function detectCrossings(
  prev: { inside: Set<string> },
  fix: CrossingFix,
  places: readonly CrossingPlace[],
): { events: Crossing[]; inside: Set<string> } {
  const events: Crossing[] = [];
  const inside = new Set<string>();
  for (const p of places) {
    const d = metresBetween(fix.lat, fix.lon, p.lat, p.lon);
    const was = prev.inside.has(p.id);
    if (was) {
      // The near edge of the accuracy circle must be past the band too.
      if (d - (fix.accuracyM ?? 0) > p.radiusM + LEAVE_BAND_M) {
        if (raisesCrossing(p, 'leave')) events.push({ placeId: p.id, kind: 'leave' });
      } else inside.add(p.id);
    } else {
      const precise = fix.accuracyM == null || fix.accuracyM < p.radiusM;
      if (d <= p.radiusM && precise && !isPassingThrough(fix)) {
        if (raisesCrossing(p, 'arrive')) events.push({ placeId: p.id, kind: 'arrive' });
        inside.add(p.id);
      }
    }
  }
  return { events, inside };
}

/** A household_event row's id: the same crossing written twice is one row. */
export function eventId(subject: string, placeId: string, kind: CrossingKind, at: Date): string {
  return `${subject}:${placeId}:${kind}:${Math.floor(at.getTime() / 1000)}`;
}

export interface EventKey {
  subject: string;
  placeId: string;
  kind: string;
  at: Date;
}

/** Whether `cand` repeats a crossing already recorded within ten minutes of
 *  it, either side. PURE. */
export function isDuplicate(existing: readonly EventKey[], cand: EventKey): boolean {
  return existing.some(
    (e) =>
      e.subject === cand.subject &&
      e.placeId === cand.placeId &&
      e.kind === cand.kind &&
      Math.abs(e.at.getTime() - cand.at.getTime()) < DEDUPE_WINDOW_MS,
  );
}

/** What is stored per person in `home.presence.inside.<subject>`. */
export interface InsideState {
  /** Places they were last known to be inside. */
  inside: string[];
  /** The last trail row id read, so each fix is looked at exactly once. */
  lastId: number;
  /** The places that were being watched. One flagged since is initialised
   *  quietly, like a first run: ticking "alerts" on the place someone is
   *  sitting in must not announce that they have just arrived there. */
  watched: string[];
  /** The newest fix time walked, epoch ms. A row written later but taken
   *  EARLIER (a late upload, or the app's history re-read after someone
   *  switches to it) is stepped over: walking back in time would make
   *  crossings that never happened. */
  lastTsMs: number;
  /** Set for someone who had no position when first looked at. Their first
   *  fix is then treated like a first run (state only, nothing raised): it
   *  is where they are, not somewhere they have just arrived. */
  unplaced?: boolean;
}

export interface TrailFix extends CrossingFix {
  id: number;
}

/**
 * Walk a person's new fixes, oldest first, from their stored state. PURE.
 *
 * With NO stored state (the first run for this person, including the first
 * run after a deploy), or an `unplaced` one, it only initialises: the state is
 * taken from the newest fix and nothing is raised. Otherwise every deploy would tell the household
 * that everyone had just arrived home.
 */
export function stepCrossings(
  state: InsideState | null,
  fixes: readonly TrailFix[],
  places: readonly CrossingPlace[],
): { events: Array<Crossing & { at: Date }>; state: InsideState | null } {
  if (fixes.length === 0) return { events: [], state };
  if (!state || state.unplaced) {
    const newest = fixes.reduce((a, b) => (b.ts.getTime() >= a.ts.getTime() ? b : a));
    const { inside } = detectCrossings({ inside: new Set() }, newest, places);
    return {
      events: [],
      state: {
        inside: [...inside],
        lastId: Math.max(state?.lastId ?? 0, ...fixes.map((f) => f.id)),
        watched: places.map((p) => p.id),
        lastTsMs: newest.ts.getTime(),
      },
    };
  }
  const events: Array<Crossing & { at: Date }> = [];
  let inside = new Set(state.inside);
  const watched = new Set(state.watched ?? []);
  const fresh = places.filter((p) => !watched.has(p.id));
  // Seeded from the first fix precise enough to mean anything: a wild first
  // fix would seed "outside" someone sitting in the place, and the next good
  // fix would announce an arrival. With no such fix yet, the new places stay
  // unwatched and are seeded quietly on a later run.
  const seed = fixes.find(usable);
  if (fresh.length && seed) {
    for (const id of detectCrossings({ inside: new Set() }, seed, fresh).inside) inside.add(id);
  }
  const unseeded = new Set(seed ? [] : fresh.map((p) => p.id));
  let lastId = state.lastId;
  let lastTsMs = state.lastTsMs ?? 0;
  for (const f of fixes) {
    lastId = Math.max(lastId, f.id);
    if (f.ts.getTime() <= lastTsMs) continue;
    // A circle this wide proves nothing either way: it cannot arrive (the
    // arrive rule already says so) and must not LEAVE either, or one wild fix
    // is a departure and the next good one a fresh arrival.
    if (!usable(f)) continue;
    lastTsMs = f.ts.getTime();
    const step = detectCrossings({ inside }, f, places);
    for (const e of step.events) events.push({ ...e, at: f.ts });
    inside = step.inside;
  }
  return {
    events,
    state: { inside: [...inside], lastId, watched: places.filter((p) => !unseeded.has(p.id)).map((p) => p.id), lastTsMs },
  };
}

/** A fix whose accuracy says something; a null accuracy counts (see above). */
function usable(f: CrossingFix): boolean {
  return f.accuracyM == null || f.accuracyM <= MAX_USABLE_ACCURACY_M;
}
