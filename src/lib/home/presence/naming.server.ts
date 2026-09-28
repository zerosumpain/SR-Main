// src/lib/home/presence/naming.server.ts
//
// The places worth naming, ranked by the time the household actually spent
// there — not by visit count, which counts a car of five as five visits and a
// drive past as one. 105 of 133 active places were unnamed on 2026-09-28 and
// nearly all carried a map suggestion; the dashboard offers each suggestion as
// one tap, most-lived-in first. OWNER ONLY: the caller checks.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';

export interface NamingCandidate {
  id: string;
  suggestedLabel: string | null;
  suggestedKind: string | null;
  suggestedAddress: string | null;
  /** Person-minutes observed at the place in the window (two-minute bins). */
  minutes: number;
  subjects: string[];
  lastSeen: string | null;
}

/** Unnamed active places, most person-time first. */
export async function loadNamingQueue(days: number, limit = 8, now = new Date()): Promise<NamingCandidate[]> {
  const since = new Date(+now - days * 86_400_000);
  const time = await db.execute(sql`
    select place_id as "placeId", subject,
      count(distinct date_bin('2 minutes', ts, timestamptz '2000-01-01')) * 2 as minutes,
      max(ts) as "lastSeen"
    from daydream_trail
    where ts >= ${since} and ts <= ${now} and place_id is not null
    group by place_id, subject
  `);
  const byPlace = new Map<string, { minutes: number; subjects: string[]; lastSeen: string | null }>();
  for (const r of time.rows as Array<{ placeId: string; subject: string; minutes: number | string; lastSeen: Date | string }>) {
    const e = byPlace.get(r.placeId) ?? { minutes: 0, subjects: [], lastSeen: null };
    e.minutes += Number(r.minutes);
    e.subjects.push(r.subject);
    const seen = new Date(r.lastSeen).toISOString();
    if (!e.lastSeen || seen > e.lastSeen) e.lastSeen = seen;
    byPlace.set(r.placeId, e);
  }
  if (!byPlace.size) return [];
  const places = await db
    .select({
      id: daydreamPlaces.id,
      suggestedLabel: daydreamPlaces.suggestedLabel,
      suggestedKind: daydreamPlaces.suggestedKind,
      suggestedAddress: daydreamPlaces.suggestedAddress,
    })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.status, 'active'), isNull(daydreamPlaces.label), inArray(daydreamPlaces.id, [...byPlace.keys()])));
  return places
    .map((p) => ({ ...p, ...byPlace.get(p.id)!, subjects: [...byPlace.get(p.id)!.subjects].sort() }))
    .filter((p) => p.minutes >= 30)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}

/** How many active places have no name, for the headline. */
export async function unnamedCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.status, 'active'), isNull(daydreamPlaces.label)));
  return row?.n ?? 0;
}
