import { inArray, sql } from 'drizzle-orm';
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

/**
 * Which of these stories are ALREADY in the knowledge graph.
 *
 * `keepNewsInGraph` checks for an existing note only after you have clicked
 * through and acted, so the desk could not tell you a story was already kept
 * until you tried to keep it again. This is the same lookup, done once for the
 * whole page.
 */
export async function keptKeysFor(newsKeys: readonly string[]): Promise<Set<string>> {
  if (newsKeys.length === 0) return new Set();
  try {
    const rows = await db
      .select({ newsKey: sql<string>`${intelNotes.metadata}->>'newsKey'` })
      .from(intelNotes)
      .where(inArray(sql`${intelNotes.metadata}->>'newsKey'`, [...newsKeys]));
    return new Set(rows.map((row) => row.newsKey).filter(Boolean));
  } catch (err) {
    console.error('[news] could not load kept stories:', err instanceof Error ? err.message : err);
    return new Set();
  }
}
