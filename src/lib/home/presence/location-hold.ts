// src/lib/home/presence/location-hold.ts
//
// The owner's location hold: John puts his pin at a fixed point for a while
// (Settings in his app), his phone stops sending fixes, and everyone else in
// the family sees him there — fresh, as if his phone had just reported from
// it. PURE: reading the input, whether a hold is on, and the household as a
// non-owner viewer sees it while one is. Storage is ./location-hold.server.
//
// Nothing on the wire says a hold is on: the held card is built from the same
// fields a real fix at that point would produce (the place it falls in, home
// within 150 m, the distance from home), so a viewer cannot tell one from the
// other, and the view's keys never change — the pilot refuses a view with a
// key it does not know. The owner's OWN view is never held: he sees his real,
// paused, last position, and his phone says why.

import type { HouseholdPresence, LivePosition } from './household';
import { metresBetween, haversineKm } from './cluster';

export interface LocationHold {
  lat: number;
  lon: number;
  /** What the owner called the spot, for his own phone — never shown to anyone else. */
  label: string;
  since: string;
  until: string;
}

/** Longest a hold may be set for. */
export const HOLD_MAX_MS = 7 * 86_400_000;
export const HOLD_LABEL_MAX = 60;
/** A held pin reads as reported up to this long ago, so it does not sit at "0s" forever. */
export const HOLD_JITTER_MAX_MS = 90_000;
/** Within this of home is home — the same rule a phone's own fix is held to (`observe.ts`). */
export const HOME_KM = 0.15;

/** `{ lat, lon, label, until }` from the phone, or why not. PURE. */
export function parseHold(input: unknown, now: Date): { hold: LocationHold } | { error: string } {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!o) return { error: 'Say where and until when.' };
  const { lat, lon } = o;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
    || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) {
    return { error: 'That is not a place on the map.' };
  }
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  if (!label) return { error: 'Name the spot.' };
  if ([...label].length > HOLD_LABEL_MAX) return { error: `Keep the name under ${HOLD_LABEL_MAX} characters.` };
  const until = typeof o.until === 'string' ? new Date(o.until) : null;
  if (!until || !Number.isFinite(until.getTime())) return { error: 'Say until when.' };
  if (until.getTime() <= now.getTime()) return { error: 'That time has already gone.' };
  if (until.getTime() - now.getTime() > HOLD_MAX_MS) return { error: 'A hold lasts a week at most.' };
  return { hold: { lat, lon, label, since: now.toISOString(), until: until.toISOString() } };
}

/** A stored value, read back leniently: anything malformed is no hold. PURE. */
export function readHold(value: unknown): LocationHold | null {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!o) return null;
  const { lat, lon, label, since, until } = o;
  if (typeof lat !== 'number' || typeof lon !== 'number' || typeof until !== 'string') return null;
  if (!Number.isFinite(new Date(until).getTime())) return null;
  return { lat, lon, label: typeof label === 'string' ? label : '', since: typeof since === 'string' ? since : until, until };
}

/** Whether a hold is on now. PURE. */
export function isActive(hold: LocationHold | null, now: Date): hold is LocationHold {
  return !!hold && new Date(hold.until).getTime() > now.getTime();
}

/** A known place the held point may fall inside, as ingest matches a fix. */
export interface HoldPlace {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** The label the household card would show for it (`activeLabels`). */
  label: string | null;
}

/** What a fix at the held point would have been recorded as. PURE. */
export function heldReading(
  hold: Pick<LocationHold, 'lat' | 'lon'>,
  home: { lat: number; lon: number } | null,
  places: readonly HoldPlace[],
): { isHome: boolean | null; placeLabel: string | null; distanceHomeKm: number | null } {
  const distanceHomeKm = home ? Math.round(haversineKm(home.lat, home.lon, hold.lat, hold.lon) * 100) / 100 : null;
  let best: HoldPlace | null = null;
  let bestDist = Infinity;
  for (const p of places) {
    const d = metresBetween(hold.lat, hold.lon, p.lat, p.lon);
    if (d <= p.radiusM && d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { isHome: distanceHomeKm == null ? null : distanceHomeKm < HOME_KM, placeLabel: best?.label ?? null, distanceHomeKm };
}

/** ~11 m, as `livePositions` rounds every pin. */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface HeldHousehold<T> {
  presence: HouseholdPresence[];
  positions: LivePosition[];
  recent: Map<string, T[]>;
}

/**
 * The household as anyone but the owner sees it while a hold is on. PURE.
 *
 * Each of `subjects` (the owner's household rows) that is sharing is put at the
 * held point, seen `jitterMs` ago, with no fixes in the "moving now" window —
 * so no line, no speed, no direction. Battery and the day stay as they were:
 * the day is the owner's own and no other viewer is shown it. A subject not
 * sharing stays not sharing; the hold never makes anyone appear.
 */
export function applyHold<T>(
  input: { presence: readonly HouseholdPresence[]; positions: readonly LivePosition[]; recent: ReadonlyMap<string, readonly T[]> },
  hold: LocationHold,
  subjects: readonly string[],
  reading: ReturnType<typeof heldReading>,
  now: Date,
  jitterMs: number,
): HeldHousehold<T> {
  const held = new Set(subjects);
  const seen = new Date(now.getTime() - Math.max(0, Math.min(HOLD_JITTER_MAX_MS, jitterMs)));
  // Sharing: a card that is not "not sharing", or a pin — `livePositions`
  // only ever holds people who share, so either half alone is enough to ask.
  const off = new Set(input.presence.filter((m) => m.notSharing).map((m) => m.subject));
  const sharing = new Set(
    [...input.presence.map((m) => m.subject), ...input.positions.map((p) => p.subject)].filter((s) => held.has(s) && !off.has(s)),
  );
  const presence = input.presence.map((m) =>
    sharing.has(m.subject)
      ? { ...m, ...reading, ageMins: Math.round((now.getTime() - seen.getTime()) / 60_000), lastSeenAt: seen }
      : { ...m },
  );
  const positions = input.positions.filter((p) => !sharing.has(p.subject));
  for (const subject of sharing) {
    positions.push({ subject, lat: round4(hold.lat), lon: round4(hold.lon), at: seen.toISOString(), isHome: reading.isHome });
  }
  const recent = new Map<string, T[]>();
  for (const [subject, points] of input.recent) if (!sharing.has(subject)) recent.set(subject, [...points]);
  return { presence, positions, recent };
}
