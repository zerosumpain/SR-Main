// src/lib/home/presence/drive.ts
//
// Harsh braking and harsh acceleration, read from a phone's own speeds. PURE;
// storage and the journey push are ./drive.server and ./journey-alerts.
//
// Read from the RAW companion fixes, before the trail thins them to one every
// TRAIL_MIN_SPACING_S: in a car the app records a point a second (John,
// 2026-11-01), and a stop that takes three seconds is invisible at five.
//
// The rule, over any two fixes 2–4 s apart: the change in the phone's GPS
// (Doppler) speed, divided by the time between them, at or past HARSH_MS2 —
// about 0.36 g, the line most insurers' boxes draw. Both fixes precise, the
// faster end at car speed (a cyclist's or runner's speed change is not a
// drive), and the distance between them consistent with the speeds, which is
// what throws out a GPS speed spike in a tunnel mouth and a speed the phone
// did not know (sent as 0). Thresholds are a first cut, to tune on real drives. One event per kind per
// EVENT_GAP_S: a hard stop is one stop, not four.

import { metresBetween } from './cluster';

/** m/s² — 0.36 g. */
export const HARSH_MS2 = 3.5;
/** The faster end of the pair must be at least this fast to count. */
export const CAR_KMH = 25;
/** Fixes looser than this say nothing about a second's speed change. */
export const DRIVE_ACCURACY_M = 20;
export const PAIR_MIN_S = 2;
/** At or below this (m/s) a speed is taken as unknown: the phone sends an unknown speed as 0. */
export const MOVING_MS = 0.5;
export const PAIR_MAX_S = 4;
export const EVENT_GAP_S = 10;
/** Raw fixes kept between ingest runs, so a stop across two pages is still seen. */
export const TAIL_S = PAIR_MAX_S;
/** Events kept per person: weeks of ordinary driving. */
export const KEEP_EVENTS = 300;

export interface DriveFix {
  /** Epoch ms. */
  ts: number;
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** The phone's own speed, m/s; null when it did not know. */
  speedMs: number | null;
}

export interface DriveEvent {
  at: string;
  kind: 'brake' | 'accel';
  fromKmh: number;
  toKmh: number;
  /** m/s², positive either way. */
  ms2: number;
  lat: number;
  lon: number;
}

export interface DriveState {
  /** The last TAIL_S of raw fixes seen, oldest first. */
  tail: DriveFix[];
  /** Newest last, at most KEEP_EVENTS. */
  events: DriveEvent[];
  /** `[minute epoch ms, seconds that could be judged]`, newest last, at most
   *  KEEP_MINUTES: a drive is only called smooth when it was watched (a phone
   *  on 5 s points, or an old build on 30 s, cannot see a three-second stop). */
  sampled?: Array<[number, number]>;
}

/** Minutes of coverage kept per person: a day. */
export const KEEP_MINUTES = 1440;

export const emptyDriveState = (): DriveState => ({ tail: [], events: [], sampled: [] });

/** Where a person's state is kept in app_settings (`drive.server`); erased with their trail. */
export const driveKey = (subject: string) => `home.presence.drive.${subject}`;

const usable = (f: DriveFix) =>
  f.speedMs != null && f.speedMs >= 0 && f.accuracyM != null && f.accuracyM >= 0 && f.accuracyM <= DRIVE_ACCURACY_M;

const kmh = (ms: number) => Math.round(ms * 36) / 10;

/**
 * Fold new raw fixes into a person's state: the events they show, and the
 * tail the next run starts from. Fixes at or before the tail's newest are
 * already seen (a re-read page) and ignored. PURE.
 */
export function foldDriveFixes(state: DriveState, incoming: readonly DriveFix[]): { state: DriveState; added: DriveEvent[] } {
  const seenTo = state.tail.at(-1)?.ts ?? -Infinity;
  const fresh = incoming.filter((f) => f.ts > seenTo).sort((a, b) => a.ts - b.ts);
  if (!fresh.length) return { state, added: [] };
  const fixes = [...state.tail, ...fresh];
  const added: DriveEvent[] = [];
  const sampled: Array<[number, number]> = (state.sampled ?? []).map(([m, n]) => [m, n] as [number, number]);
  const lastOf = (kind: DriveEvent['kind']) =>
    [...state.events, ...added].reverse().find((e) => e.kind === kind);
  for (let i = state.tail.length; i < fixes.length; i++) {
    const b = fixes[i];
    if (!usable(b)) continue;
    // The partner nearest 3 s back: any, for coverage; one with a known
    // (non-zero) speed, for judging — an unknown speed arrives as 0.
    let any: DriveFix | null = null, best: DriveFix | null = null;
    const closer = (x: DriveFix, y: DriveFix | null) => !y || Math.abs((b.ts - x.ts) / 1000 - 3) < Math.abs((b.ts - y.ts) / 1000 - 3);
    for (let j = i - 1; j >= 0; j--) {
      const a = fixes[j], dt = (b.ts - a.ts) / 1000;
      if (dt > PAIR_MAX_S) break;
      if (dt < PAIR_MIN_S || !usable(a)) continue;
      if (closer(a, any)) any = a;
      if ((a.speedMs as number) > MOVING_MS && closer(a, best)) best = a;
    }
    if (!any) continue;
    // Watched: this second could have shown a harsh event (at a standstill
    // too — a queue is part of the drive).
    const minute = Math.floor(b.ts / 60_000) * 60_000;
    const last = sampled.at(-1);
    if (last && last[0] === minute) last[1]++;
    else sampled.push([minute, 1]);
    if (!best || (b.speedMs as number) <= MOVING_MS) continue;
    const dt = (b.ts - best.ts) / 1000;
    const v0 = best.speedMs as number, v1 = b.speedMs as number;
    if (Math.max(v0, v1) * 3.6 < CAR_KMH) continue;
    const a = (v1 - v0) / dt;
    if (Math.abs(a) < HARSH_MS2) continue;
    // A steady change of speed covers (v0 + v1) / 2 × dt. The tolerance is
    // tight on purpose: the phone sends an unknown speed as 0, and "40 km/h
    // to 0" that is really 40 to unknown covers twice the ground.
    const metres = metresBetween(best.lat, best.lon, b.lat, b.lon), expected = ((v0 + v1) / 2) * dt;
    if (Math.abs(metres - expected) > 0.25 * expected + ((best.accuracyM as number) + (b.accuracyM as number)) / 2 + 3) continue;
    const kind = a < 0 ? 'brake' : 'accel';
    const prior = lastOf(kind);
    if (prior && b.ts - Date.parse(prior.at) < EVENT_GAP_S * 1000) continue;
    added.push({
      at: new Date(b.ts).toISOString(), kind, fromKmh: kmh(v0), toKmh: kmh(v1),
      ms2: Math.round(Math.abs(a) * 10) / 10, lat: b.lat, lon: b.lon,
    });
  }
  const newest = fixes.at(-1)!.ts;
  return {
    state: {
      tail: fixes.filter((f) => newest - f.ts <= TAIL_S * 1000),
      events: [...state.events, ...added].slice(-KEEP_EVENTS),
      sampled: sampled.slice(-KEEP_MINUTES),
    },
    added,
  };
}

/** The share of a window's seconds that could be judged (0–1). PURE. */
export function coverageBetween(state: Pick<DriveState, 'sampled'>, from: number, to: number): number {
  const span = (to - from) / 1000;
  if (span <= 0) return 0;
  let seconds = 0;
  for (const [minute, n] of state.sampled ?? []) if (minute + 60_000 > from && minute <= to) seconds += n;
  return Math.min(1, seconds / span);
}

/** The events inside a trip, oldest first. PURE. */
export function eventsBetween(events: readonly DriveEvent[], from: number, to: number): DriveEvent[] {
  return events.filter((e) => {
    const t = Date.parse(e.at);
    return t >= from && t <= to;
  });
}
