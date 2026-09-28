import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { listMembers, type HouseholdMember } from './members';
import { loadCompanionUsers, notSharingSubjects } from './companion';
import { analysePresence, type InsightFix, type PresenceInsights } from './insights';
import { mayOpenPerson, type PeopleViewer } from './viewer';

const cache = new Map<string, { expires: number; value: Promise<PresenceInsights> }>();

/** Consent is re-read before every analysis; no cached trail survives a sharing change. */
export async function insightMembers(viewer: PeopleViewer, roster?: HouseholdMember[]) {
  const all = roster ?? await listMembers();
  const users = await loadCompanionUsers().catch(() => null);
  const hidden = notSharingSubjects(all, users);
  return all.filter(m => m.source !== 'none' && !hidden.has(m.subject) && mayOpenPerson(viewer, m.subject));
}
export async function loadPresenceInsights(viewer: PeopleViewer, days = 28, person: string | null = null, now = new Date()): Promise<PresenceInsights> {
  const members = (await insightMembers(viewer)).filter(m => !person || m.subject === person);
  if (!members.length) return analysePresence([], [], [], now, days);
  const places = await db.select().from(daydreamPlaces).where(eq(daydreamPlaces.status, 'active'));
  const key = JSON.stringify([days, members.map(m => [m.subject, m.displayName]), places.map(p => [p.id, +p.updatedAt])]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = (async () => {
    // Bound dense five-second app uploads before they cross the DB boundary.
    // Retain place crossings and bad/gap observations as separate groups so a
    // dropped fix cannot manufacture continuous coverage or a completed trip.
    const subjects = members.map(m => m.subject);
    const result = await db.execute(sql`
      with candidates as (
        select subject, ts, lat, lon, accuracy_m as "accuracyM", reading_age_s as "readingAgeS",
          place_id as "placeId", mode, speed_kmh as "speedKmh", is_home as "isHome", id,
          date_bin('2 minutes', ts, timestamptz '2000-01-01') as bin,
          (lat is null or lon is null or coalesce(accuracy_m > 150, false)
            or coalesce(reading_age_s > 120, false)) as unusable
        from daydream_trail where subject in (${sql.join(subjects.map(s => sql`${s}`), sql`, `)})
          and ts >= ${new Date(+now - days * 86_400_000)} and ts <= ${now}
      ), sampled as (
        select distinct on (subject, bin, "placeId", unusable) * from candidates
        order by subject, bin, "placeId", unusable, ts desc, id desc
      )
      select subject, ts, lat, lon, "accuracyM", "readingAgeS", "placeId", mode, "speedKmh", "isHome"
      from sampled order by subject, ts
    `);
    const rows = (result.rows as unknown as InsightFix[]).map(r => ({ ...r, ts: new Date(r.ts) }));
    return analysePresence(rows, places, members, now, days);
  })();
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 20_000, value });
  try { return await value; } catch (error) { cache.delete(key); throw error; }
}
