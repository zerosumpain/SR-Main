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

import { metresBetween } from './cluster';
import { MAX_USABLE_ACCURACY_M } from './types';

/** How far past the radius a fix must be before it counts as leaving. */
export const LEAVE_BAND_M = 50;
/** The same crossing inside this window is the same crossing. */
export const DEDUPE_WINDOW_MS = 10 * 60_000;

export type CrossingKind = 'arrive' | 'leave';

export interface CrossingPlace {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface CrossingFix {
  lat: number;
  lon: number;
  /** Metres. Null when the source did not say. */
  accuracyM: number | null;
  ts: Date;
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
 * watching any more.
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
      if (d > p.radiusM + LEAVE_BAND_M) events.push({ placeId: p.id, kind: 'leave' });
      else inside.add(p.id);
    } else {
      const precise = fix.accuracyM == null || fix.accuracyM < p.radiusM;
      if (d <= p.radiusM && precise) {
        events.push({ placeId: p.id, kind: 'arrive' });
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
  if (fresh.length) {
    for (const id of detectCrossings({ inside: new Set() }, fixes[0], fresh).inside) inside.add(id);
  }
  let lastId = state.lastId;
  let lastTsMs = state.lastTsMs ?? 0;
  for (const f of fixes) {
    lastId = Math.max(lastId, f.id);
    if (f.ts.getTime() <= lastTsMs) continue;
    // A circle this wide proves nothing either way: it cannot arrive (the
    // arrive rule already says so) and must not LEAVE either, or one wild fix
    // is a departure and the next good one a fresh arrival.
    if (f.accuracyM != null && f.accuracyM > MAX_USABLE_ACCURACY_M) continue;
    lastTsMs = f.ts.getTime();
    const step = detectCrossings({ inside }, f, places);
    for (const e of step.events) events.push({ ...e, at: f.ts });
    inside = step.inside;
  }
  return { events, state: { inside: [...inside], lastId, watched: places.map((p) => p.id), lastTsMs } };
}
