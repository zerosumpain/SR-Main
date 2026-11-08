// src/lib/home/presence/move-history.ts
//
// One person's moves, looked back at: where they go, how long each route
// takes and whether that is changing, how their routines keep time, every
// trip in the window and when in the week they leave. What the app shows when
// a name on the family's next moves is tapped (`GET
// /api/native/family/forecast/history`).
//
// PURE, from the same learned routes the forecast stands on (`insights.ts`),
// so a figure here never disagrees with the next move it explains. Names
// only: no coordinates and no email reach this shape.

import { dayTypeOf, localClock, routinesOf, ROUTINE_WINDOW_MINS, type DayType } from './forecast';
import { percentile, type PresenceInsights, type RouteInsight } from './insights';

/** Trips listed, newest first. The figures count them all. */
export const HISTORY_TRIPS_MAX = 150;
/** A routine run leaving more than this far from its usual time was early or late. */
export const ON_TIME_MINS = 10;
/** Clean trips a route needs before its newer half is compared with its older. */
export const TREND_MIN_TRIPS = 4;

export interface MoveHistory {
  subject: string;
  name: string;
  days: number;
  generatedAt: string;
  totals: { trips: number; places: number; minutes: number; perWeek: number };
  places: Array<{ name: string; trips: number; share: number }>;
  routes: Array<{
    id: string; from: string; to: string; mode: string; trips: number;
    median: number; low: number; high: number; departure: string;
    recentMedian: number | null; earlierMedian: number | null; lastAt: string | null;
  }>;
  routines: Array<{
    id: string; from: string; to: string; dayType: DayType; departure: string; window: [number, number];
    days: number; of: number;
    punctuality: { early: number; onTime: number; late: number } | null;
  }>;
  trips: Array<{ from: string; to: string; start: string; minutes: number; mode: string; broken: boolean }>;
  /** Departures by local weekday (Monday first) and hour. */
  pattern: number[][];
}

const round = (n: number) => Math.round(n * 10) / 10;
/** Signed distance between two clock minutes, the short way round. */
const clockDelta = (a: number, b: number) => ((a - b + 720 + 1440) % 1440) - 720;

/** Median minutes of the older and the newer half of a route's clean trips. */
function trend(route: RouteInsight): { recentMedian: number | null; earlierMedian: number | null } {
  const clean = route.trips.filter((t) => !t.broken).sort((a, b) => +new Date(a.start) - +new Date(b.start));
  if (clean.length < TREND_MIN_TRIPS) return { recentMedian: null, earlierMedian: null };
  const half = Math.floor(clean.length / 2);
  return {
    earlierMedian: round(percentile(clean.slice(0, half).map((t) => t.minutes), 0.5)),
    recentMedian: round(percentile(clean.slice(clean.length - half).map((t) => t.minutes), 0.5)),
  };
}

/** One person's move history out of the viewer's insights. Null when they are not in them. PURE. */
export function buildMoveHistory(insights: PresenceInsights, subject: string, now: Date): MoveHistory | null {
  const person = insights.people.find((p) => p.subject === subject);
  if (!person) return null;
  const routes = insights.routes.filter((r) => r.subject === subject);
  const all = routes.flatMap((r) => r.trips.map((t) => ({ ...t, from: r.from, to: r.to, mode: r.mode })));

  const arrivals = new Map<string, number>();
  for (const t of all) arrivals.set(t.to, (arrivals.get(t.to) ?? 0) + 1);
  const named = new Set(all.flatMap((t) => [t.from, t.to]));

  const pattern = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const t of all) {
    const clock = localClock(new Date(t.start));
    if (clock.weekday >= 0) pattern[clock.weekday][Math.floor(clock.minute / 60)]++;
  }

  const routines = routinesOf(routes, now, insights.days).map((r) => {
    const route = routes.find((x) => x.id === r.routeId);
    // The runs the routine is made of: clean trips of its day type near its time.
    const offsets = (route?.trips ?? [])
      .filter((t) => !t.broken)
      .map((t) => localClock(new Date(t.start)))
      .filter((c) => dayTypeOf(c.weekday) === r.dayType)
      .map((c) => clockDelta(c.minute, r.departureMin))
      .filter((d) => Math.abs(d) <= ROUTINE_WINDOW_MINS);
    const punctuality = offsets.length
      ? {
          early: offsets.filter((d) => d < -ON_TIME_MINS).length,
          onTime: offsets.filter((d) => Math.abs(d) <= ON_TIME_MINS).length,
          late: offsets.filter((d) => d > ON_TIME_MINS).length,
        }
      : null;
    return {
      id: r.id, from: r.from, to: r.to, dayType: r.dayType, departure: r.departure, window: r.window,
      days: r.days, of: r.of, punctuality,
    };
  });

  return {
    subject,
    name: person.displayName,
    days: insights.days,
    generatedAt: now.toISOString(),
    totals: {
      trips: all.length,
      places: named.size,
      minutes: Math.round(all.filter((t) => !t.broken).reduce((sum, t) => sum + t.minutes, 0)),
      perWeek: insights.days ? round(all.length / (insights.days / 7)) : 0,
    },
    places: [...arrivals]
      .map(([name, trips]) => ({ name, trips, share: all.length ? Math.round((trips / all.length) * 100) / 100 : 0 }))
      .sort((a, b) => b.trips - a.trips || a.name.localeCompare(b.name)),
    routes: [...routes]
      .sort((a, b) => b.trips.length - a.trips.length)
      .map((r) => ({
        id: r.id, from: r.from, to: r.to, mode: r.mode, trips: r.trips.length,
        median: r.median, low: r.low, high: r.high, departure: r.departure,
        ...trend(r),
        lastAt: r.trips.length ? r.trips.reduce((a, b) => (+new Date(b.start) > +new Date(a.start) ? b : a)).start : null,
      })),
    routines,
    trips: all
      .sort((a, b) => +new Date(b.start) - +new Date(a.start))
      .slice(0, HISTORY_TRIPS_MAX)
      .map((t) => ({ from: t.from, to: t.to, start: t.start, minutes: round(t.minutes), mode: t.mode, broken: t.broken })),
    pattern,
  };
}
