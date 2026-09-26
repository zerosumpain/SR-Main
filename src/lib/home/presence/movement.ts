// src/lib/home/presence/movement.ts
//
// The loader behind `movementStats`: one person's trail for a window, cut into
// journeys and visits by the same segmenters the rest of presence uses, with
// place names attached. Returns the stats only — no coordinate leaves here.

import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { looksLikeRail, segmentVisits } from './cluster';
import { segmentJourneys, type Journey, type JourneyFix } from './journeys';
import { DEFAULT_WINDOW_DAYS, movementStats, type MovementStats, type StatsVisit } from './stats';
import { MIN_DWELL_MINS, RAIL_MIN_FIXES, VISIT_MAX_GAP_MINS, type MovementMode } from './types';

/**
 * Whether a vehicle journey ran like a train somewhere along it: any run of
 * consecutive fixes that `looksLikeRail` accepts. Advisory, as the mode always
 * is — a straight motorway passes too.
 */
export function railJourney(fixes: Array<{ lat: number; lon: number; speedKmh: number | null }>): boolean {
  for (let i = RAIL_MIN_FIXES; i <= fixes.length; i++) {
    if (looksLikeRail(fixes.slice(i - RAIL_MIN_FIXES, i))) return true;
  }
  return false;
}

/**
 * Stays at named-or-not places: runs of consecutive fixes carrying one place
 * id, each segmented by `segmentVisits` so a drive past a place is not a stay.
 */
export function visitsFromFixes(fixes: JourneyFix[], labelOf: Map<string, string | null>): StatsVisit[] {
  const out: StatsVisit[] = [];
  let run: JourneyFix[] = [];
  const flush = () => {
    const placeId = run[0]?.placeId;
    if (placeId) {
      for (const v of segmentVisits(run)) {
        if (v.dwellMins < MIN_DWELL_MINS) continue;
        out.push({ placeId, label: labelOf.get(placeId) ?? null, from: v.startedAt, to: v.endedAt });
      }
    }
    run = [];
  };
  for (const f of fixes) {
    const prev = run[run.length - 1];
    const gap = prev ? (f.ts.getTime() - prev.ts.getTime()) / 60_000 : 0;
    if (prev && (f.placeId !== prev.placeId || gap > VISIT_MAX_GAP_MINS)) flush();
    run.push(f);
  }
  flush();
  return out;
}

/** The home place's id — the same choice as `getHomePlace`: most lived-in wins. */
async function homePlaceId(): Promise<string | null> {
  const [home] = await db
    .select({ id: daydreamPlaces.id })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.kind, 'home'), eq(daydreamPlaces.status, 'active')))
    .orderBy(
      sql`${daydreamPlaces.visitCount} desc`,
      sql`${daydreamPlaces.medianDwellMins} desc`,
      sql`${daydreamPlaces.id}`,
    )
    .limit(1);
  return home?.id ?? null;
}

export async function loadMovementStats(
  subject: string,
  opts: { days?: number; now?: Date } = {},
): Promise<MovementStats> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? DEFAULT_WINDOW_DAYS;
  // A day's lead-in so a stay already under way when the window opens is seen.
  const from = new Date(now.getTime() - (days + 1) * 86_400_000);

  const rows = await db
    .select({
      ts: daydreamTrail.ts,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      speedKmh: daydreamTrail.speedKmh,
      mode: daydreamTrail.mode,
      placeId: daydreamTrail.placeId,
    })
    .from(daydreamTrail)
    .where(
      and(
        eq(daydreamTrail.subject, subject),
        gte(daydreamTrail.ts, from),
        lte(daydreamTrail.ts, now),
        isNotNull(daydreamTrail.lat),
      ),
    )
    .orderBy(asc(daydreamTrail.ts));

  const fixes: JourneyFix[] = rows.map((r) => ({
    ts: r.ts,
    lat: r.lat as number,
    lon: r.lon as number,
    subject,
    speedKmh: r.speedKmh,
    mode: r.mode as MovementMode,
    placeId: r.placeId,
  }));

  const placeIds = [...new Set(fixes.map((f) => f.placeId).filter((x): x is string => !!x))];
  const [labels, home] = await Promise.all([
    placeIds.length
      ? db
          .select({ id: daydreamPlaces.id, label: daydreamPlaces.label })
          .from(daydreamPlaces)
          .where(inArray(daydreamPlaces.id, placeIds))
      : Promise.resolve([] as Array<{ id: string; label: string | null }>),
    homePlaceId(),
  ]);
  const labelOf = new Map(labels.map((l) => [l.id, l.label]));

  const journeys = segmentJourneys(fixes);
  const rail = new Set<Journey>();
  for (const j of journeys) {
    if (j.dominantMode !== 'vehicle') continue;
    const along = fixes.filter((f) => f.ts >= j.startedAt && f.ts <= j.endedAt);
    if (railJourney(along.map((f) => ({ lat: f.lat, lon: f.lon, speedKmh: f.speedKmh ?? null })))) rail.add(j);
  }

  return movementStats(journeys, visitsFromFixes(fixes, labelOf), {
    days,
    now,
    homePlaceId: home,
    isRail: (j) => rail.has(j),
  });
}
