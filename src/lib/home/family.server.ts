// src/lib/home/family.server.ts
//
// Where the household is — read off the family trail (`daydream_trail`,
// Life360 through Home Assistant) for `/home` and `/home/people`.
//
// This was `loadFamily` in the daydream ledger. The daydream engine that owned
// the trail was retired in P4a (2026-09-25) and this is the one reader that
// survived it, so it lives beside the rest of the home now. Presence only:
// the per-person questions, sweep findings and suggestions the old family
// room also showed came from engine parts that no longer exist.
//
// NOTE: the trail's only writer, the `daydream-observe` heartbeat job, was
// paused on 2026-09-25 (spec D1 revised). Until something writes the trail
// again, these positions only age.

import { inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { localDayStart } from '$lib/daydream/budget';

/** Everyone the trail observed, by trail subject. */
export const FAMILY_SUBJECTS = ['john', 'katie', 'fintan', 'jemima', 'rory'] as const;

export interface FamilyMember {
  subject: string;
  isHome: boolean | null;
  placeLabel: string | null;
  distanceHomeKm: number | null;
  batteryPct: number | null;
  ageMins: number | null;
  lastSeenAt: Date | null;
  today: { firstOutMins: number | null; minutesOut: number; placesVisited: number; fixes: number };
}

export async function loadFamily(now = new Date()): Promise<{ members: FamilyMember[] }> {
  const dayStart = localDayStart(now);
  const subjects = [...FAMILY_SUBJECTS];

  // Three queries for the whole household, not three per person.
  const [latestRows, todayAgg] = await Promise.all([
    db.execute(sql`
      select distinct on (${daydreamTrail.subject})
        ${daydreamTrail.subject} as subject,
        ${daydreamTrail.ts} as ts,
        ${daydreamTrail.isHome} as is_home,
        ${daydreamTrail.placeId} as place_id,
        ${daydreamTrail.distanceHomeKm} as distance_home_km,
        ${daydreamTrail.batteryPct} as battery_pct
      from ${daydreamTrail}
      where ${daydreamTrail.lat} is not null and ${daydreamTrail.subject} in ${subjects}
      order by ${daydreamTrail.subject}, ${daydreamTrail.ts} desc
    `).then((r) => r.rows as Array<{
      subject: string;
      ts: Date | string;
      is_home: boolean | null;
      place_id: string | null;
      distance_home_km: number | null;
      battery_pct: number | null;
    }>),
    db.execute(sql`
      select
        ${daydreamTrail.subject} as subject,
        count(*)::int as fixes,
        count(*) filter (where ${daydreamTrail.lat} is not null and ${daydreamTrail.isHome} = false)::int as out_rows,
        min(${daydreamTrail.ts}) filter (where ${daydreamTrail.lat} is not null and ${daydreamTrail.isHome} = false) as first_out,
        count(distinct ${daydreamTrail.placeId}) filter (where ${daydreamTrail.lat} is not null)::int as places_visited
      from ${daydreamTrail}
      where ${daydreamTrail.ts} >= ${dayStart} and ${daydreamTrail.subject} in ${subjects}
      group by ${daydreamTrail.subject}
    `).then((r) => r.rows as Array<{
      subject: string;
      fixes: number;
      out_rows: number;
      first_out: Date | string | null;
      places_visited: number;
    }>),
  ]);

  const latestBy = new Map(latestRows.map((r) => [r.subject, r]));
  const todayBy = new Map(todayAgg.map((r) => [r.subject, r]));
  const placeIds = [...new Set(latestRows.map((r) => r.place_id).filter((x): x is string => !!x))];
  const labels = placeIds.length
    ? await db
        .select({ id: daydreamPlaces.id, label: daydreamPlaces.label })
        .from(daydreamPlaces)
        .where(inArray(daydreamPlaces.id, placeIds))
    : [];
  const labelBy = new Map(labels.map((l) => [l.id, l.label]));
  const asDate = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v : new Date(v));

  const members = FAMILY_SUBJECTS.map((subject): FamilyMember => {
    const latest = latestBy.get(subject);
    const today = todayBy.get(subject);
    const latestTs = asDate(latest?.ts);
    const firstOut = asDate(today?.first_out);
    return {
      subject,
      isHome: latest?.is_home ?? null,
      placeLabel: latest?.place_id ? (labelBy.get(latest.place_id) ?? null) : null,
      distanceHomeKm: latest?.distance_home_km == null ? null : Number(latest.distance_home_km),
      batteryPct: latest?.battery_pct == null ? null : Number(latest.battery_pct),
      ageMins: latestTs ? Math.round((now.getTime() - latestTs.getTime()) / 60_000) : null,
      lastSeenAt: latestTs,
      today: {
        firstOutMins: firstOut ? Math.round((firstOut.getTime() - dayStart.getTime()) / 60_000) : null,
        // Each positioned fix stands for one observe interval (2 min).
        minutesOut: Math.round((today?.out_rows ?? 0) * 2),
        placesVisited: today?.places_visited ?? 0,
        fixes: today?.fixes ?? 0,
      },
    };
  });
  return { members };
}
