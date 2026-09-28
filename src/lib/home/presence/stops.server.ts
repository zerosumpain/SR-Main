import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { qualifiedStop } from './insights';
import { insightMembers } from './insights.server';
import { metresBetween } from './cluster';
import { geocodePendingPlaces } from './geocode.server';

/** Small recent-window stop detection; never run the ninety-day clusterer on ingest. */
export async function discoverRecentStops(): Promise<{ created: number; geocoded: number }> {
  const now = new Date();
  const members = await insightMembers({ kind: 'owner' });
  let created = 0;
  for (const member of members) {
    const rows = await db.select().from(daydreamTrail).where(and(eq(daydreamTrail.subject, member.subject),
      gte(daydreamTrail.ts, new Date(+now - 20 * 60_000)))).orderBy(desc(daydreamTrail.ts)).limit(5000);
    const stop = qualifiedStop(rows, now);
    if (!stop) continue;
    const lat = stop.reduce((n, f) => n + f.lat, 0) / stop.length;
    const lon = stop.reduce((n, f) => n + f.lon, 0) / stop.length;
    await db.transaction(async tx => {
      // One shared lock prevents two relatives creating two places for the same stop.
      await tx.execute(sql`select pg_advisory_xact_lock(7280929)`);
      const places = await tx.select().from(daydreamPlaces);
      const near = places.filter(p => p.status !== 'merged' && metresBetween(lat, lon, p.lat, p.lon) <= Math.max(100, p.radiusM))
        .sort((a, b) => metresBetween(lat, lon, a.lat, a.lon) - metresBetween(lat, lon, b.lat, b.lon))[0];
      if (near && near.status !== 'active') return;
      let id = near?.id;
      if (!id) {
        const [p] = await tx.insert(daydreamPlaces).values({ lat, lon, radiusM: 100, source: 'inferred', kind: 'unknown',
          firstSeenAt: stop[0].ts, lastSeenAt: stop.at(-1)!.ts, visitCount: 1, distinctDays: 1,
          medianDwellMins: Math.round((+stop.at(-1)!.ts - +stop[0].ts) / 60_000) }).returning({ id: daydreamPlaces.id });
        id = p.id; created++;
      } else if (near && (!near.lastSeenAt || +near.lastSeenAt < +stop.at(-1)!.ts)) {
        // A returning stop should lead the lookup queue, ahead of older unnamed history.
        await tx.update(daydreamPlaces).set({ lastSeenAt: stop.at(-1)!.ts }).where(eq(daydreamPlaces.id, id));
      }
      const ids = rows.filter(r => +r.ts >= +stop[0].ts && +r.ts <= +stop.at(-1)!.ts).map(r => r.id);
      if (ids.length) await tx.update(daydreamTrail).set({ placeId: id }).where(inArray(daydreamTrail.id, ids));
    });
  }
  return { created, geocoded: await geocodePendingPlaces() };
}
