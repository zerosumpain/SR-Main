import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { and, lt, notInArray } from 'drizzle-orm';
import { endCuratedSession } from './session-lifecycle';
import { STALE_TTL_MS } from './constants';

const TERMINAL_STATUSES = ['promoted', 'aborted', 'ended'];

/**
 * Runs once. Finds sessions in non-terminal status whose createdAt is older
 * than `olderThanMs` (default 14 days) and ends them.
 *
 * Returns the count of sessions reaped.
 */
export async function reapStaleSessions({
  olderThanMs = STALE_TTL_MS,
}: { olderThanMs?: number } = {}): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ id: curateSessions.id })
    .from(curateSessions)
    .where(
      and(
        lt(curateSessions.createdAt, cutoff),
        notInArray(curateSessions.status, TERMINAL_STATUSES),
      ),
    );

  let reaped = 0;
  for (const row of stale) {
    try {
      await endCuratedSession(row.id);
      reaped++;
    } catch (err) {
      // Don't let one bad session block the whole reap.
      console.error(`[curate-reaper] failed to end ${row.id}:`, err);
    }
  }
  return reaped;
}

let cronStarted = false;

/** Start the daily reaper. Idempotent — second call is a no-op. */
export function startReaperCron(): void {
  if (cronStarted) return;
  cronStarted = true;
  const HOURS = 24 * 60 * 60 * 1000;
  // Run immediately on boot, then every 24h.
  reapStaleSessions().catch((err) => console.error('[curate-reaper] initial run failed:', err));
  setInterval(() => {
    reapStaleSessions().catch((err) => console.error('[curate-reaper] periodic run failed:', err));
  }, HOURS);
}
