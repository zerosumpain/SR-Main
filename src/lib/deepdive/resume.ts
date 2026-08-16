/**
 * Adopting research runs that lost their worker.
 *
 * Worker state is process-local (`activeEmitters`, `abortControllers` in
 * `worker.ts`) and `startResearch` is fire-and-forget, so a deploy landing
 * mid-run left the session in a non-terminal status forever. Measured on
 * production 2026-08-14: **seven of thirty-one sessions stranded** in `phase1`,
 * `phase3` or `post_processing` — the oldest since April — and CI deploys on
 * every merge to master, so the exposure is continuous rather than rare.
 *
 * Liveness is decided by `heartbeatAt`, written explicitly by a running worker.
 * It is NOT derived by subtracting `updatedAt`: a row touched by an unrelated
 * write would read as alive, and a worker sitting inside one long LLM call
 * would read as dead. That distinction has bitten this codebase before.
 */
import { db } from '$lib/db';
import { researchSessions, researchLeads } from '$lib/db/schema';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { startResearch, isRunning, clearSignals } from './worker';
import { resumePhase } from './phase-order';

/**
 * How quiet a session must be before another process may adopt it.
 *
 * Comfortably longer than the worker's 10s heartbeat interval, so ordinary
 * scheduling jitter or a slow query never looks like death — but short enough
 * that a redeploy resumes within a minute rather than leaving a user staring at
 * a frozen page.
 */
export const STALE_AFTER_MS = 90_000;

/**
 * How often to look for stranded runs.
 *
 * Comfortably longer than `STALE_AFTER_MS`, so a sweep never races the very
 * threshold it is testing, and short enough that a lost worker costs minutes
 * rather than waiting for whenever the next deploy happens to land.
 *
 * The sweep used to run ONCE, thirty seconds after boot — which is inside the
 * ninety-second staleness window, so a run that was beating right up to the
 * restart was always too fresh to adopt and nothing ever looked again.
 */
export const RESUME_SWEEP_INTERVAL_MS = 120_000;

const NON_TERMINAL = ['phase1', 'phase2', 'phase3', 'post_processing'];

export interface ResumeResult {
  adopted: string[];
  skipped: number;
}

/**
 * Put one session back to work, from where it left off.
 *
 * The single path used by both the sweep and the Resume button, because the
 * three things that have to happen are the same either way and getting any of
 * them wrong is silent:
 *
 *  1. **Start at the stored phase.** `startResearch` always begins at phase 1.
 *     For a session already past lead generation that is not a resume, it is a
 *     restart that pays for the gathering twice — see `$lib/deepdive/phase-order`.
 *  2. **Requeue the in-flight leads.** `takeLeads` only claims `queued` rows, so
 *     leads left `running` by a dead worker are invisible to the frontier
 *     forever.
 *  3. **Forget the old signals.** A pause flag set thirty seconds ago is still
 *     in the map, and would stop the run again on its first check.
 */
export async function resumeSession(
  sessionId: string,
): Promise<{ ok: boolean; phase?: string; reason?: string }> {
  if (isRunning(sessionId)) return { ok: false, reason: 'This run is already going.' };

  const [row] = await db
    .select({
      id: researchSessions.id,
      status: researchSessions.status,
      resumeFrom: researchSessions.resumeFrom,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);

  if (!row) return { ok: false, reason: 'No such research run.' };
  if (row.status === 'complete') return { ok: false, reason: 'This run already finished.' };

  const phase = resumePhase(row);

  await db
    .update(researchLeads)
    .set({ status: 'queued', startedAt: null })
    .where(and(eq(researchLeads.sessionId, sessionId), eq(researchLeads.status, 'running')));

  await db
    .update(researchSessions)
    .set({
      status: phase,
      resumeFrom: null,
      resumedAt: new Date(),
      heartbeatAt: new Date(),
      // The old failure no longer describes the run, and leaving it there put a
      // red error line above a working page.
      errorMessage: null,
    })
    .where(eq(researchSessions.id, sessionId));

  clearSignals(sessionId);
  startResearch(sessionId);
  return { ok: true, phase };
}

/**
 * Find sessions nobody is working on and restart them.
 *
 * A `draft` session is included: it means the row was created but its worker
 * never started, which is exactly what a crash between INSERT and
 * `startResearch` leaves behind.
 */
export async function resumeStrandedSessions(now = Date.now()): Promise<ResumeResult> {
  const cutoff = new Date(now - STALE_AFTER_MS);

  const candidates = await db
    .select({
      id: researchSessions.id,
      status: researchSessions.status,
      heartbeatAt: researchSessions.heartbeatAt,
      createdAt: researchSessions.createdAt,
    })
    .from(researchSessions)
    .where(
      and(
        inArray(researchSessions.status, [...NON_TERMINAL, 'draft']),
        // Never seen a heartbeat, or not for a while.
        or(isNull(researchSessions.heartbeatAt), lt(researchSessions.heartbeatAt, cutoff)),
        // Don't adopt a session created seconds ago — its worker may still be
        // booting and has not written its first beat yet.
        lt(researchSessions.createdAt, cutoff),
      ),
    )
    .limit(25);

  const adopted: string[] = [];
  let skipped = 0;

  for (const session of candidates) {
    const outcome = await resumeSession(session.id);
    if (!outcome.ok) {
      // Almost always "already running" — `isRunning` is process-local and
      // authoritative for whether this node owns the session.
      skipped++;
      continue;
    }
    console.log(
      `[deepdive] adopting stranded session ${session.id} (was ${session.status}, resuming at ${outcome.phase})`,
    );
    adopted.push(session.id);
  }

  return { adopted, skipped };
}

/**
 * Close out sessions too old to be worth resuming.
 *
 * Without this, the seven historic strays would be adopted on the next boot and
 * re-run research on questions asked four months ago — spending real money to
 * finish something nobody is waiting for. Anything older than the cutoff is
 * marked failed with an honest reason instead.
 *
 * The liveness clause is built with `or()`, NOT a raw `sql` fragment containing
 * OR. Drizzle's `and()` parenthesises the conjunction as a whole but splices
 * each operand in as written, so
 *
 *     and(A, B, sql`C OR D`)   →   (A and B and C OR D)
 *
 * and AND binds tighter than OR, which reads as `(A and B and C) OR D`. `D`
 * alone is "has a heartbeat older than a day", which matches **completed** runs
 * — so this UPDATE would have stamped finished research as
 * "Abandoned — its worker was lost". It had not fired yet only because the two
 * completed production rows carrying a heartbeat were both younger than the
 * cutoff on the day it was found.
 */
export async function retireAncientSessions(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await db
    .update(researchSessions)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: 'Abandoned — its worker was lost and the run was too old to resume',
    })
    .where(
      and(
        inArray(researchSessions.status, NON_TERMINAL),
        lt(researchSessions.createdAt, cutoff),
        or(isNull(researchSessions.heartbeatAt), lt(researchSessions.heartbeatAt, cutoff)),
      ),
    )
    .returning({ id: researchSessions.id });

  if (rows.length) {
    console.log(`[deepdive] retired ${rows.length} abandoned research session(s)`);
  }
  return rows.length;
}

/**
 * Boot hook: retire the ancient, adopt the recent.
 *
 * Order matters — retiring first stops a months-old session being adopted and
 * charged to the current bill.
 */
export async function runResumeSweep(): Promise<ResumeResult> {
  try {
    await retireAncientSessions();
  } catch (err) {
    console.error('[deepdive] retiring abandoned sessions failed:', err);
  }
  try {
    return await resumeStrandedSessions();
  } catch (err) {
    console.error('[deepdive] resume sweep failed:', err);
    return { adopted: [], skipped: 0 };
  }
}
