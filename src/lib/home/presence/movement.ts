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
import {
  DEFAULT_WINDOW_DAYS,
  localWindow,
  movementStats,
  placeTime,
  placeTimeByPlace,
  type MovementStats,
  type PersonPlaceTime,
  type StatsVisit,
} from './stats';
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

/**
 * The names of the places a trail touches, keyed by id. Only an ACTIVE place
 * lends its name: a place the owner removed (`ignored`), merged or demoted to
 * transit reads as unnamed, so its time folds into "elsewhere" rather than
 * living on under a name nobody sees on /places any more.
 */
export function activeLabels(rows: Array<{ id: string; label: string | null; status: string }>): Map<string, string | null> {
  return new Map(rows.map((r) => [r.id, r.status === 'active' ? r.label : null]));
}

async function placeLabels(fixes: Array<{ placeId?: string | null }>): Promise<Map<string, string | null>> {
  const placeIds = [...new Set(fixes.map((f) => f.placeId).filter((x): x is string => !!x))];
  if (!placeIds.length) return new Map();
  const rows = await db
    .select({ id: daydreamPlaces.id, label: daydreamPlaces.label, status: daydreamPlaces.status })
    .from(daydreamPlaces)
    .where(inArray(daydreamPlaces.id, placeIds));
  return activeLabels(rows);
}

/** Home is a place whether or not anyone named it: unnamed, it reads "Home". */
function withHomeName(labelOf: Map<string, string | null>, home: string | null): void {
  if (home && !labelOf.get(home)) labelOf.set(home, 'Home');
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

  const [labelOf, home] = await Promise.all([placeLabels(fixes), homePlaceId()]);
  withHomeName(labelOf, home);

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

/**
 * Everyone's time at each place over the window, for the owner's places panel:
 * one trail read over every subject named, then the same `visitsFromFixes` →
 * `placeTime` pass per person as their own page makes. OWNER ONLY — called
 * from /home/people/places alone, whose load checks. Keyed by place id; no
 * coordinate leaves here.
 */
export async function placeTimeByPerson(
  people: Array<{ subject: string; displayName: string }>,
  opts: { days?: number; now?: Date } = {},
): Promise<Record<string, PersonPlaceTime[]>> {
  if (!people.length) return {};
  const now = opts.now ?? new Date();
  const days = opts.days ?? DEFAULT_WINDOW_DAYS;
  const window = localWindow(now, days);
  // A day's lead-in so a stay already under way when the window opens is seen.
  const from = new Date(window.from.getTime() - 86_400_000);

  const rows = await db
    .select({
      ts: daydreamTrail.ts,
      subject: daydreamTrail.subject,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      placeId: daydreamTrail.placeId,
    })
    .from(daydreamTrail)
    .where(
      and(
        inArray(
          daydreamTrail.subject,
          people.map((p) => p.subject),
        ),
        gte(daydreamTrail.ts, from),
        lte(daydreamTrail.ts, now),
        isNotNull(daydreamTrail.lat),
      ),
    )
    .orderBy(asc(daydreamTrail.ts));

  const bySubject = new Map<string, JourneyFix[]>();
  for (const r of rows) {
    const list = bySubject.get(r.subject) ?? [];
    list.push({ ts: r.ts, lat: r.lat as number, lon: r.lon as number, subject: r.subject, placeId: r.placeId });
    bySubject.set(r.subject, list);
  }

  const all = [...bySubject.values()].flat();
  const [labelOf, home] = await Promise.all([placeLabels(all), homePlaceId()]);
  withHomeName(labelOf, home);

  return placeTimeByPlace(
    people.map((p) => ({
      subject: p.subject,
      displayName: p.displayName,
      time: placeTime(visitsFromFixes(bySubject.get(p.subject) ?? [], labelOf), window),
    })),
  );
}
