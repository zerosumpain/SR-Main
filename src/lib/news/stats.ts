import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { countNewsFavourites } from './favourites';

export interface NewsStats {
  retainedCount: number;
  favouriteCount: number;
}

/** Counts distinct news stories the owner has explicitly kept in Intel. */
export async function getNewsStats(ownerKey: string): Promise<NewsStats> {
  try {
    const [[row], favouriteCount] = await Promise.all([
      db
        .select({
          count: sql<number>`count(distinct ${intelNotes.metadata}->>'newsKey')::int`,
        })
        .from(intelNotes)
        .where(sql`${intelNotes.metadata}->>'newsKey' is not null`),
      countNewsFavourites(ownerKey),
    ]);
    return { retainedCount: Number(row?.count ?? 0), favouriteCount };
  } catch (err) {
    console.error('[news] could not load action counts:', err);
    return { retainedCount: 0, favouriteCount: 0 };
  }
}
