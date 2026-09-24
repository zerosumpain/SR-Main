import { sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';

/**
 * Kept news stories were written as source 'web' until 2026-09-24. Every one
 * carries `metadata.newsKey`, so the relabel is exact: a 'web' note without the
 * key is a chat "remember that" and stays where it is. Idempotent — a second
 * run finds nothing left to move and returns 0.
 *
 * Returns the number of notes relabelled. The caller invalidates the graph
 * analysis; this only writes.
 */
export async function relabelKeptNews(executor: DbExecutor = db): Promise<number> {
  const res = await executor.execute(sql`
    UPDATE intel_notes SET source = 'news', updated_at = now()
    WHERE source = 'web' AND metadata ? 'newsKey'`);
  return res.rowCount ?? 0;
}
