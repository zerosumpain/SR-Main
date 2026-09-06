import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { loadBacklogRoom, decideBacklogGrooming, overrideBacklogGrooming } from '$lib/selfimprove/epic-backlog.server';

// Coordinate intake from the web and background workers. The transaction holds
// the advisory lock while the existing ledger APIs use their own connections.
let queue: Promise<unknown> = Promise.resolve();
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  // Queue locally before reserving a database connection. Otherwise several
  // lock waiters can occupy the whole pool and starve the active pass's reads.
  const result = queue.then(() => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(731, 5275)`);
    return work();
  }));
  queue = result.catch(() => {});
  return result;
}

export async function autoGroomBacklog() {
  return exclusive(async () => {
    const { epics } = await loadBacklogRoom();
    for (const suggestion of epics.flatMap((e) => e.suggestions ?? []).filter((s) => s.automatic)) {
      // The locked pass shares one comparison snapshot; each write re-reads
      // source and target lifecycle state before retiring any work.
      try { await decideBacklogGrooming(suggestion.id, 'apply', 'engine', epics); }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('Suggestion changed')) continue;
        throw error;
      }
    }
    return loadBacklogRoom();
  });
}

/**
 * Rule on several suggestions at once.
 *
 * The review lane offers "apply all merges" over a hundred-odd pending rows,
 * and doing that one request at a time meant one `loadEpicBacklog()` — two
 * ledger reads and a full board build — per decision, plus an `invalidateAll()`
 * round trip. This takes the same advisory lock the automatic pass takes,
 * reads once, and tolerates the same staleness it does: every write re-checks
 * the live row, so a suggestion the previous decision invalidated is reported
 * rather than forced.
 */
export function decideBacklogGroomingMany(ids: string[], decision: 'apply' | 'keep') {
  return exclusive(async () => {
    const { epics } = await loadBacklogRoom();
    const failed: Array<{ id: string; error: string }> = [];
    let decided = 0;
    for (const id of ids) {
      try {
        await decideBacklogGrooming(id, decision, 'owner', epics);
        decided += 1;
      } catch (error) {
        failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { decided, failed };
  });
}

/** Intake is durable even if grooming must be retried by the board/nightly pass. */
export async function groomAfterIntake(): Promise<void> {
  try { await autoGroomBacklog(); }
  catch (error) { console.error('[backlog] automatic grooming deferred:', error instanceof Error ? error.message : error); }
}

export function setGroomingOverride(itemId: string, keepSeparate: boolean) {
  return exclusive(() => overrideBacklogGrooming(itemId, keepSeparate));
}
