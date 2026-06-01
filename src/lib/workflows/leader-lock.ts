/**
 * #19 LEADER ELECTION — pg advisory-lock helper.
 *
 * ADDITIVE + FEATURE-FLAGGED. Only used when the run-worker is enabled
 * (`JKAI_RUN_WORKER === '1'`). When the flag is OFF, the scheduler never calls
 * these and behaves exactly as today.
 *
 * Why: with an out-of-process run-worker, the cron/scheduled lane could fire in
 * BOTH the SvelteKit web process and the worker process, double-firing crons.
 * A session-scoped pg advisory lock (`pg_try_advisory_lock`) lets exactly one
 * process win leadership of a given lane. The holder runs the scheduler; the
 * loser stays passive.
 *
 * The key-derivation helper is a pure function so it's unit-testable without a
 * DB. pg advisory locks key on a bigint; we hash a string lane name into the
 * signed 32-bit range so two different lanes never collide on the same key.
 */

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

/** Advisory-lock lane for the cron/scheduled dispatch leader. */
export const SCHEDULER_LOCK_LANE = 'jkai:workflow-scheduler';

/**
 * Advisory-lock lane for the Forge trigger scheduler (scheduled + autonomous
 * brass-and-rails builds). DISTINCT lane so the Forge scheduler elects its own
 * leader independently of the workflow scheduler — they must not share a lock.
 */
export const FORGE_SCHEDULER_LOCK_LANE = 'jkai:forge-scheduler';

/**
 * PURE: derive a stable signed-32-bit advisory-lock key from a lane name.
 * Deterministic (FNV-1a-ish) so the same lane always maps to the same key
 * across processes/restarts. Exported for tests.
 *
 * pg_try_advisory_lock(key bigint) accepts the full int8 range; we keep within
 * the signed 32-bit range for portability and to avoid JS float precision.
 */
export function advisoryLockKey(lane: string): number {
  let h = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < lane.length; i++) {
    h ^= lane.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  // Coerce to signed 32-bit so it fits pg's bigint comfortably and is stable.
  return h | 0;
}

/**
 * Try to acquire a session-scoped advisory lock for a lane. Non-blocking:
 * returns true if this connection now holds the lock, false if another session
 * holds it. NOTE: node-postgres pools connections, so the lock is held on
 * whichever pooled connection served this query — for leader election we hold
 * it for the process lifetime, which is fine for a long-lived worker/web
 * process. Best-effort: a DB error returns false (caller stays passive).
 */
export async function tryAdvisoryLock(lane: string): Promise<boolean> {
  try {
    const key = advisoryLockKey(lane);
    const res = await db.execute(sql`SELECT pg_try_advisory_lock(${key}) AS locked`);
    const rows = (res as unknown as { rows?: Array<{ locked: boolean }> }).rows ?? [];
    return rows[0]?.locked === true;
  } catch (e) {
    console.warn('[leader-lock] tryAdvisoryLock failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Release a previously-acquired advisory lock for a lane. Best-effort; safe to
 * call even if not held (pg returns false). Used on graceful shutdown.
 */
export async function releaseAdvisoryLock(lane: string): Promise<void> {
  try {
    const key = advisoryLockKey(lane);
    await db.execute(sql`SELECT pg_advisory_unlock(${key})`);
  } catch (e) {
    console.warn('[leader-lock] releaseAdvisoryLock failed:', e instanceof Error ? e.message : e);
  }
}
