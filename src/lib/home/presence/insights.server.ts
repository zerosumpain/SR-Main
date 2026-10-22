import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { listMembers, type HouseholdMember } from './members';
import { loadCompanionUsers, notSharingSubjects } from './companion';
import { analysePresence, type InsightFix, type PresenceInsights } from './insights';
import { mayOpenPerson, type PeopleViewer } from './viewer';
import { trailGeneration } from './trail-generation';

const cache = new Map<string, { expires: number; generation: number; value: Promise<PresenceInsights> }>();

/**
 * The trail scan under the analysis, kept until the trail changes. Every writer
 * in this process moves `trailGeneration`; the time limit is for one that does
 * not (a script run by hand), and matches the two-minute observe cycle. The
 * analysis itself is redone with the caller's `now` past the 20-second answer
 * cache, as before — only the 28 days of rows under it are reused.
 */
const ROWS_TTL_MS = 120_000;
/** Raw rows, not an answer: a few viewers' windows at most, and never the 90-day one. */
const ROWS_KEPT = 4;
const ROWS_MAX_DAYS = 28;
const rowsCache = new Map<string, { at: number; generation: number; rows: Promise<InsightFix[]> }>();

function trailRows(key: string, subjects: string[], days: number, now: Date): Promise<InsightFix[]> {
  const generation = trailGeneration();
  const hit = rowsCache.get(key);
  // Rows read at `hit.at` cover a later `now` only while nothing was written
  // since; a `now` before the read would need rows the read did not take.
  if (days <= ROWS_MAX_DAYS && hit && hit.generation === generation && +now >= hit.at && +now - hit.at < ROWS_TTL_MS) {
    const from = +now - days * 86_400_000;
    return hit.rows.then(rows => rows.filter(r => +r.ts >= from && +r.ts <= +now));
  }
  const rows = (async () => {
    // Bound dense five-second app uploads before they cross the DB boundary.
    // Retain place crossings and bad/gap observations as separate groups so a
    // dropped fix cannot manufacture continuous coverage or a completed trip.
    const result = await db.execute(sql`
      with candidates as (
        select subject, ts, lat, lon, accuracy_m as "accuracyM", reading_age_s as "readingAgeS",
          place_id as "placeId", mode, speed_kmh as "speedKmh", is_home as "isHome", id,
          date_bin('2 minutes', ts, timestamptz '2000-01-01') as bin,
          -- A provider reading's age is NOT unusability: a still Life360 phone
          -- repeats one reading for hours. normaliseReadings re-dates them.
          (lat is null or lon is null or coalesce(accuracy_m > 150, false)) as unusable
        from daydream_trail where subject in (${sql.join(subjects.map(s => sql`${s}`), sql`, `)})
          and ts >= ${new Date(+now - days * 86_400_000)} and ts <= ${now}
      ), sampled as (
        select distinct on (subject, bin, "placeId", unusable) * from candidates
        order by subject, bin, "placeId", unusable, ts desc, id desc
      )
      select subject, ts, lat, lon, "accuracyM", "readingAgeS", "placeId", mode, "speedKmh", "isHome"
      from sampled order by subject, ts
    `);
    return (result.rows as unknown as InsightFix[]).map(r => ({ ...r, ts: new Date(r.ts) }));
  })();
  if (days > ROWS_MAX_DAYS) return rows;
  rowsCache.delete(key);
  if (rowsCache.size >= ROWS_KEPT) rowsCache.delete(rowsCache.keys().next().value!);
  rowsCache.set(key, { at: +now, generation, rows });
  rows.catch(() => { if (rowsCache.get(key)?.rows === rows) rowsCache.delete(key); });
  return rows;
}

/** Reset between tests. */
export function resetInsightsCacheForTest(): void {
  cache.clear();
  rowsCache.clear();
}

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
  const generation = trailGeneration();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() && hit.generation === generation) return hit.value;
  const value = (async () => {
    const rows = await trailRows(key, members.map(m => m.subject), days, now);
    return analysePresence(rows, places, members, now, days);
  })();
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 20_000, generation, value });
  try { return await value; } catch (error) { cache.delete(key); throw error; }
}
