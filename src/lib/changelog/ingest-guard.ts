import { sql } from 'drizzle-orm';
import { claudeSessions } from '$lib/db/schema';

// Columns an OLDER parser does not know about, and therefore must never be
// allowed to clear.
//
// This is not hypothetical. On 2026-09-17 the ingest cron was running a stale
// checkout whose parser predated `pull_requests`. It sent no such field, the
// upsert wrote the `[]` fallback, and every fifteen minutes it destroyed all
// 585 release links across 296 sessions — silently, with `ok: true`, on a
// loop. The write path has to assume a writer may be older than the schema.
//
// A key absent from the payload is now absent from the SET clause, so the
// stored value survives. A key PRESENT and empty is still a real instruction
// to clear it.
export const PRESERVED = ['pullRequests'] as const;

export function updateSet(r: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = { ...r, id: sql`${claudeSessions.id}` };
  for (const k of PRESERVED) if (set[k] === undefined) delete set[k];
  return set;
}
