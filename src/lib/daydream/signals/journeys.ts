// src/lib/daydream/signals/journeys.ts
//
// Journeys, republished as signals.
//
// Two kinds. The daily aggregates — how long spent moving, how far, how many
// trips, the longest one — are the obvious ones and apply to everybody.
//
// The second kind is the one actually worth having: DOOR-TO-DOOR TIME between
// two named places. "The school run took 22 minutes today, and usually takes
// 14" is a fact about a day; "you travelled for 38 minutes" is barely one.
//
// A signal per pair of places would blow the registry open — 160 places is
// 12,720 possible pairs — so a route earns a signal only when BOTH ends are
// named and it has recurred. Named because an unnamed pair produces a key like
// `journey:route:a3f1→b7c2`, which no card could ever render usefully; recurred
// because a route travelled once is a trip, not a route.

import { and, asc, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { segmentJourneys, summariseDay, type Journey, type JourneyFix } from '../journeys';
import { LOCAL_TZ, type MovementMode } from '../types';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

/** Days a route must appear on before it earns a signal of its own. */
export const MIN_DAYS_FOR_ROUTE = 3;

const DAILY: ReadonlyArray<{ id: string; label: string; unit: string | null }> = [
  { id: 'count', label: 'Journeys', unit: null },
  { id: 'minutes_moving', label: 'Time travelling', unit: 'min' },
  { id: 'distance_km', label: 'Distance travelled', unit: 'km' },
  { id: 'longest_minutes', label: 'Longest journey', unit: 'min' },
  { id: 'max_speed_kmh', label: 'Top speed', unit: 'km/h' },
];

const MODE_SIGNALS: ReadonlyArray<{ mode: MovementMode; label: string }> = [
  { mode: 'vehicle', label: 'Time in a vehicle' },
  { mode: 'walking', label: 'Time walking' },
  { mode: 'active', label: 'Time moving actively' },
  { mode: 'rail', label: 'Time on rail (or a motorway)' },
];

export const JOURNEY_SPECS: SignalSpec[] = [
  ...DAILY.map((d) => ({
    key: signalKey('journey', d.id),
    source: 'journey',
    label: d.label,
    unit: d.unit,
    valueKind: 'numeric' as const,
  })),
  ...MODE_SIGNALS.map((m) => ({
    key: signalKey('journey', `minutes_${m.mode}`),
    source: 'journey',
    label: m.label,
    unit: 'min',
    valueKind: 'numeric' as const,
  })),
];

const localDayOf = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ }).format(d);

/**
 * Derive journeys over a window and write the day's numbers.
 *
 * `setObservations`, not `recordObservations`: a day's journeys are recomputed
 * whole from the trail every run, so folding would compound the same day into
 * itself. Same reasoning as the feature-store mirror.
 */
export async function buildJourneySignals(
  opts: { windowDays?: number; now?: Date } = {},
): Promise<{ days: number; journeys: number; routes: number; written: number }> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? 30;
  const from = new Date(now.getTime() - windowDays * 86_400_000);

  await registerSignals(JOURNEY_SPECS);

  const rows = await db
    .select({
      ts: daydreamTrail.ts,
      subject: daydreamTrail.subject,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      speedKmh: daydreamTrail.speedKmh,
      mode: daydreamTrail.mode,
      placeId: daydreamTrail.placeId,
    })
    .from(daydreamTrail)
    .where(and(gte(daydreamTrail.ts, from), lte(daydreamTrail.ts, now), isNotNull(daydreamTrail.lat)))
    .orderBy(asc(daydreamTrail.ts));

  if (rows.length === 0) return { days: 0, journeys: 0, routes: 0, written: 0 };

  const fixes: JourneyFix[] = rows.map((r) => ({
    ts: r.ts,
    lat: r.lat as number,
    lon: r.lon as number,
    subject: r.subject,
    speedKmh: r.speedKmh,
    mode: r.mode as MovementMode,
    placeId: r.placeId,
  }));

  const journeys = segmentJourneys(fixes);

  // ── daily aggregates, per person per day ────────────────────────────────
  const byDay = new Map<string, Journey[]>();
  for (const j of journeys) {
    const key = `${j.subject}|${localDayOf(j.startedAt)}`;
    const list = byDay.get(key) ?? [];
    list.push(j);
    byDay.set(key, list);
  }

  let written = 0;
  for (const [key, list] of byDay) {
    const [subject, day] = key.split('|');
    const s = summariseDay(list);
    const readings: Reading[] = [
      { key: signalKey('journey', 'count'), subject, value: s.count },
      { key: signalKey('journey', 'minutes_moving'), subject, value: s.minutesMoving },
      { key: signalKey('journey', 'distance_km'), subject, value: s.distanceKm },
      { key: signalKey('journey', 'longest_minutes'), subject, value: s.longestMinutes },
    ];
    // Absent, not zero: no reading is different from a top speed of nothing.
    if (s.maxSpeedKmh != null) {
      readings.push({ key: signalKey('journey', 'max_speed_kmh'), subject, value: s.maxSpeedKmh });
    }
    for (const m of MODE_SIGNALS) {
      const mins = s.byMode[m.mode];
      if (mins != null) {
        readings.push({ key: signalKey('journey', `minutes_${m.mode}`), subject, value: mins });
      }
    }
    written += await setObservations(day, readings);
  }

  // ── recurring named routes ──────────────────────────────────────────────
  const named = await db
    .select({ id: daydreamPlaces.id, label: daydreamPlaces.label })
    .from(daydreamPlaces)
    .where(isNotNull(daydreamPlaces.label));
  const labelOf = new Map(named.map((p) => [p.id, p.label as string]));

  const routeDays = new Map<string, Set<string>>();
  const routeLegs = new Map<string, Array<{ subject: string; day: string; minutes: number }>>();

  for (const j of journeys) {
    if (!j.fromPlaceId || !j.toPlaceId || j.fromPlaceId === j.toPlaceId) continue;
    const a = labelOf.get(j.fromPlaceId);
    const b = labelOf.get(j.toPlaceId);
    if (!a || !b) continue;
    // Labels are not unique — two distinct places are both called "Elton
    // Parade" (the house, and a road cluster beside it), which produced a
    // route signal named "Elton Parade→Elton Parade". Comparing ids is not
    // enough when the KEY is built from labels: a route a reader cannot tell
    // apart is not a route.
    if (a === b) continue;
    const id = `route:${a}→${b}`;
    const day = localDayOf(j.startedAt);
    (routeDays.get(id) ?? routeDays.set(id, new Set()).get(id)!).add(day);
    (routeLegs.get(id) ?? routeLegs.set(id, []).get(id)!).push({ subject: j.subject, day, minutes: j.minutes });
  }

  const earned = [...routeDays.entries()].filter(([, days]) => days.size >= MIN_DAYS_FOR_ROUTE);
  if (earned.length) {
    await registerSignals(
      earned.map(([id]) => ({
        key: signalKey('journey', id),
        source: 'journey',
        label: `${id.slice('route:'.length)} — door to door`,
        unit: 'min',
        valueKind: 'numeric' as const,
      })),
    );
    for (const [id] of earned) {
      for (const leg of routeLegs.get(id) ?? []) {
        written += await setObservations(leg.day, [
          { key: signalKey('journey', id), subject: leg.subject, value: leg.minutes },
        ]);
      }
    }
  }

  return { days: byDay.size, journeys: journeys.length, routes: earned.length, written };
}
