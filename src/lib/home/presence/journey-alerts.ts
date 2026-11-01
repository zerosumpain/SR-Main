// src/lib/home/presence/journey-alerts.ts
//
// "Arrived safely": when somebody finishes a drive or a train journey, the
// people who follow them are told — where, how long, how far, the top speed,
// and for a drive whether there was harsh braking or acceleration (John,
// 2026-11-01, after Life360's drive reports). PURE; delivery rides with the
// parent alerts in ./parent-alerts.server.
//
// The trip is the forecast's own (`extractTrips`: ten still minutes at a place
// end it), so this fires when "stopped" would, about ten minutes after
// arriving. Walks and rides are not announced: a journey on foot is not one
// anybody waits to hear has ended. Flights are not yet told apart; speeding
// against the road's limit is a later step (OSM maxspeed).

import type { PushMessage } from '$lib/server/apns';
import type { InsightPlace, RouteInsight } from './insights';
import { placeTitle } from './insights';
import { metresBetween } from './cluster';
import { railJourney } from './movement';
import type { DriveEvent } from './drive';
import { STOP_WINDOW_MINS } from './parent-alerts';

const MINUTE = 60_000;

/** At or above this a fix is in a vehicle (the trail's own `vehicle` band). */
export const VEHICLE_KMH = 18;
/** A trip with at least this share of its fixes in a vehicle is a journey. */
export const VEHICLE_SHARE = 1 / 3;
/** Fixes looser than this are left out of distance and top speed. */
export const STATS_ACCURACY_M = 50;
/** Ends at or leaves a station and goes this far: a train, whatever its speed. */
export const STATION_TRAIN_KM = 15;

export interface TripFix {
  ts: number;
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedKmh: number | null;
  mode: string | null;
}

export type JourneyMode = 'drive' | 'train';

export interface TripStats {
  mode: JourneyMode | null;
  km: number;
  /** 95th percentile of the precise fixes' speeds: a raw max is one bad fix. */
  topKmh: number | null;
}

const precise = (f: TripFix) => f.accuracyM == null || f.accuracyM <= STATS_ACCURACY_M;

/** Distance, top speed and drive-or-train from a trip's trail rows, oldest first. PURE. */
export function tripStats(fixes: readonly TripFix[], places: { from?: InsightPlace; to?: InsightPlace } = {}): TripStats {
  const good = fixes.filter(precise);
  let metres = 0;
  for (let i = 1; i < good.length; i++) metres += metresBetween(good[i - 1].lat, good[i - 1].lon, good[i].lat, good[i].lon);
  const km = Math.round(metres / 100) / 10;
  const speeds = good.map((f) => f.speedKmh).filter((v): v is number => v != null && v >= 0).sort((a, b) => a - b);
  const topKmh = speeds.length >= 5 ? speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.95))] : speeds.at(-1) ?? null;
  const inVehicle = fixes.filter((f) => f.mode === 'vehicle' || f.mode === 'rail' || (f.speedKmh ?? 0) >= VEHICLE_KMH).length;
  if (!fixes.length || inVehicle / fixes.length < VEHICLE_SHARE) return { mode: null, km, topKmh };
  const station = [places.from, places.to].some((p) => /station/i.test(`${p?.label ?? ''} ${p?.suggestedLabel ?? ''} ${p?.kind ?? ''}`));
  const train = railJourney(good) || (station && km >= STATION_TRAIN_KM);
  return { mode: train ? 'train' : 'drive', km, topKmh };
}

export interface JourneyNotice {
  id: string;
  kind: 'journey';
  subject: string;
  /** Lower-cased follower emails. */
  recipients: string[];
  push: PushMessage;
  until: number;
  /** The trip it reports, `<subject>-<arrived ms>`: the "stopped" notice it replaces. */
  trip: string;
}

/** A completed trip: who, from where to where, when it began and ended. */
export interface CompletedTrip {
  route: RouteInsight;
  left: number;
  arrived: number;
}

/** The trips that ended inside the stop window. PURE. */
export function recentTrips(routes: readonly RouteInsight[], now: Date): CompletedTrip[] {
  const out: CompletedTrip[] = [];
  for (const route of routes) {
    for (const trip of route.trips) {
      const left = +new Date(trip.start), arrived = left + trip.minutes * MINUTE;
      if (arrived > +now || +now - arrived > STOP_WINDOW_MINS * MINUTE) continue;
      out.push({ route, left, arrived });
    }
  }
  return out;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const MPH = 0.621371;

function duration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

function miles(km: number): string {
  const mi = km * MPH;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** "No harsh braking" / "2 harsh brakes, 1 hard start". PURE. */
export function drivingLine(events: readonly DriveEvent[]): string {
  const brakes = events.filter((e) => e.kind === 'brake').length;
  const starts = events.filter((e) => e.kind === 'accel').length;
  if (!brakes && !starts) return 'No harsh braking or acceleration';
  const bits: string[] = [];
  if (brakes) bits.push(`${brakes} harsh brake${brakes === 1 ? '' : 's'}`);
  if (starts) bits.push(`${starts} hard acceleration${starts === 1 ? '' : 's'}`);
  return bits.join(', ').replace(/^./, (c) => c.toUpperCase());
}

/** The "arrived safely" push for one trip, or null when it was not a drive or a train. PURE. */
export function journeyNotice(input: {
  trip: CompletedTrip;
  stats: TripStats;
  events: readonly DriveEvent[];
  places: readonly InsightPlace[];
  recipients: readonly string[];
  name: string;
}): JourneyNotice | null {
  const { trip, stats, events, places, recipients, name } = input;
  if (!stats.mode || !recipients.length) return null;
  const { route, left, arrived } = trip;
  const to = places.find((p) => p.id === route.toId);
  const where = to ? placeTitle(to) : null;
  const from = route.from || 'where they were';
  const how = stats.mode === 'train' ? `${duration((arrived - left) / MINUTE)} by train` : `${duration((arrived - left) / MINUTE)} drive`;
  const lines = [
    `${how} from ${from}, ${miles(stats.km)}, arrived ${clockFmt.format(new Date(arrived))}.`,
    stats.topKmh != null ? `Top speed ${Math.round(stats.topKmh * MPH)} mph.` : null,
    stats.mode === 'drive' ? `${drivingLine(events)}.` : null,
  ].filter(Boolean);
  const id = `journey-${route.subject}-${arrived}`;
  return {
    id, kind: 'journey', subject: route.subject, trip: `${route.subject}-${arrived}`,
    recipients: [...new Set(recipients.map((r) => r.trim().toLowerCase()))],
    until: arrived + STOP_WINDOW_MINS * MINUTE,
    push: {
      title: where ? `${name} arrived safely at ${where}` : `${name} arrived safely`,
      body: lines.join(' '),
      category: 'household',
      threadId: 'household',
      level: 'active',
      collapseId: id.slice(0, 64),
      ttlSeconds: STOP_WINDOW_MINS * 60,
      userInfo: { id, category: 'household', kind: 'journey', url: `/home/people?person=${encodeURIComponent(route.subject)}` },
    },
  };
}
